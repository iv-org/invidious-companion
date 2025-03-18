import { IRawResponse } from "youtubei.js";
import { Counter, Registry } from "prom-client";
import { Config } from "../helpers/config.ts";

export let metrics: Metrics | undefined;

export class Metrics {
    private METRICS_PREFIX = "invidious_companion_";
    public register = new Registry();

    public createCounter(name: string, help?: string): Counter {
        return new Counter({
            name: `${this.METRICS_PREFIX}${name}`,
            help: help || "No help has been provided for this metric",
            registers: [this.register],
        });
    }

    public potokenGenerationFailure = this.createCounter(
        "potoken_generation_failure",
        "Number of times that the PoToken generation job has failed for whatever reason",
    );

    private innertubeErrorSubreasonProtectCommunity = this.createCounter(
        "innertube_subreason_ProtectCommunity",
        'Number of times that the message "This helps protect our community." has been returned by Innertube API',
    );

    private innertubeErrorReasonSignIn = this.createCounter(
        "innertube_reason_SignIn",
        'Number of times that the message "Sign in to confirm you’re not a bot." has been returned by Innertube API',
    );

    private innertubeErrorUnknown = this.createCounter(
        "innertube_error_unknown",
        "Number of times that an unknown error has been returned by the Innertube API",
    );

    public innertubeSuccessfullRequest = this.createCounter(
        "innertube_successfull_request",
        "Number successfull requests made to the Innertube API",
    );

    private innertubeFailedRequest = this.createCounter(
        "innertube_failed_request",
        "Number failed requests made to the Innertube API for whatever reason",
    );

    public checkInnertubeResponse(videoData: IRawResponse) {
        this.innertubeFailedRequest.inc();
        let hit: boolean = false;
        if (
            videoData.playabilityStatus?.errorScreen?.playerErrorMessageRenderer
                ?.subreason?.runs?.[0]?.text?.includes(
                    "This helps protect our community",
                )
        ) {
            this.innertubeErrorSubreasonProtectCommunity.inc();
            hit = true;
        }
        if (
            videoData.playabilityStatus?.reason?.includes(
                "Sign in to confirm you’re not a bot",
            )
        ) {
            this.innertubeErrorReasonSignIn.inc();
            hit = true;
        }
        if (hit == false) {
            this.innertubeErrorUnknown.inc();
        }
        return;
    }
}

export function initMetrics(config: Config): void {
    if (config.server.enable_metrics) {
        metrics = new Metrics();
    }
}

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

    private innertubeErrorStatusUnknown = this.createCounter(
        "innertube_error_status_unknown",
        "Number of times that an unknown status has been returned by Innertube API",
    );

    private innertubeErrorReasonSignIn = this.createCounter(
        "innertube_error_reason_SignIn",
        'Number of times that the message "Sign in to confirm you’re not a bot." has been returned by Innertube API',
    );

    private innertubeErrorSubreasonProtectCommunity = this.createCounter(
        "innertube_error_subreason_ProtectCommunity",
        'Number of times that the message "This helps protect our community." has been returned by Innertube API',
    );

    private innertubeErrorReasonUnknown = this.createCounter(
        "innertube_error_reason_unknown",
        "Number of times that an unknown reason has been returned by the Innertube API",
    );

    private innertubeErrorSubreasonUnknown = this.createCounter(
        "innertube_error_subreason_unknown",
        "Number of times that an unknown subreason has been returned by the Innertube API",
    );

    public innertubeSuccessfulRequest = this.createCounter(
        "innertube_successful_request",
        "Number successful requests made to the Innertube API",
    );

    private innertubeFailedRequest = this.createCounter(
        "innertube_failed_request",
        "Number failed requests made to the Innertube API for whatever reason",
    );

    public checkInnertubeResponse(videoData: IRawResponse) {
        this.innertubeFailedRequest.inc();

        switch (true) {
            // CONTENT_CHECK_REQUIRED: Sensitive content videos.
            case (videoData.playabilityStatus?.status ===
                "CONTENT_CHECK_REQUIRED"): {
                break;
            }
            case (videoData.playabilityStatus?.status === "LOGIN_REQUIRED"): {
                switch (true) {
                    // Age restricted videos, we don't need to track those.
                    case videoData.playabilityStatus?.reason?.includes(
                        "Sign in to confirm your age",
                    ): {
                        break;
                    }

                    case videoData.playabilityStatus?.reason?.includes(
                        "Sign in to confirm you’re not a bot",
                    ): {
                        this.innertubeErrorReasonSignIn.inc();

                        switch (true) {
                            case videoData.playabilityStatus?.errorScreen
                                ?.playerErrorMessageRenderer
                                ?.subreason?.runs?.[0]?.text?.includes(
                                    "This helps protect our community",
                                ): {
                                this.innertubeErrorSubreasonProtectCommunity
                                    .inc();
                                break;
                            }
                            default: {
                                this.innertubeErrorSubreasonUnknown.inc();
                                break;
                            }
                        }

                        break;
                    }

                    default: {
                        this.innertubeErrorReasonUnknown.inc();
                        break;
                    }
                }
                break;
            }
            default:
                this.innertubeErrorStatusUnknown.inc();
                break;
        }
    }
}

export function initMetrics(config: Config): void {
    if (config.server.enable_metrics) {
        metrics = new Metrics();
    }
}

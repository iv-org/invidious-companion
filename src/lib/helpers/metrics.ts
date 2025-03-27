import { IRawResponse } from "youtubei.js";
import { Counter, Registry } from "prom-client";

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
        "potoken_generation_failure_total",
        "Number of times that the PoToken generation job has failed for whatever reason",
    );

    private innertubeErrorStatusUnknown = this.createCounter(
        "innertube_error_status_unknown_total",
        "Number of times that an unknown status has been returned by Innertube API",
    );

    private innertubeErrorReasonSignIn = this.createCounter(
        "innertube_error_reason_SignIn_total",
        'Number of times that the message "Sign in to confirm you’re not a bot." has been returned by Innertube API',
    );

    private innertubeErrorSubreasonProtectCommunity = this.createCounter(
        "innertube_error_subreason_ProtectCommunity_total",
        'Number of times that the message "This helps protect our community." has been returned by Innertube API',
    );

    private innertubeErrorReasonUnknown = this.createCounter(
        "innertube_error_reason_unknown_total",
        "Number of times that an unknown reason has been returned by the Innertube API",
    );

    private innertubeErrorSubreasonUnknown = this.createCounter(
        "innertube_error_subreason_unknown_total",
        "Number of times that an unknown subreason has been returned by the Innertube API",
    );

    public innertubeSuccessfulRequest = this.createCounter(
        "innertube_successful_request_total",
        "Number successful requests made to the Innertube API",
    );

    private innertubeFailedRequest = this.createCounter(
        "innertube_failed_request_total",
        "Number failed requests made to the Innertube API for whatever reason",
    );

    private checkStatus(videoData: IRawResponse) {
        return {
            unplayable: videoData.playabilityStatus?.status ===
                "UNPLAYABLE",
            contentCheckRequired: videoData.playabilityStatus?.status ===
                "CONTENT_CHECK_REQUIRED",
            loginRequired:
                videoData.playabilityStatus?.status === "LOGIN_REQUIRED",
        };
    }

    private checkReason(videoData: IRawResponse) {
        return {
            signInToConfirmAge: videoData.playabilityStatus?.reason?.includes(
                "Sign in to confirm your age",
            ),
            SignInToConfirmBot: videoData.playabilityStatus?.reason?.includes(
                "Sign in to confirm you’re not a bot",
            ),
        };
    }

    private checkSubreason(videoData: IRawResponse) {
        return {
            thisHelpsProtectCommunity: videoData.playabilityStatus?.errorScreen
                ?.playerErrorMessageRenderer
                ?.subreason?.runs?.[0]?.text
                ?.includes("This helps protect our community"),
        };
    }

    public checkInnertubeResponse(videoData: IRawResponse) {
        this.innertubeFailedRequest.inc();
        const status = this.checkStatus(videoData);

        if (status.contentCheckRequired || status.unplayable) {
            return;
        }

        if (status.loginRequired) {
            const reason = this.checkReason(videoData);

            if (reason.signInToConfirmAge) {
                return;
            }

            if (status.contentCheckRequired) {
                this.innertubeErrorReasonSignIn.inc();
                const subReason = this.checkSubreason(videoData);

                if (subReason.thisHelpsProtectCommunity) {
                    this.innertubeErrorSubreasonProtectCommunity.inc();
                } else {
                    this.innertubeErrorSubreasonUnknown.inc();
                }
            } else {
                this.innertubeErrorReasonUnknown.inc();
            }
        } else {
            this.innertubeErrorStatusUnknown.inc();
        }
    }
}

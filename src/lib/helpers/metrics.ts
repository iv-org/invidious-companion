import { IRawResponse } from "youtubei.js";
import { Counter, Registry } from "prom-client";

export class Metrics {
    private METRICS_PREFIX = "invidious_companion_";
    public register = new Registry();

    public createCounter(
        name: string,
        help?: string,
        labels?: string[],
    ): Counter {
        return new Counter({
            name: `${this.METRICS_PREFIX}${name}`,
            help: help || "No help has been provided for this metric",
            registers: [this.register],
            labelNames: Array.isArray(labels) ? labels : [],
        });
    }

    public potokenGenerationFailure = this.createCounter(
        "potoken_generation_failure_total",
        "Number of times that the PoToken generation job has failed for whatever reason",
    );

    private innertubeErrorStatusLoginRequired = this.createCounter(
        "innertube_error_status_loginRequired_total",
        'Number of times that the status "LOGIN_REQUIRED" has been returned by Innertube API',
    );

    private innertubeErrorStatusUnknown = this.createCounter(
        "innertube_error_status_unknown_total",
        "Number of times that an unknown status has been returned by Innertube API",
        ["error"],
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
        ["error"],
    );

    private innertubeErrorSubreasonUnknown = this.createCounter(
        "innertube_error_subreason_unknown_total",
        "Number of times that an unknown subreason has been returned by the Innertube API",
        ["error"],
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
        const status = videoData.playabilityStatus?.status;

        interface Error {
            unplayable: boolean;
            contentCheckRequired: boolean;
            loginRequired: boolean;
            liveStreamOffline: boolean;
            unknown: string | undefined;
        }

        const error: Error = {
            unplayable: false,
            contentCheckRequired: false,
            loginRequired: false,
            liveStreamOffline: false,
            unknown: undefined,
        };

        switch (status) {
            case "UNPLAYABLE":
                error.unplayable = true;
                return error;
            // Sensitive content videos
            // Example video id: `VuSU7PcEKpU`
            case "CONTENT_CHECK_REQUIRED":
                error.contentCheckRequired = true;
                return error;
            case "LOGIN_REQUIRED":
                error.loginRequired = true;
                return error;
            // Livestreams
            case "LIVE_STREAM_OFFLINE":
                error.liveStreamOffline = true;
                return error;
            default:
                error.unknown = status;
                return error;
        }
    }

    private checkReason(videoData: IRawResponse) {
        // On specific status like `CONTENT_CHECK_REQUIRED`, the reason is
        // contained inside `errorScreen`, just like how we check subReason.
        const reason = videoData.playabilityStatus?.reason ||
            videoData.playabilityStatus?.errorScreen
                ?.playerErrorMessageRenderer
                ?.reason?.simpleText;

        interface Error {
            signInToConfirmAge: boolean;
            signInToConfirmBot: boolean;
            selfHarmTopics: boolean;
            liveStreamOffline: boolean;
            liveEventWillBegin: boolean;
            premiere: boolean;
            privateVideo: boolean;
            unknown: string | undefined;
        }

        const error: Error = {
            signInToConfirmAge: false,
            signInToConfirmBot: false,
            selfHarmTopics: false,
            liveStreamOffline: false,
            liveEventWillBegin: false,
            premiere: false,
            privateVideo: false,
            unknown: undefined,
        };

        switch (true) {
            case reason?.includes("Sign in to confirm you’re not a bot"):
                error.signInToConfirmBot = true;
                return error;
            // Age restricted videos
            case reason?.includes("Sign in to confirm your age"):
                error.signInToConfirmAge = true;
                return error;
            // For videos with playabilityStatus.status == `CONTENT_CHECK_REQUIRED`
            case reason?.includes(
                "The following content may contain suicide or self-harm topics",
            ):
                error.selfHarmTopics = true;
                return error;
            // Offline Livestreams
            case reason?.includes("Offline."):
                error.liveStreamOffline = true;
                return error;
            // Livestreams that are about to start
            case reason?.includes(
                "This live event will begin in a few moments",
            ):
                error.liveEventWillBegin = true;
                return error;
            case reason?.includes("Premiere will begin shortly") ||
                reason?.includes("Premieres in"):
                error.premiere = true;
                return error;
            case reason?.includes("Private video"):
                error.privateVideo = true;
                return error;
            default:
                error.unknown = reason;
                return error;
        }
    }

    private checkSubreason(videoData: IRawResponse) {
        const subReason = videoData.playabilityStatus?.errorScreen
            ?.playerErrorMessageRenderer
            ?.subreason?.runs?.[0]?.text;

        interface Error {
            thisHelpsProtectCommunity: boolean;
            thisVideoMayBeInnapropiate: boolean;
            viewerDiscretionAdvised: boolean;
            unknown: string | undefined;
        }

        const error: Error = {
            thisHelpsProtectCommunity: false,
            thisVideoMayBeInnapropiate: false,
            viewerDiscretionAdvised: false,
            unknown: undefined,
        };

        switch (true) {
            case subReason?.includes("This helps protect our community"):
                error.thisHelpsProtectCommunity = true;
                return error;
            // Age restricted videos
            case subReason?.includes(
                "This video may be inappropriate for some users",
            ):
                error.thisVideoMayBeInnapropiate = true;
                return error;
            // For videos with playabilityStatus.status == `CONTENT_CHECK_REQUIRED`
            case subReason?.includes(
                "Viewer discretion is advised",
            ):
                error.viewerDiscretionAdvised = true;
                return error;
            default:
                error.unknown = subReason;
                return error;
        }
    }

    public checkInnertubeResponse(videoData: IRawResponse) {
        this.innertubeFailedRequest.inc();

        const status = this.checkStatus(videoData);
        if (
            status.contentCheckRequired ||
            status.unplayable ||
            status.liveStreamOffline
        ) return;

        if (status?.unknown) {
            this.innertubeErrorStatusUnknown.labels({
                error: status.unknown,
            }).inc();
        }

        const reason = this.checkReason(videoData);
        if (
            reason.signInToConfirmAge ||
            reason.liveStreamOffline ||
            reason.liveEventWillBegin ||
            reason.premiere ||
            reason.privateVideo
        ) return;

        if (reason.unknown) {
            this.innertubeErrorReasonUnknown.labels({
                error: reason.unknown,
            }).inc();
        }

        // On specific `playabilityStatus.status` like `CONTENT_CHECK_REQUIRED`,
        // `subReason` doesn't come with a `playabilityStatus.reason`
        // key. So we need to check this separately from `reason`
        const subReason = this.checkSubreason(videoData);
        if (subReason.unknown) {
            this.innertubeErrorSubreasonUnknown.labels({
                error: subReason.unknown,
            }).inc();
        }

        if (status.loginRequired) {
            this.innertubeErrorStatusLoginRequired.inc();

            if (reason.signInToConfirmBot) {
                this.innertubeErrorReasonSignIn.inc();

                if (subReason.thisHelpsProtectCommunity) {
                    this.innertubeErrorSubreasonProtectCommunity.inc();
                }
            }
        }
    }
}

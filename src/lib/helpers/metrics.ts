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

    public videoplaybackForbidden = this.createCounter(
        "videoplayback_forbidden_total",
        'Number of times YouTube\'s /videoplayback endpoint returns a "403" HTTP status code',
        ["method"],
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

        const map: { [key: string]: Exclude<keyof Error, "unknown"> } = {
            "UNPLAYABLE": "unplayable",
            // Sensitive content videos
            "CONTENT_CHECK_REQUIRED": "contentCheckRequired",
            /**
             * Age restricted videos
             * Private videos (maybe)
             */
            "LOGIN_REQUIRED": "loginRequired",
            // Livestreams
            "LIVE_STREAM_OFFLINE": "liveStreamOffline",
        };

        if (map[status as string]) {
            error[map[status as string]] = true;
        } else {
            error.unknown = status;
        }

        return error;
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

        const map: { [key: string]: Exclude<keyof Error, "unknown"> } = {
            "Sign in to confirm you’re not a bot": "signInToConfirmBot",
            // Age restricted videos
            "Sign in to confirm your age": "signInToConfirmAge",
            // Sensitive content videos
            "The following content may contain suicide or self-harm topics":
                "selfHarmTopics",
            // Livestreams
            "Offline.": "liveStreamOffline",
            "This live event will begin in a few moments": "liveEventWillBegin",
            // Premieres
            "Premiere will begin shortly": "premiere",
            "Premieres in": "premiere",
            // Private videos
            "Private video": "privateVideo",
        };

        for (const [key, e] of Object.entries(map)) {
            if (reason?.includes(key)) {
                error[e] = true;
                return error;
            }
        }

        error.unknown = reason;
        return error;
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

        const map: { [key: string]: Exclude<keyof Error, "unknown"> } = {
            "This helps protect our community": "thisHelpsProtectCommunity",
            // Age restricted videos
            "This video may be inappropriate for some users":
                "thisVideoMayBeInnapropiate",
            // Sensitive content videos
            "Viewer discretion is advised": "viewerDiscretionAdvised",
        };

        for (const [key, e] of Object.entries(map)) {
            if (subReason?.includes(key)) {
                error[e] = true;
                return error;
            }
        }

        error.unknown = subReason;
        return error;
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

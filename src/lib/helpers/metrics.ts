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

    public playerErrors = this.createCounter(
        "youtubejs_player_errors_total",
        'Number of times a PlayerError error has been returned by the Youtube.JS library. This includes deciphering errors, signature errors and "nsig" errors.',
        ["error"],
    );

    public checkStatus(
        { videoData, status }: { videoData?: IRawResponse; status?: string },
    ) {
        if (videoData) {
            // deno-fmt-ignore
            status = 
                videoData.playabilityStatus?.status!;
        }

        interface Error {
            unplayable: boolean;
            contentCheckRequired: boolean;
            loginRequired: boolean;
            liveStreamOffline: boolean;
        }

        const error: Error = {
            unplayable: false,
            contentCheckRequired: false,
            loginRequired: false,
            liveStreamOffline: false,
        };

        const map: { [key: string]: keyof Error } = {
            "UNPLAYABLE": "unplayable",
            // Innertube error            // Sensitive content videos
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
            this.innertubeErrorStatusUnknown.labels({
                error: status,
            }).inc();
            return;
        }

        if (error.loginRequired) {
            this.innertubeErrorStatusLoginRequired.inc();
            return;
        }
    }

    public checkReason(
        { videoData, reason }: { videoData?: IRawResponse; reason?: string },
    ) {
        if (videoData) {
            // On specific status like `CONTENT_CHECK_REQUIRED`, the reason is
            // contained inside `errorScreen`, just like how we check subReason.
            const playabilityStatus = videoData.playabilityStatus;
            // deno-fmt-ignore
            reason = 
                playabilityStatus?.reason
                ||
                playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText;
        }

        interface Error {
            signInToConfirmAge: boolean;
            signInToConfirmBot: boolean;
            selfHarmTopics: boolean;
            liveStreamOffline: boolean;
            liveEventWillBegin: boolean;
            premiere: boolean;
            privateVideo: boolean;
        }

        const error: Error = {
            signInToConfirmAge: false,
            signInToConfirmBot: false,
            selfHarmTopics: false,
            liveStreamOffline: false,
            liveEventWillBegin: false,
            premiere: false,
            privateVideo: false,
        };

        const map: { [key: string]: keyof Error } = {
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

        let isKnownError = false;
        for (const [key, e] of Object.entries(map)) {
            if (reason?.includes(key)) {
                error[e] = true;
                isKnownError = true;
                break;
            }
        }

        if (!isKnownError) {
            this.innertubeErrorReasonUnknown.labels({
                error: reason,
            }).inc();
            return;
        }

        if (error.signInToConfirmBot) {
            this.innertubeErrorReasonSignIn.inc();
            return;
        }
    }

    public checkSubreason(
        { videoData, subReason }: {
            videoData?: IRawResponse;
            subReason?: string;
        },
    ) {
        if (videoData) {
            const errorScreen = videoData.playabilityStatus?.errorScreen;
            // deno-fmt-ignore
            subReason = 
                errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.text;
        }

        interface Error {
            thisHelpsProtectCommunity: boolean;
            thisVideoMayBeInnapropiate: boolean;
            viewerDiscretionAdvised: boolean;
            accountTerminated: boolean;
        }

        const error: Error = {
            thisHelpsProtectCommunity: false,
            thisVideoMayBeInnapropiate: false,
            viewerDiscretionAdvised: false,
            accountTerminated: false,
        };

        const map: { [key: string]: keyof Error } = {
            "This helps protect our community": "thisHelpsProtectCommunity",
            // Age restricted videos
            "This video may be inappropriate for some users":
                "thisVideoMayBeInnapropiate",
            // Sensitive content videos
            "Viewer discretion is advised": "viewerDiscretionAdvised",
        };

        let isKnownError = false;
        for (const [key, e] of Object.entries(map)) {
            if (subReason?.includes(key)) {
                error[e] = true;
                isKnownError = true;
                break;
            }
        }

        if (!isKnownError) {
            this.innertubeErrorSubreasonUnknown.labels({
                error: subReason,
            }).inc();
            return;
        }

        if (error.thisHelpsProtectCommunity) {
            this.innertubeErrorSubreasonProtectCommunity.inc();
            return;
        }
    }

    public checkInnertubeResponse(videoData: IRawResponse) {
        this.innertubeFailedRequest.inc();

        this.checkStatus({ videoData: videoData });
        this.checkReason({ videoData: videoData });

        // On specific `playabilityStatus.status` like `CONTENT_CHECK_REQUIRED`,
        // `subReason` doesn't come with a `playabilityStatus.reason`
        // key. So we need to check this separately from `reason`
        this.checkSubreason({ videoData: videoData });
    }
}

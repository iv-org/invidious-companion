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

    private innertubeErrorReasonVpnProxyDetected = this.createCounter(
        "innertube_error_reason_VpnProxyDetected_total",
        'Number of times that the message "VPN/Proxy Detected" has been returned by Innertube API',
    );

    private innertubeErrorSubreasonProtectCommunity = this.createCounter(
        "innertube_error_subreason_ProtectCommunity_total",
        'Number of times that the message "This helps protect our community." has been returned by Innertube API',
    );

    private innertubeErrorSubreasonVpnProxyDetected = this.createCounter(
        "innertube_error_subreason_VpnProxyDetected_total",
        'Number of times that the message "To continue, turn off your VPN/Proxy. This will allow YouTube to locate the best content." has been returned by Innertube API',
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

        if (status == undefined) return;

        const error = {
            unplayable: false,
            error: false,
            loginRequired: false,
            generic: false,
        };
        type Error = typeof error;

        const map: { [key: string]: keyof Error } = {
            "UNPLAYABLE": "unplayable",
            // Innertube error
            "ERROR": "error",
            /**
             * Age restricted videos
             * Private videos (maybe)
             */
            "LOGIN_REQUIRED": "loginRequired",
            // Sensitive content videos
            "CONTENT_CHECK_REQUIRED": "generic",
            // Livestreams
            "LIVE_STREAM_OFFLINE": "generic",
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

        if (reason == undefined) return;

        const error = {
            signInToConfirmAge: false,
            signInToConfirmBot: false,
            vpnProxy: false,
            generic: false,
        };
        type Error = typeof error;

        // deno-fmt-ignore
        const map: { [key: string]: keyof Error } = {
            // Youtube blockage
                "Sign in to confirm you’re not a bot": "signInToConfirmBot",
            // Age restricted videos
                "Sign in to confirm your age": "signInToConfirmAge",
            // VPN/Proxy
                "VPN/Proxy Detected": "vpnProxy",
            // Sensitive content videos
                "The following content may contain suicide or self-harm topics": "generic",
            // Livestreams
                "This live event will begin in": "generic",
            // Premieres
                "Premiere will begin shortly": "generic",
                "Premieres in": "generic",
            // Private videos
                "Private video": "generic",
            // Unavailable videos
                "Video unavailable": "generic",
            // Removed videos
                // Videos removed because of a violation of the community guidelines or TOS
                "This video has been removed for violating YouTube's": "generic",
                "This video has been removed by the uploader": "generic",
            // Members only
                "This video is available to this channel's members on level": "generic",
            // Video being processed
                "We're processing this video. Check back later": "generic",

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

        if (error.vpnProxy) {
            this.innertubeErrorReasonVpnProxyDetected.inc();
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
                errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.text
                ||
                // On specific status like `LOGIN_REQUIRED` with reason
                // "Private video", the subReason is contained inside
                // `simpleText` instead of `runs?.[0]?.text`
                errorScreen?.playerErrorMessageRenderer?.subreason?.simpleText;
        }

        if (subReason == undefined) return;

        const error = {
            thisHelpsProtectCommunity: false,
            thisVideoMayBeInnapropiate: false,
            vpnProxy: false,
            generic: false,
        };
        type Error = typeof error;

        // deno-fmt-ignore
        const map: { [key: string]: keyof Error } = {
            // Youtube blockage
                "This helps protect our community": "thisHelpsProtectCommunity",
            // Age restricted videos
                "This video may be inappropriate for some users": "thisVideoMayBeInnapropiate",
            // VPN/Proxy
                "To continue, turn off your VPN/Proxy. This will allow YouTube to locate the best content.": "vpnProxy",
            // Content not available (error that generally appears when companion is not able to generate a potoken)
                "This content isn't available, try again later.": "generic",
            // Sensitive content videos
                "Viewer discretion is advised": "generic",
            // Unavailable videos
                "This video is not available": "generic",
                "This video is no longer available because the YouTube account associated with this video has been terminated": "generic",
                "The uploader has not made this video available.": "generic",
            // Private videos
                "If the owner of this video has granted you access": "generic",
                "Sign in if you've been granted access to this video": "generic",
            // Geo restricted videos
                "This video is not available in your country": "generic",
                "The uploader has not made this video available in your country": "generic",
            // Privacy/Trademark complaint
                "This content is not available in your country due to a": "generic",
            // Unknown
                "The video you have requested has been rated": "generic"
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

        if (error.vpnProxy) {
            this.innertubeErrorSubreasonVpnProxyDetected.inc();
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

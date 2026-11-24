import { ApiResponse, Innertube } from "youtubei.js";
import NavigationEndpoint from "youtubei.js/NavigationEndpoint";
import type { TokenMinter } from "../jobs/potoken.ts";

import type { Config } from "./config.ts";

function callWatchEndpoint(
    videoId: string,
    innertubeClient: Innertube,
    innertubeClientType: string,
    contentPoToken: string,
) {
    const watch_endpoint = new NavigationEndpoint({
        watchEndpoint: {
            videoId: videoId,
            // Allow companion to gather sensitive content videos like
            // `VuSU7PcEKpU`
            racyCheckOk: true,
            contentCheckOk: true,
        },
    });

    return watch_endpoint.call(
        innertubeClient.actions,
        {
            playbackContext: {
                contentPlaybackContext: {
                    vis: 0,
                    splay: false,
                    lactMilliseconds: "-1",
                    signatureTimestamp: innertubeClient.session.player
                        ?.signature_timestamp,
                },
            },
            serviceIntegrityDimensions: {
                poToken: contentPoToken,
            },
            client: innertubeClientType,
        },
    );
}

// WEB can refuse a video without any streaming data, so the old check never ran.
// ANDROID is included because it often still returns usable formats.
const FALLBACK_CLIENTS = ["TV_SIMPLY", "ANDROID", "ANDROID_VR", "MWEB"];

type PlayerData = ApiResponse["data"];

function getFormats(data: PlayerData) {
    return [
        ...(data?.streamingData?.formats ?? []),
        ...(data?.streamingData?.adaptiveFormats ?? []),
    ];
}

// youtubePlayerHandling deciphers every adaptive format, so skip clients with
// SABR-only formats (no url/signatureCipher).
function adaptiveFormatsUsable(data: PlayerData): boolean {
    const adaptive = data?.streamingData?.adaptiveFormats ?? [];
    return adaptive.length > 0 &&
        adaptive.every((format) =>
            Boolean(format?.url || format?.signatureCipher)
        );
}

function isPlayable(data: PlayerData): boolean {
    return data?.playabilityStatus?.status === "OK";
}

export const youtubePlayerReq = async (
    innertubeClient: Innertube,
    videoId: string,
    config: Config,
    tokenMinter: TokenMinter,
): Promise<ApiResponse> => {
    const innertubeClientOauthEnabled = config.youtube_session.oauth_enabled;

    let innertubeClientUsed = "WEB";
    if (innertubeClientOauthEnabled) {
        innertubeClientUsed = "TV";
    }

    const contentPoToken = await tokenMinter(videoId);

    const youtubePlayerResponse = await callWatchEndpoint(
        videoId,
        innertubeClient,
        innertubeClientUsed,
        contentPoToken,
    );

    const data = youtubePlayerResponse.data;
    const primaryUsable = isPlayable(data) && getFormats(data).length > 0 &&
        adaptiveFormatsUsable(data) &&
        // Keep the existing behavior of falling back when WEB only provides
        // signatureCipher-protected adaptive formats without a plain URL.
        Boolean(data?.streamingData?.adaptiveFormats?.[0]?.url);

    if (!innertubeClientOauthEnabled && !primaryUsable) {
        console.log(
            "[WARNING] No playable stream from the primary YT client. Falling back to other YT clients.",
        );

        for await (const innertubeClientType of FALLBACK_CLIENTS) {
            console.log(
                `[WARNING] Trying fallback YT client ${innertubeClientType}`,
            );
            let fallbackResponse: ApiResponse;
            try {
                fallbackResponse = await callWatchEndpoint(
                    videoId,
                    innertubeClient,
                    innertubeClientType,
                    contentPoToken,
                );
            } catch (error) {
                console.log(
                    `[WARNING] YT client ${innertubeClientType} failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
                continue;
            }
            const fallbackData = fallbackResponse.data;

            if (
                !isPlayable(fallbackData) || !getFormats(fallbackData).length ||
                !adaptiveFormatsUsable(fallbackData)
            ) {
                continue;
            }

            // Use the fallback's verdict as well: the primary response may
            // have been UNPLAYABLE with no videoDetails of its own.
            data.playabilityStatus = fallbackData.playabilityStatus;
            if (!data.videoDetails && fallbackData.videoDetails) {
                data.videoDetails = fallbackData.videoDetails;
            }
            if (!data.streamingData) {
                data.streamingData = { ...fallbackData.streamingData! };
            } else {
                const fallbackFormats = fallbackData.streamingData?.formats;
                if (fallbackFormats?.length) {
                    data.streamingData.formats = fallbackFormats;
                }
                data.streamingData.adaptiveFormats = fallbackData.streamingData!
                    .adaptiveFormats!;
            }
            console.log(
                `[INFO] Using stream from fallback YT client ${innertubeClientType}`,
            );
            break;
        }
    }

    return youtubePlayerResponse;
};

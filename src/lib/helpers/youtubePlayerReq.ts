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
        watchEndpoint: { videoId: videoId },
    });

    return watch_endpoint.call(
        innertubeClient.actions,
        {
            playbackContext: {
                contentPlaybackContext: {
                    vis: 0,
                    splay: false,
                    lactMilliseconds: "-1",
                    signatureTimestamp: innertubeClient.session.player?.sts,
                },
            },
            serviceIntegrityDimensions: {
                poToken: contentPoToken,
            },
            client: innertubeClientType,
        },
    );
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

    // Check if the first adaptive format URL is undefined, if it is then fallback to multiple YT clients

    if (
        !innertubeClientOauthEnabled &&
        youtubePlayerResponse.data.streamingData &&
        youtubePlayerResponse.data.streamingData.adaptiveFormats[0].url ===
            undefined
    ) {
        console.log(
            "[WARNING] No URLs found for adaptive formats. Falling back to other YT clients.",
        );
        const innertubeClientsTypeFallback = ["MWEB", "TV"];

        for await (const innertubeClientType of innertubeClientsTypeFallback) {
            console.log(
                `[WARNING] Trying fallback YT client ${innertubeClientType}`,
            );
            const youtubePlayerResponseFallback = await callWatchEndpoint(
                videoId,
                innertubeClient,
                innertubeClientType,
                contentPoToken,
            );
            if (
                youtubePlayerResponseFallback.data.streamingData &&
                youtubePlayerResponseFallback.data.streamingData
                    .adaptiveFormats[0].url
            ) {
                youtubePlayerResponse.data.streamingData.adaptiveFormats =
                    youtubePlayerResponseFallback.data.streamingData
                        .adaptiveFormats;
                break;
            }
        }
    }

    return youtubePlayerResponse;
};

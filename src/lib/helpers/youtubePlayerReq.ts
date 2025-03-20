import { ApiResponse, Innertube } from "youtubei.js";
import NavigationEndpoint from "youtubei.js/NavigationEndpoint";
import type { TokenMinter } from "../jobs/potoken.ts";

import type { Config } from "./config.ts";

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

    const watch_endpoint = new NavigationEndpoint({
        watchEndpoint: { videoId: videoId },
    });

    const contentPoToken = await tokenMinter(videoId);

    return watch_endpoint.call(innertubeClient.actions, {
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
        client: innertubeClientUsed,
    });
};

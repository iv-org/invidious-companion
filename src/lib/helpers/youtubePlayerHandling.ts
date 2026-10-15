import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { Innertube, Utils, YT } from "youtubei.js";
import type { ApiResponse } from "youtubei.js";
import { Metrics } from "../helpers/metrics.ts";
import type { TokenMinter } from "../jobs/potoken.ts";
import { youtubePlayerReq } from "./youtubePlayerReq.ts";
const generateRandomString = Utils.generateRandomString;

import type { Config } from "./config.ts";
import { getKv } from "./kv.ts";

export const youtubePlayerParsing = async ({
    innertubeClient,
    videoId,
    config,
    tokenMinter,
    metrics,
    overrideCache = false,
}: {
    innertubeClient: Innertube;
    videoId: string;
    config: Config;
    tokenMinter: TokenMinter;
    metrics: Metrics | undefined;
    overrideCache?: boolean;
}): Promise<object> => {
    const cacheEnabled = overrideCache ? false : config.cache.enabled;
    const kv = await getKv(config);

    const videoCached = (await kv.get(["video_cache", videoId]))
        .value as Uint8Array;

    if (videoCached != null && cacheEnabled) {
        return JSON.parse(
            new TextDecoder().decode(brotliDecompressSync(videoCached)),
        );
    } else {
        const youtubePlayerResponse = await youtubePlayerReq(
            innertubeClient,
            videoId,
            config,
            tokenMinter,
        );
        const videoData = youtubePlayerResponse.data;

        if (videoData.playabilityStatus?.status === "ERROR") {
            return videoData;
        }

        const video = new YT.VideoInfo(
            [youtubePlayerResponse],
            innertubeClient.actions,
            generateRandomString(16),
        );

        const streamingData = video.streaming_data;

        // Modify the original YouTube response to include deciphered URLs
        if (streamingData && videoData && videoData.streamingData) {
            const ecatcherServiceTracking = videoData.responseContext
                ?.serviceTrackingParams?.find((o: { service?: string }) => o.service === "ECATCHER");
            const clientNameUsed = ecatcherServiceTracking?.params?.find((
                o: { key?: string },
            ) => o.key === "client.name");
            // no need to decipher on IOS nor ANDROID
            if (
                !clientNameUsed?.value?.includes("IOS")
                && !clientNameUsed?.value?.includes("ANDROID")
            ) {
                for (
                    let index = 0;
                    index < streamingData.formats.length;
                    index++
                ) {
                    const format = videoData.streamingData.formats[index];

                    format.url = await streamingData.formats[index]
                        .decipher(
                            innertubeClient.session.player,
                        );
                    if (format.signatureCipher !== undefined) {
                        delete format.signatureCipher;
                    }
                    if (format.url.includes("alr=yes")) {
                        format.url = format.url.replace("alr=yes", "alr=no");
                    } else {
                        format.url += "&alr=no";
                    }
                }
                for (
                    let index = 0;
                    index < streamingData.adaptive_formats.length;
                    index++
                ) {
                    const format = videoData.streamingData.adaptiveFormats[index];

                    format.url = await streamingData.adaptive_formats[index]
                        .decipher(
                            innertubeClient.session.player,
                        );
                    if (format.signatureCipher !== undefined) {
                        delete format.signatureCipher;
                    }
                    if (format.url.includes("alr=yes")) {
                        format.url = format.url.replace("alr=yes", "alr=no");
                    } else {
                        format.url += "&alr=no";
                    }
                }
            }
        }

        const videoOnlyNecessaryInfo = ((
            {
                captions,
                playabilityStatus,
                storyboards,
                streamingData,
                videoDetails,
                microformat,
            },
        ) => ({
            captions,
            playabilityStatus,
            storyboards,
            streamingData,
            videoDetails,
            microformat,
        }))(videoData);

        if (videoData.playabilityStatus?.status == "OK") {
            metrics?.innertubeSuccessfulRequest.inc();
            if (cacheEnabled) {
                (async () => {
                    await kv.set(
                        ["video_cache", videoId],
                        brotliCompressSync(
                            new TextEncoder().encode(
                                JSON.stringify(videoOnlyNecessaryInfo),
                            ),
                        ),
                        {
                            expireIn: 1000 * 60 * 60,
                        },
                    );
                })();
            }
        } else {
            metrics?.checkInnertubeResponse(videoData);
        }

        return videoOnlyNecessaryInfo;
    }
};

export const youtubeVideoInfo = (
    innertubeClient: Innertube,
    youtubePlayerResponseJson: object,
): YT.VideoInfo => {
    const playerResponse = {
        success: true,
        status_code: 200,
        data: youtubePlayerResponseJson,
    } as ApiResponse;
    return new YT.VideoInfo(
        [playerResponse],
        innertubeClient.actions,
        "",
    );
};

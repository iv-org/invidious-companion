import { ApiResponse, Innertube, YT } from "youtubei.js";
import { generateRandomString } from "youtubei.js/Utils";
import { compress, decompress } from "brotli";
import type { TokenMinter } from "../jobs/potoken.ts";
import { Metrics } from "../helpers/metrics.ts";
let youtubePlayerReqLocation = "youtubePlayerReq";
if (Deno.env.get("YT_PLAYER_REQ_LOCATION")) {
    if (Deno.env.has("DENO_COMPILED")) {
        youtubePlayerReqLocation = Deno.mainModule.replace("src/main.ts", "") +
            Deno.env.get("YT_PLAYER_REQ_LOCATION");
    } else {
        youtubePlayerReqLocation = Deno.env.get(
            "YT_PLAYER_REQ_LOCATION",
        ) as string;
    }
}
const { youtubePlayerReq } = await import(youtubePlayerReqLocation);

import type { Config } from "./config.ts";

const kv = await Deno.openKv();

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

    const videoCached = (await kv.get(["video_cache", videoId]))
        .value as Uint8Array;

    if (videoCached != null && cacheEnabled) {
        return JSON.parse(new TextDecoder().decode(decompress(videoCached)));
    } else {
        const youtubePlayerResponse = await youtubePlayerReq(
            innertubeClient,
            videoId,
            config,
            tokenMinter,
        );
        const videoData = youtubePlayerResponse.data;

        if (videoData.playabilityStatus.status === "ERROR") {
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
                ?.serviceTrackingParams.find((o: { service: string }) =>
                    o.service === "ECATCHER"
                );
            const clientNameUsed = ecatcherServiceTracking?.params?.find((
                o: { key: string },
            ) => o.key === "client.name");
            // no need to decipher on IOS nor ANDROID
            if (
                !clientNameUsed?.value.includes("IOS") &&
                !clientNameUsed?.value.includes("ANDROID")
            ) {
                for (const [index, format] of streamingData.formats.entries()) {
                    videoData.streamingData.formats[index].url = await format
                        .decipher(
                            innertubeClient.session.player,
                        );
                    if (
                        videoData.streamingData.formats[index]
                            .signatureCipher !==
                            undefined
                    ) {
                        delete videoData.streamingData.formats[index]
                            .signatureCipher;
                    }
                    if (
                        videoData.streamingData.formats[index].url.includes(
                            "alr=yes",
                        )
                    ) {
                        videoData.streamingData.formats[index].url.replace(
                            "alr=yes",
                            "alr=no",
                        );
                    } else {
                        videoData.streamingData.formats[index].url += "&alr=no";
                    }
                }
                for (
                    const [index, adaptive_format] of streamingData
                        .adaptive_formats
                        .entries()
                ) {
                    videoData.streamingData.adaptiveFormats[index].url =
                        await adaptive_format
                            .decipher(
                                innertubeClient.session.player,
                            );
                    if (
                        videoData.streamingData.adaptiveFormats[index]
                            .signatureCipher !==
                            undefined
                    ) {
                        delete videoData.streamingData.adaptiveFormats[index]
                            .signatureCipher;
                    }
                    if (
                        videoData.streamingData.adaptiveFormats[index].url
                            .includes("alr=yes")
                    ) {
                        videoData.streamingData.adaptiveFormats[index].url
                            .replace("alr=yes", "alr=no");
                    } else {
                        videoData.streamingData.adaptiveFormats[index].url +=
                            "&alr=no";
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
                        compress(
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

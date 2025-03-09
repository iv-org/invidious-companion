import { Hono } from "hono";
import { FormatUtils } from "youtubei.js";
import {
    youtubePlayerParsing,
    youtubeVideoInfo,
} from "../../lib/helpers/youtubePlayerHandling.ts";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";
import { HTTPException } from "hono/http-exception";

const dashManifest = new Hono();

dashManifest.get("/:videoId", async (c) => {
    const { videoId } = c.req.param();
    const { check, local } = c.req.query();
    c.header("access-control-allow-origin", "*");

    const innertubeClient = c.get("innertubeClient");
    const konfigStore = c.get("konfigStore");

    if (konfigStore.get("server.verify_requests") && check == undefined) {
        throw new HTTPException(400, {
            res: new Response("No check ID."),
        });
    } else if (konfigStore.get("server.verify_requests") && check) {
        if (verifyRequest(check, videoId, konfigStore) === false) {
            throw new HTTPException(400, {
                res: new Response("ID incorrect."),
            });
        }
    }

    const youtubePlayerResponseJson = await youtubePlayerParsing({
        innertubeClient,
        videoId,
        konfigStore,
        tokenMinter: c.get("tokenMinter"),
    });
    const videoInfo = youtubeVideoInfo(
        innertubeClient,
        youtubePlayerResponseJson,
    );

    if (videoInfo.playability_status?.status !== "OK") {
        throw ("The video can't be played: " + videoId + " due to reason: " +
            videoInfo.playability_status?.reason);
    }

    c.header("content-type", "application/dash+xml");

    if (videoInfo.streaming_data) {
        // Invidious force quality only support one video codec at a time, using av01.
        // video.js only support MP4 not WEBM
        videoInfo.streaming_data.adaptive_formats = videoInfo
            .streaming_data.adaptive_formats
            .filter((i) => {
                if (i.mime_type.includes("mp4")) {
                    if (
                        i.has_video &&
                        JSON.stringify(
                            videoInfo.streaming_data?.adaptive_formats,
                        ).includes("av01")
                    ) {
                        if (i.mime_type.includes("av01")) {
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        return true;
                    }
                } else {
                    return false;
                }
            });

        const player_response = videoInfo.page[0];
        // TODO: fix include storyboards in DASH manifest file
        //const storyboards = player_response.storyboards;
        const captions = player_response.captions?.caption_tracks;

        const dashFile = await FormatUtils.toDash(
            videoInfo.streaming_data,
            videoInfo.page[0].video_details?.is_post_live_dvr,
            (url: URL) => {
                let dashUrl = url;
                if (local) {
                    // Can't create URL type without host part
                    dashUrl = (dashUrl.pathname + dashUrl.search + "&host=" +
                        dashUrl.host) as unknown as URL;
                    if (konfigStore.get("networking.ump") as boolean) {
                        dashUrl = dashUrl + "&ump=1" as unknown as URL;
                    }
                    return dashUrl;
                } else {
                    return dashUrl;
                }
            },
            undefined,
            videoInfo.cpn,
            undefined,
            innertubeClient.actions,
            undefined,
            captions,
            undefined,
        );
        return c.body(dashFile.replaceAll("&amp;", "&"));
    }
});

export default dashManifest;

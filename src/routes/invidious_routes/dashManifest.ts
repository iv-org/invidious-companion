import { Hono } from "hono";
import { FormatUtils } from "youtubei.js";
import {
    youtubePlayerParsing,
    youtubeVideoInfo,
} from "../../lib/helpers/youtubePlayerHandling.ts";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";
import { HTTPException } from "hono/http-exception";
import { encryptQuery } from "../../lib/helpers/encryptQuery.ts";
import { validateVideoId } from "../../lib/helpers/validateVideoId.ts";
import { TOKEN_MINTER_NOT_READY_MESSAGE } from "../../constants.ts";

// Split video AdaptationSets by codec family to prevent MEDIA_ERR_DECODE in Chromium
function splitAdaptationSetsByCodec(dashXml: string): string {
    const doc = new DOMParser().parseFromString(dashXml, "application/xml");
    const period = doc.querySelector("Period");
    if (!period) return dashXml;

    let maxId = Math.max(...[...doc.querySelectorAll("AdaptationSet")]
        .map((a) => parseInt(a.getAttribute("id") || "0", 10)));

    for (
        const adaptSet of [
            ...period.querySelectorAll('AdaptationSet[contentType="video"]'),
        ]
    ) {
        const reps = [...adaptSet.querySelectorAll("Representation")];
        const byCodec = Map.groupBy(
            reps,
            (r) => (r.getAttribute("codecs") || "").split(".")[0],
        );

        if (byCodec.size <= 1) continue;

        // Clone AdaptationSet for each codec family, keeping first in place
        let first = true;
        for (const [codec, codecReps] of byCodec) {
            if (first) {
                // Keep original, just remove other codec reps
                reps.filter((r) => !codecReps.includes(r)).forEach((r) =>
                    r.remove()
                );
                adaptSet.setAttribute(
                    "codecs",
                    codecReps[0]?.getAttribute("codecs") || "",
                );
                first = false;
            } else {
                const clone = adaptSet.cloneNode(true) as Element;
                clone.setAttribute("id", String(++maxId));
                clone.setAttribute(
                    "codecs",
                    codecReps[0]?.getAttribute("codecs") || "",
                );
                // Remove reps not in this codec group
                [...clone.querySelectorAll("Representation")]
                    .filter((r) =>
                        !codecReps.some((cr) =>
                            cr.getAttribute("id") === r.getAttribute("id")
                        )
                    )
                    .forEach((r) => r.remove());
                period.insertBefore(clone, adaptSet.nextSibling);
            }
        }
    }
    return new XMLSerializer().serializeToString(doc);
}

const dashManifest = new Hono();

dashManifest.get("/:videoId", async (c) => {
    const { videoId } = c.req.param();
    const { check, local } = c.req.query();
    c.header("access-control-allow-origin", "*");

    const innertubeClient = c.get("innertubeClient");
    const config = c.get("config");
    const metrics = c.get("metrics");
    const tokenMinter = c.get("tokenMinter");

    // Check if tokenMinter is ready (only needed when PO token is enabled)
    if (config.jobs.youtube_session.po_token_enabled && !tokenMinter) {
        throw new HTTPException(503, {
            res: new Response(TOKEN_MINTER_NOT_READY_MESSAGE),
        });
    }

    if (!validateVideoId(videoId)) {
        throw new HTTPException(400, {
            res: new Response("Invalid video ID format."),
        });
    }

    if (config.server.verify_requests && check == undefined) {
        throw new HTTPException(400, {
            res: new Response("No check ID."),
        });
    } else if (config.server.verify_requests && check) {
        if (verifyRequest(check, videoId, config) === false) {
            throw new HTTPException(400, {
                res: new Response("ID incorrect."),
            });
        }
    }

    const youtubePlayerResponseJson = await youtubePlayerParsing({
        innertubeClient,
        videoId,
        config,
        tokenMinter: tokenMinter!,
        metrics,
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
        // video.js only support MP4 not WEBM
        videoInfo.streaming_data.adaptive_formats = videoInfo
            .streaming_data.adaptive_formats
            .filter((i) => i.mime_type.includes("mp4"));

        const player_response = videoInfo.page[0];
        // TODO: fix include storyboards in DASH manifest file
        //const storyboards = player_response.storyboards;
        const captions = player_response.captions?.caption_tracks;

        const dashFile = await FormatUtils.toDash(
            videoInfo.streaming_data,
            videoInfo.page[0].video_details?.is_post_live_dvr,
            (url: URL) => {
                let dashUrl = url;
                let queryParams = new URLSearchParams(dashUrl.search);
                // Can't create URL type without host part
                queryParams.set("host", dashUrl.host);

                if (local) {
                    if (config.networking.videoplayback.ump) {
                        queryParams.set("ump", "yes");
                    }
                    if (
                        config.server.encrypt_query_params
                    ) {
                        const publicParams = [...queryParams].filter(([key]) =>
                            ["pot", "ip"].includes(key) === false
                        );
                        const privateParams = [...queryParams].filter(([key]) =>
                            ["pot", "ip"].includes(key) === true
                        );
                        const encryptedParams = encryptQuery(
                            JSON.stringify(privateParams),
                            config,
                        );
                        queryParams = new URLSearchParams(publicParams);
                        queryParams.set("enc", "true");
                        queryParams.set("data", encryptedParams);
                    }
                    dashUrl =
                        (config.server.base_path + dashUrl.pathname + "?" +
                            queryParams.toString()) as unknown as URL;
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
        // Remove SupplementalProperty elements that cause issues in some players
        const supPropRe =
            /<SupplementalProperty schemeIdUri="urn:mpeg:mpegB:[^>]*\/>/gi;
        let modDashFile = dashFile.replace(supPropRe, "");

        // Split video AdaptationSets by codec family to prevent codec switching
        // within the same AdaptationSet (which causes MEDIA_ERR_DECODE in Chromium)
        modDashFile = splitAdaptationSetsByCodec(modDashFile);

        return c.body(modDashFile);
    }
});

export default dashManifest;

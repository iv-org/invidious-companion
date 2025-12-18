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

// Extract codec family from a codecs string (e.g., "avc1.4d401f" -> "avc1")
function getCodecFamily(codecs: string): string {
    if (codecs.startsWith("avc1") || codecs.startsWith("avc3")) return "avc";
    if (codecs.startsWith("hev1") || codecs.startsWith("hvc1")) return "hevc";
    if (codecs.startsWith("vp09") || codecs.startsWith("vp9")) return "vp9";
    if (codecs.startsWith("av01") || codecs.startsWith("av1")) return "av1";
    if (codecs.startsWith("mp4a")) return "mp4a";
    if (codecs.startsWith("opus")) return "opus";
    return codecs.split(".")[0];
}

// Split video AdaptationSets by codec family to prevent codec switching issues
function splitAdaptationSetsByCodec(dashXml: string): string {
    // Match video AdaptationSets (contentType="video")
    const videoAdaptationSetRegex =
        /<AdaptationSet[^>]*contentType="video"[^>]*>([\s\S]*?)<\/AdaptationSet>/gi;

    let maxId = 0;
    // Find the highest existing AdaptationSet id
    const idMatches = dashXml.matchAll(/<AdaptationSet[^>]*id="(\d+)"/gi);
    for (const match of idMatches) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
    }

    return dashXml.replace(videoAdaptationSetRegex, (fullMatch) => {
        // Extract all Representation elements
        const representationRegex =
            /<Representation[^>]*>([\s\S]*?)<\/Representation>/gi;
        const representations: { xml: string; codecs: string }[] = [];

        let repMatch;
        while ((repMatch = representationRegex.exec(fullMatch)) !== null) {
            const repXml = repMatch[0];
            // Extract codecs attribute from Representation
            const codecsMatch = repXml.match(/codecs="([^"]+)"/);
            const codecs = codecsMatch ? codecsMatch[1] : "unknown";
            representations.push({ xml: repXml, codecs });
        }

        // Group representations by codec family
        const codecGroups = new Map<string, string[]>();
        for (const rep of representations) {
            const family = getCodecFamily(rep.codecs);
            if (!codecGroups.has(family)) {
                codecGroups.set(family, []);
            }
            codecGroups.get(family)!.push(rep.xml);
        }

        // If only one codec family, return unchanged
        if (codecGroups.size <= 1) {
            return fullMatch;
        }

        // Extract AdaptationSet attributes (everything before first child element)
        const adaptationSetOpenTag = fullMatch.match(
            /<AdaptationSet[^>]*>/,
        )?.[0];
        if (!adaptationSetOpenTag) {
            return fullMatch;
        }

        // Extract non-Representation children (like ContentProtection, Role, etc.)
        const nonRepChildren: string[] = [];
        const nonRepRegex =
            /<(?!Representation|\/AdaptationSet)[A-Z][^>]*(?:\/>|>[\s\S]*?<\/[^>]+>)/gi;
        let nonRepMatch;
        while ((nonRepMatch = nonRepRegex.exec(fullMatch)) !== null) {
            // Exclude Representation elements
            if (!nonRepMatch[0].startsWith("<Representation")) {
                nonRepChildren.push(nonRepMatch[0]);
            }
        }

        // Create separate AdaptationSets for each codec family
        const newAdaptationSets: string[] = [];
        for (const [codecFamily, reps] of codecGroups) {
            maxId++;
            // Update the id and codecs in the AdaptationSet tag
            let newOpenTag = adaptationSetOpenTag
                .replace(/id="\d+"/, `id="${maxId}"`)
                .replace(
                    /codecs="[^"]+"/,
                    `codecs="${reps[0].match(/codecs="([^"]+)"/)?.[1] || ""}"`,
                );

            const newAdaptationSet = `${newOpenTag}\n${
                nonRepChildren.join("\n")
            }\n${reps.join("\n")}\n</AdaptationSet>`;
            newAdaptationSets.push(newAdaptationSet);
        }

        return newAdaptationSets.join("\n");
    });
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

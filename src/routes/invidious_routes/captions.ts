import { Hono } from "hono";
import type { HonoVariables } from "../../lib/types/HonoVariables.ts";
import { Store } from "@willsoto/node-konfig-core";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";
import {
    youtubePlayerParsing,
    youtubeVideoInfo,
} from "../../lib/helpers/youtubePlayerHandling.ts";
import type { CaptionTrackData } from "youtubei.js/PlayerCaptionsTracklist";
import { handleTranscripts } from "../../lib/helpers/youtubeTranscriptsHandling.ts";
import { HTTPException } from "hono/http-exception";

interface AvailableCaption {
    label: string;
    languageCode: string;
    url: string;
}

const captionsHandler = new Hono<{ Variables: HonoVariables }>();
captionsHandler.get("/:videoId", async (c) => {
    const { videoId } = c.req.param();
    const konfigStore = await c.get("konfigStore") as Store<
        Record<string, unknown>
    >;

    const check = c.req.query("check");

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

    const innertubeClient = await c.get("innertubeClient");

    const youtubePlayerResponseJson = await youtubePlayerParsing(
        innertubeClient,
        videoId,
        konfigStore,
    );

    const videoInfo = youtubeVideoInfo(
        innertubeClient,
        youtubePlayerResponseJson,
    );

    const captionsTrackArray = videoInfo.captions?.caption_tracks;
    if (captionsTrackArray == undefined) throw new HTTPException(404);

    const label = c.req.query("label");
    const lang = c.req.query("lang");

    // Show all available captions when a specific one is not selected
    if (label == undefined && lang == undefined) {
        const invidiousAvailableCaptionsArr: AvailableCaption[] = [];

        for (const caption_track of captionsTrackArray) {
            invidiousAvailableCaptionsArr.push({
                label: caption_track.name.text || "",
                languageCode: caption_track.language_code,
                url: `/api/v1/captions/${videoId}?label=${
                    encodeURIComponent(caption_track.name.text || "")
                }`,
            });
        }

        return c.json({ captions: invidiousAvailableCaptionsArr });
    }

    // Extract selected caption
    let filterSelected: CaptionTrackData[];

    if (lang) {
        filterSelected = captionsTrackArray.filter((c: CaptionTrackData) =>
            c.language_code === lang
        );
    } else {
        filterSelected = captionsTrackArray.filter((c: CaptionTrackData) =>
            c.name.text === label
        );
    }

    if (filterSelected.length == 0) throw new HTTPException(404);

    c.header("Content-Type", "text/vtt; charset=UTF-8");
    return c.body(
        await handleTranscripts(innertubeClient, videoId, filterSelected[0]),
    );
});

export default captionsHandler;

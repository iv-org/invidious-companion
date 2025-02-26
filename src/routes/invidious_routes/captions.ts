import { Hono } from "hono";
import { HonoVariables } from "../../lib/types/HonoVariables.ts";
import { Store } from "@willsoto/node-konfig-core";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts"
import { innertube } from "youtubei.js";
import { youtubePlayerParsing } from "../../lib/helpers/youtubePlayerHandling.ts";
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

    // @ts-ignore
    if (konfigStore.get("server.verify_requests") && check == undefined) {
        throw new HTTPException(400, {
            res: new Response("No check ID."),
        });
    // @ts-ignore
    } else if (konfigStore.get("server.verify_requests") && check) {
        if (verifyRequest(check, videoId, konfigStore) === false) {
            throw new HTTPException(400, {
                res: new Response("ID incorrect."),
            });
        }
    }

    const innertubeClient = await c.get("innertubeClient") as Innertube;

    let playerJson = await youtubePlayerParsing(
        innertubeClient,
        videoId,
        konfigStore,
    )

    const captionsTrackArray = playerJson.captions.playerCaptionsTracklistRenderer.captionTracks

    const label = c.req.query("label")
    const lang = c.req.query("lang")

    // Show all available captions when a specific one is not selected
    if (label == undefined && lang == undefined) {
        const invidiousAvailableCaptionsArr: AvailableCaption[] = []

        captionsTrackArray.forEach(captions => {
            invidiousAvailableCaptionsArr.push({
                label: captions.name.simpleText,
                languageCode: captions.languageCode,
                url: `/api/v1/captions/${videoId}?label=${encodeURIComponent(captions.name.simpleText)}`
            })
        });

        return c.json({captions: invidiousAvailableCaptionsArr})
    }

    // Extract selected caption
    let caption;

    if (lang) {
        caption = captionsTrackArray.filter(c => c.languageCode === lang);
    } else {
        caption = captionsTrackArray.filter(c => c.name.simpleText === label);
    }

    if (caption.length == 0) {
        throw new HTTPException(404)
    } else {
        caption = caption[0]
    }

    return await c.text()
})

export default captionsHandler;

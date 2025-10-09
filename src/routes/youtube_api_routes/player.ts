import { Hono } from "hono";
import { youtubePlayerParsing } from "../../lib/helpers/youtubePlayerHandling.ts";
import { HTTPException } from "hono/http-exception";
import { validateVideoId } from "../../lib/helpers/validateVideoId.ts";

const player = new Hono();

player.post("/player", async (c) => {
    const jsonReq = await c.req.json();
    const innertubeClient = c.get("innertubeClient");
    const config = c.get("config");
    const metrics = c.get("metrics");
    const tokenMinter = c.get("tokenMinter");

    // Check if tokenMinter is ready (only needed when PO token is enabled)
    if (config.jobs.youtube_session.po_token_enabled && !tokenMinter) {
        return c.json(
            {
                error:
                    "Companion is starting. Please wait until a valid potoken is found.",
                status: "SERVICE_UNAVAILABLE",
            },
            503,
        );
    }

    if (jsonReq.videoId) {
        if (!validateVideoId(jsonReq.videoId)) {
            throw new HTTPException(400, {
                res: new Response("Invalid video ID format."),
            });
        }
        return c.json(
            await youtubePlayerParsing({
                innertubeClient,
                videoId: jsonReq.videoId,
                config,
                tokenMinter: tokenMinter!,
                metrics,
            }),
        );
    }
});

export default player;

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
                tokenMinter: c.get("tokenMinter"),
                metrics,
            }),
        );
    }
});

export default player;

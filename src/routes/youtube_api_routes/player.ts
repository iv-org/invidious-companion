import { Hono } from "hono";
import { youtubePlayerParsing } from "../../lib/helpers/youtubePlayerHandling.ts";

const player = new Hono();

player.post("/player", async (c) => {
    const jsonReq = await c.req.json();
    const innertubeClient = c.get("innertubeClient");
    const config = c.get("config");
    const metrics = c.get("metrics");
    if (jsonReq.videoId) {
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

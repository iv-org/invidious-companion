import { Hono } from "hono";
import { youtubePlayerParsing } from "../../lib/helpers/youtubePlayerHandling.ts";

const player = new Hono();

player.post("/player", async (c) => {
    const jsonReq = await c.req.json();
    const innertubeClient = c.get("innertubeClient");
    const konfigStore = c.get("konfigStore");
    if (jsonReq.videoId) {
        return c.json(
            await youtubePlayerParsing({
                innertubeClient,
                videoId: jsonReq.videoId,
                konfigStore,
                tokenMinter: c.get("tokenMinter"),
            }),
        );
    }
});

export default player;

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validateVideoId } from "../../lib/helpers/validateVideoId.ts";
import { TOKEN_MINTER_NOT_READY_MESSAGE } from "../../constants.ts";

// A PO token bound to one video, for players that stream SABR themselves
// (e.g. Invidious' web player): YouTube only takes tokens minted as if on
// www.youtube.com, which a browser on another site cannot do.
const potoken = new Hono();

potoken.post("/potoken", async (c) => {
    const { videoId } = await c.req.json();
    if (!videoId || !validateVideoId(videoId)) {
        throw new HTTPException(400, {
            res: new Response("Invalid video ID format."),
        });
    }
    const tokenMinter = c.get("tokenMinter");
    if (!tokenMinter) {
        throw new HTTPException(503, {
            res: new Response(TOKEN_MINTER_NOT_READY_MESSAGE),
        });
    }
    return c.json({ poToken: await tokenMinter(videoId) });
});

export default potoken;

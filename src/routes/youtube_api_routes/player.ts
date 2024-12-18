import { Hono } from "hono";
import { youtubePlayerParsing } from "../../lib/helpers/youtubePlayerHandling.ts";
import { HonoVariables } from "../../lib/types/HonoVariables.ts";
import { Innertube } from "youtubei.js";
import { Store } from "@willsoto/node-konfig-core";
import { reasonBot, subreasonProtectCommunity } from "../index.ts";

const player = new Hono<{ Variables: HonoVariables }>();

const errors = [
  {
    // @ts-ignore: Property 'playabilityStatus' does not exist on type 'object'
    check: (yt: object) => yt.playabilityStatus?.reason?.includes("Sign in to confirm you’re not a bot"),
    action: () => reasonBot.inc(),
  },
  {
    // @ts-ignore: Property 'playabilityStatus' does not exist on type 'object'
    check: (yt: object) => yt.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.runs?.[0]?.text?.includes("This helps protect our community"),
    action: () => subreasonProtectCommunity.inc(),
  },
];

player.post("/player", async (c) => {
  const jsonReq = await c.req.json();
  const innertubeClient = await c.get("innertubeClient") as Innertube;
  // @ts-ignore Do not understand how to fix this error.
  const konfigStore = await c.get("konfigStore") as Store<
    Record<string, unknown>
  >;
  if (jsonReq.videoId) {
    const yt = await youtubePlayerParsing(innertubeClient, jsonReq.videoId, konfigStore)
    errors.forEach((error) => {
      if (error.check(yt)) {
        error.action()
      }
    })
    return c.json(yt);
  }
});

export default player;

import { Hono } from "hono";
import { logger } from "hono/logger";
import { Store } from "@willsoto/node-konfig-core";
import { bearerAuth } from "hono/bearer-auth";
import { Registry, Counter } from "prom-client"

import youtubeApiPlayer from "./youtube_api_routes/player.ts";
import invidiousRouteLatestVersion from "./invidious_routes/latestVersion.ts";
import invidiousRouteDashManifest from "./invidious_routes/dashManifest.ts";
import videoPlaybackProxy from "./videoPlaybackProxy.ts";
import metrics from "./metrics.ts";

const METRICS_PREFIX = "invidious_companion_";
export const register = new Registry();

export const cachedEntries = new Counter({
	name: `${METRICS_PREFIX}cached_entries`,
	help: 'Total entries cached over the execution of invidious-companion',
	registers: [register]
  });

export const subreasonProtectCommunity = new Counter({
	name: `${METRICS_PREFIX}subreason_protect_community`,
	help: 'How many times the message "This helps protect our community." has been returned by Youtube API',
	registers: [register]
  });

export const poTokenFail = new Counter({
	name: `${METRICS_PREFIX}potoken_fail`,
	help: 'Total number of times the job to regenerate the tokens has failed',
	registers: [register]
  });

export const reasonBot = new Counter({
	name: `${METRICS_PREFIX}reason_bot`,
	help: 'How many times the message "Sign in to confirm you’re not a bot." has been returned by Youtube API',
	registers: [register]
  });

export const routes = (app: Hono, konfigStore: Store<Record<string, unknown>>) => {
  app.use("*", logger());

  app.use(
    "/youtubei/v1/*",
    bearerAuth({
      token: Deno.env.get("SERVER_SECRET_KEY") || konfigStore.get("server.secret_key") as string,
    }),
  );

  app.route("/youtubei/v1", youtubeApiPlayer);
  app.route("/latest_version", invidiousRouteLatestVersion);
  app.route("/api/manifest/dash/id", invidiousRouteDashManifest);
  app.route("/videoplayback", videoPlaybackProxy);
  app.route("/metrics", metrics)
};

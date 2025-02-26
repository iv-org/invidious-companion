import { Hono } from "hono";
import { logger } from "hono/logger";
import { Store } from "@willsoto/node-konfig-core";
import { bearerAuth } from "hono/bearer-auth";

import youtubeApiPlayer from "./youtube_api_routes/player.ts";
import invidiousRouteLatestVersion from "./invidious_routes/latestVersion.ts";
import invidiousRouteDashManifest from "./invidious_routes/dashManifest.ts";
import invidiousCaptionsApi from "./invidious_routes/captions.ts";
import videoPlaybackProxy from "./videoPlaybackProxy.ts";
import health from "./health.ts";

export const routes = (
    app: Hono,
    konfigStore: Store<Record<string, unknown>>,
) => {
    app.use("*", logger());

    app.use(
        "/youtubei/v1/*",
        bearerAuth({
            token: Deno.env.get("SERVER_SECRET_KEY") ||
                konfigStore.get("server.secret_key") as string,
        }),
    );

    app.route("/youtubei/v1", youtubeApiPlayer);
    app.route("/latest_version", invidiousRouteLatestVersion);
    app.route("/api/manifest/dash/id", invidiousRouteDashManifest);
    app.route("/api/v1/captions", invidiousCaptionsApi);
    app.route("/videoplayback", videoPlaybackProxy);
    app.route("/healthz", health);
};

import { Hono } from "hono";
import { logger } from "hono/logger";
import { Store } from "@willsoto/node-konfig-core";
import { bearerAuth } from "hono/bearer-auth";

import youtubeApiPlayer from "./youtube_api_routes/player.ts";
import invidiousRouteLatestVersion from "./invidious_routes/latestVersion.ts";
import invidiousRouteDashManifest from "./invidious_routes/dashManifest.ts";
import { getDownloadHandler } from "./invidious_routes/download.ts";
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
    // Needs app for app.request in order to call /latest_version endpoint
    app.post("/download", getDownloadHandler(app));
    app.route("/api/manifest/dash/id", invidiousRouteDashManifest);
    app.route("/videoplayback", videoPlaybackProxy);
    app.route("/healthz", health);
};

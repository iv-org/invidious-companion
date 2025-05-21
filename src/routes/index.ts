import { Hono } from "hono";
import { logger } from "hono/logger";
import { bearerAuth } from "hono/bearer-auth";

import youtubeApiPlayer from "./youtube_api_routes/player.ts";
import invidiousRouteLatestVersion from "./invidious_routes/latestVersion.ts";
import invidiousRouteDashManifest from "./invidious_routes/dashManifest.ts";
import invidiousCaptionsApi from "./invidious_routes/captions.ts";
import getDownloadHandler from "./invidious_routes/download.ts";
import videoPlaybackProxy from "./videoPlaybackProxy.ts";
import health from "./health.ts";
import type { Config } from "../lib/helpers/config.ts";
import metrics from "./metrics.ts";

export const routes = (
    app: Hono,
    config: Config,
) => {
    const loggerUnixSocket = (message: string, ...rest: string[]) => {
        message = message.replace("//localhost/", "/");
        console.log(message, ...rest);
    };

    if (config.server.use_unix_socket) {
        app.use("*", logger(loggerUnixSocket));
    } else {
        app.use("*", logger());
    }

    app.use(
        "/youtubei/v1/*",
        bearerAuth({
            token: config.server.secret_key,
        }),
    );

    app.route("/youtubei/v1", youtubeApiPlayer);
    app.route("/latest_version", invidiousRouteLatestVersion);
    // Needs app for app.request in order to call /latest_version endpoint
    app.post("/download", getDownloadHandler(app));
    app.route("/api/manifest/dash/id", invidiousRouteDashManifest);
    app.route("/api/v1/captions", invidiousCaptionsApi);
    app.route("/videoplayback", videoPlaybackProxy);
    app.route("/healthz", health);
    if (config.server.enable_metrics) {
        app.route("/metrics", metrics);
    }
};

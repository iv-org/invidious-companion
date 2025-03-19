import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";

export default function getDownloadHandler(app: Hono) {
    async function handler(c: Context) {
        const body = await c.req.formData();

        const videoId = body.get("id") as string | undefined;
        if (videoId == undefined) {
            throw new HTTPException(400, {
                res: new Response("Please specify the video ID"),
            });
        }

        const config = c.get("config");

        const check = c.req.query("check");

        if (config.server.verify_requests && check == undefined) {
            throw new HTTPException(400, {
                res: new Response("No check ID."),
            });
        } else if (config.server.verify_requests && check) {
            if (verifyRequest(check, videoId, config) === false) {
                throw new HTTPException(400, {
                    res: new Response("ID incorrect."),
                });
            }
        }

        const title = body.get("title");

        let downloadWidgetData: { itag: number; ext: string; label: string };

        try {
            downloadWidgetData = JSON.parse(
                (body.get("download_widget") as string || undefined) || "",
            );
        } catch {
            throw new HTTPException(400, {
                res: new Response("Invalid download_widget json"),
            });
        }

        if (
            !(title || videoId || downloadWidgetData)
        ) {
            throw new HTTPException(400, {
                res: new Response("Missing form data required for download"),
            });
        }

        if (downloadWidgetData.label) {
            return await app.request(
                `/api/v1/captions/${videoId}?label=${
                    encodeURIComponent(downloadWidgetData.label)
                }`,
            );
        } else if (downloadWidgetData.itag) {
            const itag = Number(downloadWidgetData.itag);
            const ext = downloadWidgetData.ext;
            const filename = `${title}-${videoId}.${ext || ""}`;

            const urlQueriesForLatestVersion = new URLSearchParams();
            urlQueriesForLatestVersion.set("id", videoId);
            urlQueriesForLatestVersion.set("itag", itag.toString());
            urlQueriesForLatestVersion.set("title", filename);
            urlQueriesForLatestVersion.set("local", "true");

            return await app.request(
                `/latest_version?${urlQueriesForLatestVersion.toString()}`,
            );
        } else {
            throw new HTTPException(400, {
                res: new Response("Invalid label or itag"),
            });
        }
    }

    return handler;
}

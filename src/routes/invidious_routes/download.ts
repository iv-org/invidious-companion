import type { Context, Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";
import { validateVideoId } from "../../lib/helpers/validateVideoId.ts";

const DownloadWidgetSchema = z.union([
    z.object({ label: z.string(), ext: z.string() }).strict(),
    z.object({ itag: z.number(), ext: z.string() }).strict(),
]);

type DownloadWidget = z.infer<typeof DownloadWidgetSchema>;

export default function getDownloadHandler(app: Hono) {
    async function handler(c: Context) {
        const body = await c.req.formData();

        const videoId = body.get("id")?.toString();
        if (videoId == undefined) {
            throw new HTTPException(400, {
                res: new Response("Please specify the video ID"),
            });
        }

        if (!validateVideoId(videoId)) {
            throw new HTTPException(400, {
                res: new Response("Invalid video ID format."),
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

        let downloadWidgetData: DownloadWidget;

        try {
            downloadWidgetData = JSON.parse(
                body.get("download_widget")?.toString() || "",
            );
        } catch {
            throw new HTTPException(400, {
                res: new Response("Invalid download_widget json"),
            });
        }

        if (
            !(title && videoId &&
                DownloadWidgetSchema.safeParse(downloadWidgetData).success)
        ) {
            throw new HTTPException(400, {
                res: new Response("Invalid form data required for download"),
            });
        }

        if ("label" in downloadWidgetData) {
            return await app.request(
                `${config.server.base_path}/api/v1/captions/${videoId}?label=${
                    encodeURIComponent(downloadWidgetData.label)
                }`,
            );
        } else {
            const itag = downloadWidgetData.itag;
            const ext = downloadWidgetData.ext;
            const filename = `${title}-${videoId}.${ext}`;

            const urlQueriesForLatestVersion = new URLSearchParams();
            urlQueriesForLatestVersion.set("id", videoId);
            urlQueriesForLatestVersion.set("check", check || "");
            urlQueriesForLatestVersion.set("itag", itag.toString());
            // "title" for compatibility with how Invidious sets the content disposition header
            // in /videoplayback and /latest_version
            urlQueriesForLatestVersion.set(
                "title",
                filename,
            );
            urlQueriesForLatestVersion.set("local", "true");

            return await app.request(
                `${config.server.base_path}/latest_version?${urlQueriesForLatestVersion.toString()}`,
            );
        }
    }

    return handler;
}

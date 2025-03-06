import { HTTPException } from "hono/http-exception";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";

export default function getDownloadHandler(app) {
    async function handler(c) {
        const body = await c.req.formData();

        const videoId = body.get("id");

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
            downloadWidgetData = JSON.parse(body.get("download_widget"));
        } catch {
            throw new HTTPException(400, {
                res: new Response("Invalid download_widget json"),
            });
        }

        if (
            !(title || videoId ||
                (downloadWidgetData.itag && downloadWidgetData.ext))
        ) {
            throw new HTTPException(400, {
                res: new Response("Invalid form data"),
            });
        }
        const itag = Number(downloadWidgetData.itag);
        const { ext, label } = downloadWidgetData;

        const filename = `${title}-${videoId}.${ext || ""}`;

        if (label) {
            // TODO depends on https://github.com/iv-org/invidious-companion/pull/55
            // return await app.request(`/api/v1/captions/${videoId}?label=${encodeURIComponent(label)}`)
        } else if (itag) {
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

import { HTTPException } from "hono/http-exception";
import { Store } from "@willsoto/node-konfig-core";
import {
    verifyRequest
} from "../../lib/helpers/verifyRequest.ts";

export function getDownloadHandler(app) {
    async function handler(c) {
        const body = await c.req.formData();

        const videoId = body.get("id");

        const konfigStore = await c.get("konfigStore") as Store<
            Record<string, unknown>
        >;

        const check = c.req.query("check");

        if (konfigStore.get("server.verify_requests") && check == undefined) {
            throw new HTTPException(400, {
                res: new Response("No check ID."),
            });
        } else if (konfigStore.get("server.verify_requests") && check) {
            if (verifyRequest(check, videoId, konfigStore) === false) {
                throw new HTTPException(400, {
                    res: new Response("ID incorrect."),
                });
            }
        }

        const title = body.get("title");

        let downloadWidgetData : { itag: number; ext: string; label: string};

        try {
            downloadWidgetData = JSON.parse(body.get("download_widget"));
        } catch (error) {
            throw new HTTPException(400, {res: new Response("Invalid download_widget json"), });
        }

        if (!(title || videoId || (downloadWidgetData.itag && downloadWidgetData.ext))) {
            throw new HTTPException(400, {res: new Response("Invalid form data"), });
        }
        const itag = Number(downloadWidgetData.itag);
        const {ext, label} = downloadWidgetData;

        const filename = `${title}-${videoId}.${ext || ''}`;

        if (label) {
        } else if (itag) {
            const urlQueriesForLatestVersion = new URLSearchParams();
            urlQueriesForLatestVersion.set("id", videoId);
            urlQueriesForLatestVersion.set("itag", itag.toString());
            urlQueriesForLatestVersion.set("title", filename);
            urlQueriesForLatestVersion.set("local", "true");

            return await app.request(`/latest_version?${urlQueriesForLatestVersion.toString()}`);
        } else {
            throw new HTTPException(400, {res: new Response("Invalid label or itag"), });
        }
    }

    return handler
}

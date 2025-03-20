import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
    youtubePlayerParsing,
    youtubeVideoInfo,
} from "../../lib/helpers/youtubePlayerHandling.ts";
import { verifyRequest } from "../../lib/helpers/verifyRequest.ts";
import { encryptQuery } from "../../lib/helpers/encryptQuery.ts";

const latestVersion = new Hono();

latestVersion.get("/", async (c) => {
    const { check, itag, id, local, title } = c.req.query();
    c.header("access-control-allow-origin", "*");

    if (!id || !itag) {
        throw new HTTPException(400, {
            res: new Response("Please specify the itag and video ID."),
        });
    }

    const innertubeClient = c.get("innertubeClient");
    const config = c.get("config");

    if (config.server.verify_requests && check == undefined) {
        throw new HTTPException(400, {
            res: new Response("No check ID."),
        });
    } else if (config.server.verify_requests && check) {
        if (verifyRequest(check, id, config) === false) {
            throw new HTTPException(400, {
                res: new Response("ID incorrect."),
            });
        }
    }

    const youtubePlayerResponseJson = await youtubePlayerParsing({
        innertubeClient,
        videoId: id,
        config,
        tokenMinter: c.get("tokenMinter"),
    });
    const videoInfo = youtubeVideoInfo(
        innertubeClient,
        youtubePlayerResponseJson,
    );

    if (videoInfo.playability_status?.status !== "OK") {
        throw ("The video can't be played: " + id + " due to reason: " +
            videoInfo.playability_status?.reason);
    }
    const streamingData = videoInfo.streaming_data;
    const availableFormats = streamingData?.formats.concat(
        streamingData.adaptive_formats,
    );
    const selectedItagFormat = availableFormats?.filter((i) =>
        i.itag == Number(itag)
    );
    if (selectedItagFormat?.length === 0) {
        throw new HTTPException(400, {
            res: new Response("No itag found."),
        });
    } else if (selectedItagFormat) {
        const itagUrl = selectedItagFormat[0].url as string;
        const itagUrlParsed = new URL(itagUrl);
        const queryParams = new URLSearchParams(itagUrlParsed.search);
        let urlToRedirect = itagUrlParsed.toString();

        if (local) {
            queryParams.set("host", itagUrlParsed.host);
            if (config.server.encrypt_query_params) {
                const privateParams = "&pot=" +
                    queryParams.get("pot") +
                    "&ip=" + queryParams.get("ip");
                const encryptedParams = encryptQuery(
                    privateParams,
                    config,
                );
                queryParams.delete("pot");
                queryParams.delete("ip");
                queryParams.set("enc", "true");
                queryParams.set("data", encryptedParams);
            }
            urlToRedirect = itagUrlParsed.pathname + "?" +
                queryParams.toString();
        }

        if (title) urlToRedirect += `&title=${encodeURIComponent(title)}`;

        return c.redirect(urlToRedirect);
    }
});

export default latestVersion;

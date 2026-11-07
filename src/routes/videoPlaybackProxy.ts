import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { encodeRFC5987ValueChars } from "../lib/helpers/encodeRFC5987ValueChars.ts";
import { decryptQuery } from "../lib/helpers/encryptQuery.ts";
import { StreamingApi } from "hono/utils/stream";

let getFetchClientLocation = "getFetchClient";
if (Deno.env.get("GET_FETCH_CLIENT_LOCATION")) {
    if (Deno.env.has("DENO_COMPILED")) {
        getFetchClientLocation = Deno.mainModule.replace("src/main.ts", "") +
            Deno.env.get("GET_FETCH_CLIENT_LOCATION");
    } else {
        getFetchClientLocation = Deno.env.get(
            "GET_FETCH_CLIENT_LOCATION",
        ) as string;
    }
}
const { getFetchClient } = await import(getFetchClientLocation);

const videoPlaybackProxy = new Hono();

videoPlaybackProxy.options("/", () => {
    const headersForResponse: Record<string, string> = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "Content-Type, Range",
    };
    return new Response("OK", {
        status: 200,
        headers: headersForResponse,
    });
});

videoPlaybackProxy.get("/", async (c) => {
    const { host, c: client, expire, title } = c.req.query();
    const urlReq = new URL(c.req.url);
    const config = c.get("config");
    const queryParams = new URLSearchParams(urlReq.search);

    if (c.req.query("enc") === "true") {
        const { data: encryptedQuery } = c.req.query();
        const decryptedQueryParams = decryptQuery(encryptedQuery, config);
        const parsedDecryptedQueryParams = new URLSearchParams(
            JSON.parse(decryptedQueryParams),
        );
        queryParams.delete("enc");
        queryParams.delete("data");
        queryParams.set("pot", parsedDecryptedQueryParams.get("pot") as string);
        queryParams.set("ip", parsedDecryptedQueryParams.get("ip") as string);
    }

    if (host == undefined || !/[\w-]+.googlevideo.com/.test(host)) {
        throw new HTTPException(400, {
            res: new Response("Host query string do not match or undefined."),
        });
    }

    if (
        expire == undefined ||
        Number(expire) < Number(Date.now().toString().slice(0, -3))
    ) {
        throw new HTTPException(400, {
            res: new Response(
                "Expire query string undefined or videoplayback URL has expired.",
            ),
        });
    }

    if (client == undefined) {
        throw new HTTPException(400, {
            res: new Response("'c' query string undefined."),
        });
    }

    queryParams.delete("host");
    queryParams.delete("title");

    const rangeHeader = c.req.header("range");
    const requestBytes = rangeHeader ? rangeHeader.split("=")[1] : null;
    const [firstByte, lastByte] = requestBytes?.split("-") || [];
    if (requestBytes) {
        queryParams.append(
            "range",
            requestBytes,
        );
    }

    const headersToSend: HeadersInit = {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-us,en;q=0.5",
        "origin": "https://www.youtube.com",
        "referer": "https://www.youtube.com",
    };

    if (client == "ANDROID") {
        headersToSend["user-agent"] =
            "com.google.android.youtube/1537338816 (Linux; U; Android 13; en_US; ; Build/TQ2A.230505.002; Cronet/113.0.5672.24)";
    } else if (client == "IOS") {
        headersToSend["user-agent"] =
            "com.google.ios.youtube/19.32.8 (iPhone14,5; U; CPU iOS 17_6 like Mac OS X;)";
    } else {
        headersToSend["user-agent"] =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    }

    const fetchClient = await getFetchClient(config);

    let headResponse: Response | undefined;
    let location = `https://${host}/videoplayback?${queryParams.toString()}`;

    // https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-p2-semantics-17#section-7.3
    // A maximum of 5 redirections is defined in the note of the section 7.3
    // of this RFC, that's why `i < 5`
    for (let i = 0; i < 5; i++) {
        const googlevideoResponse: Response = await fetchClient(location, {
            method: "HEAD",
            headers: headersToSend,
            redirect: "manual",
        });
        if (googlevideoResponse.status == 403) {
            return new Response(googlevideoResponse.body, {
                status: googlevideoResponse.status,
                statusText: googlevideoResponse.statusText,
            });
        }
        if (googlevideoResponse.headers.has("Location")) {
            location = googlevideoResponse.headers.get("Location") as string;
            continue;
        } else {
            headResponse = googlevideoResponse;
            break;
        }
    }
    if (headResponse === undefined) {
        throw new HTTPException(502, {
            res: new Response(
                "Google headResponse redirected too many times",
            ),
        });
    }

    // =================== REQUEST CHUNKING =======================
    // if the requested response is larger than the chunkSize, break up the response
    // into chunks and stream the response back to the client to avoid rate limiting
    const { readable, writable } = new TransformStream();
    const stream = new StreamingApi(writable, readable);
    const googleVideoUrl = new URL(location);
    const getChunk = async (start: number, end: number) => {
        googleVideoUrl.searchParams.set(
            "range",
            `${start}-${end}`,
        );
        const postResponse = await fetchClient(googleVideoUrl, {
            method: "POST",
            body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses),
            headers: headersToSend,
        });
        if (postResponse.status !== 200) {
            throw new Error("Non-200 response from google servers");
        }
        await stream.pipe(postResponse.body);
    };

    const chunkSize =
        config.networking.videoplayback.video_fetch_chunk_size_mb * 1_000_000;
    const totalBytes = Number(
        headResponse.headers.get("Content-Length") || "0",
    );

    // if no range sent, the client wants thw whole file, i.e. for downloads
    const wholeRequestStartByte = Number(firstByte || "0");
    const wholeRequestEndByte = wholeRequestStartByte + Number(totalBytes) - 1;

    let chunk = Promise.resolve();
    for (
        let startByte = wholeRequestStartByte;
        startByte < wholeRequestEndByte;
        startByte += chunkSize
    ) {
        // i.e.
        // 0 - 4_999_999, then
        // 5_000_000 - 9_999_999, then
        // 10_000_000 - 14_999_999
        let endByte = startByte + chunkSize - 1;
        if (endByte > wholeRequestEndByte) {
            endByte = wholeRequestEndByte;
        }
        chunk = chunk.then(() => getChunk(startByte, endByte));
    }
    chunk.catch(() => {
        stream.abort();
    });
    // =================== REQUEST CHUNKING =======================

    const headersForResponse: Record<string, string> = {
        "content-length": headResponse.headers.get("content-length") || "",
        "access-control-allow-origin": "*",
        "accept-ranges": headResponse.headers.get("accept-ranges") || "",
        "content-type": headResponse.headers.get("content-type") || "",
        "expires": headResponse.headers.get("expires") || "",
        "last-modified": headResponse.headers.get("last-modified") || "",
    };

    if (title) {
        headersForResponse["content-disposition"] = `attachment; filename="${
            encodeURIComponent(title)
        }"; filename*=UTF-8''${encodeRFC5987ValueChars(title)}`;
    }

    let responseStatus = headResponse.status;
    if (requestBytes && responseStatus == 200) {
        // check for range headers in the forms:
        // "bytes=0-" get full length from start
        // "bytes=500-" get full length from 500 bytes in
        // "bytes=500-1000" get 500 bytes starting from 500
        if (lastByte) {
            responseStatus = 206;
            headersForResponse["content-range"] = `bytes ${requestBytes}/${
                queryParams.get("clen") || "*"
            }`;
        } else {
            // i.e. "bytes=0-", "bytes=600-"
            // full size of content is able to be calculated, so a full Content-Range header can be constructed
            const bytesReceived = headersForResponse["content-length"];
            // last byte should always be one less than the length
            const totalContentLength = Number(firstByte) +
                Number(bytesReceived);
            const lastByte = totalContentLength - 1;
            if (firstByte !== "0") {
                // only part of the total content returned, 206
                responseStatus = 206;
            }
            headersForResponse["content-range"] =
                `bytes ${firstByte}-${lastByte}/${totalContentLength}`;
        }
    }

    return new Response(stream.responseReadable, {
        status: responseStatus,
        statusText: headResponse.statusText,
        headers: headersForResponse,
    });
});

export default videoPlaybackProxy;

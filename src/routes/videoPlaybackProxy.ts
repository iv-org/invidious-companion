import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { encodeRFC5987ValueChars } from "../lib/helpers/encodeRFC5987ValueChars.ts";
import { decryptQuery } from "../lib/helpers/encryptQuery.ts";
import { StreamingApi } from "hono/utils/stream";
import { generateRandomIPv6 } from "../lib/helpers/ipv6Rotation.ts";

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

    // googlevideo closes the connection after answering the POST below, even
    // though it advertises keep-alive. A pooled client would then hand that
    // dead connection to the next request, which fails with "peer closed
    // connection without sending TLS close_notify" (every other request).
    // So every googlevideo request gets its own client, closed once its body
    // has been consumed.
    const proxyAddress = config.networking.proxy;
    const ipv6Block = config.networking.ipv6_block;
    const newHttpClient = () => {
        const clientOptions: Deno.CreateHttpClientOptions = {};
        if (proxyAddress) {
            clientOptions.proxy = { url: proxyAddress };
        }
        if (ipv6Block) {
            clientOptions.localAddress = generateRandomIPv6(ipv6Block);
        }
        return Deno.createHttpClient(clientOptions);
    };

    // Error responses need CORS too, otherwise browsers only see an opaque
    // network error instead of a status they can react to.
    const upstreamError = (status: number, message: string) =>
        new Response(message, {
            status,
            headers: { "access-control-allow-origin": "*" },
        });

    let headResponse: Response | undefined;
    let location = `https://${host}/videoplayback?${queryParams.toString()}`;

    // https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-p2-semantics-17#section-7.3
    // A maximum of 5 redirections is defined in the note of the section 7.3
    // of this RFC, that's why `i < 5`
    for (let i = 0; i < 5; i++) {
        const httpClient = newHttpClient();
        let googlevideoResponse: Response;
        try {
            googlevideoResponse = await fetchClient(location, {
                method: "HEAD",
                headers: headersToSend,
                redirect: "manual",
                client: httpClient,
            });
        } catch (err) {
            console.error("[ERROR] googlevideo HEAD request failed:", err);
            return upstreamError(502, "googlevideo HEAD request failed");
        } finally {
            httpClient.close();
        }
        if (googlevideoResponse.status == 403) {
            return new Response(googlevideoResponse.body, {
                status: googlevideoResponse.status,
                statusText: googlevideoResponse.statusText,
                headers: { "access-control-allow-origin": "*" },
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
        return upstreamError(
            502,
            "Google headResponse redirected too many times",
        );
    }

    // =================== REQUEST CHUNKING =======================
    // if the requested response is larger than the chunkSize, break up the response
    // into chunks and stream the response back to the client to avoid rate limiting
    const { readable, writable } = new TransformStream();
    const stream = new StreamingApi(writable, readable);
    // Hono only cancels upstream bodies that are already piped. A chunk still
    // waiting for its response headers or first bytes would otherwise linger
    // after a client abort until data or the fetch timeout, so abort the
    // chunk fetches themselves (which also aborts their bodies).
    const clientAbort = new AbortController();
    stream.onAbort(() => clientAbort.abort());
    const fetchChunk = async (start: number, end: number) => {
        const googleVideoUrl = new URL(location);
        googleVideoUrl.searchParams.set("range", `${start}-${end}`);
        const httpClient = newHttpClient();
        try {
            const postResponse: Response = await fetchClient(googleVideoUrl, {
                method: "POST",
                body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses),
                headers: headersToSend,
                client: httpClient,
                // combined with a fresh timeout per attempt in getFetchClient
                signal: clientAbort.signal,
            });
            if (postResponse.status !== 200 || !postResponse.body) {
                await postResponse.body?.cancel();
                throw new Error(
                    `Non-200 response from google servers: ${postResponse.status}`,
                );
            }
            // A 200 only means the headers arrived. Wait for the first body
            // bytes too, so a connection dropped right after the headers
            // still turns into an error before the response head is sent.
            const reader = postResponse.body.getReader();
            let firstBytes: Uint8Array | undefined;
            try {
                while (!firstBytes) {
                    const { done, value } = await reader.read();
                    if (done) {
                        throw new Error(
                            "googlevideo closed the response before sending any data",
                        );
                    }
                    if (value.byteLength > 0) firstBytes = value;
                }
            } catch (err) {
                reader.cancel().catch(() => {});
                throw err;
            }
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(firstBytes);
                },
                async pull(controller) {
                    const { done, value } = await reader.read();
                    if (done) controller.close();
                    else controller.enqueue(value);
                },
                cancel(reason) {
                    return reader.cancel(reason);
                },
            });
            return { body, httpClient };
        } catch (err) {
            httpClient.close();
            throw err;
        }
    };
    const pipeChunk = async (
        chunk: {
            body: ReadableStream<Uint8Array>;
            httpClient: Deno.HttpClient;
        },
    ) => {
        try {
            await stream.pipe(chunk.body);
        } finally {
            chunk.httpClient.close();
        }
    };

    const chunkSize =
        config.networking.videoplayback.video_fetch_chunk_size_mb * 1_000_000;
    const totalBytes = Number(
        headResponse.headers.get("Content-Length") || "0",
    );

    // if no range sent, the client wants thw whole file, i.e. for downloads
    const wholeRequestStartByte = Number(firstByte || "0");
    const wholeRequestEndByte = wholeRequestStartByte + Number(totalBytes) - 1;

    const chunkRanges: [number, number][] = [];
    for (
        let startByte = wholeRequestStartByte;
        // the end byte is inclusive: `<=` keeps the last byte of the range
        // (e.g. `bytes=0-0`, or a range one byte longer than a chunk)
        startByte <= wholeRequestEndByte;
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
        chunkRanges.push([startByte, endByte]);
    }

    // Wait for googlevideo to answer the first chunk before committing to a
    // 200/206 head: once the head is sent, an upstream failure can only show
    // up as a truncated body, which players do not retry properly.
    let firstChunk: Awaited<ReturnType<typeof fetchChunk>> | undefined;
    if (chunkRanges.length > 0) {
        try {
            firstChunk = await fetchChunk(...chunkRanges[0]);
        } catch (err) {
            console.error("[ERROR] googlevideo POST request failed:", err);
            return upstreamError(502, "googlevideo POST request failed");
        }
    }

    (async () => {
        if (firstChunk) await pipeChunk(firstChunk);
        for (const [startByte, endByte] of chunkRanges.slice(1)) {
            if (stream.aborted) return;
            await pipeChunk(await fetchChunk(startByte, endByte));
        }
        await stream.close();
    })().catch((err) => {
        // The client cancelling the response (e.g. the player switching
        // quality) is not an error: don't log it.
        if (err !== undefined && !stream.aborted) {
            console.error("[ERROR] googlevideo chunk streaming failed:", err);
        }
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

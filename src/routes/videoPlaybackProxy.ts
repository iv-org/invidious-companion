import { Hono } from "hono";
import { Store } from "@willsoto/node-konfig-core";
import { HTTPException } from "hono/http-exception";
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

videoPlaybackProxy.get("/", async (c) => {
    const { host, c: client, expire } = c.req.query();
    const rangeHeader = c.req.header("range") as string | undefined;
    const urlReq = new URL(c.req.url);

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

    // @ts-ignore Do not understand how to fix this error.
    const konfigStore = await c.get("konfigStore") as Store<
        Record<string, unknown>
    >;

    // deno-lint-ignore prefer-const
    let queryParams = new URLSearchParams(urlReq.search);
    queryParams.delete("host");
    if (rangeHeader) {
        queryParams.append(
            "range",
            rangeHeader.split("=")[1],
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

    const fetchClient = await getFetchClient(konfigStore);

    const getGoogleVideoResponse = () =>
        fetchClient.call(
            undefined,
            `https://${host}/videoplayback?${queryParams.toString()}`,
            {
                method: "POST",
                body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses),
                headers: headersToSend,
                signal: AbortSignal.timeout(5000),
            },
        );
    let googlevideoResponse = await succeedOrRetry(5, getGoogleVideoResponse);

    if (googlevideoResponse.headers.has("location")) {
        const getRedirectedGoogleVideo = () =>
            fetchClient.call(
                undefined,
                googlevideoResponse.headers.get("location") as string,
                {
                    method: "POST",
                    body: new Uint8Array([0x78, 0]), // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses)
                    headers: headersToSend,
                    signal: AbortSignal.timeout(5000),
                },
            );
        googlevideoResponse = await succeedOrRetry(5, getRedirectedGoogleVideo);
    }

    const headersForResponse = {
        "content-length": googlevideoResponse.headers.get("content-length") ||
            "",
        "access-control-allow-origin": "*",
        "accept-ranges": googlevideoResponse.headers.get("accept-ranges") || "",
        "content-type": googlevideoResponse.headers.get("content-type") || "",
        "expires": googlevideoResponse.headers.get("expires") || "",
        "last-modified": googlevideoResponse.headers.get("last-modified") || "",
    };

    return new Response(googlevideoResponse.body, {
        status: googlevideoResponse.status,
        statusText: googlevideoResponse.statusText,
        headers: headersForResponse,
    });
});

async function succeedOrRetry(count: number, fn: () => any) {
    if (count <= 0) {
        throw Error("failed after retries");
    }

    try {
        return await fn();
    } catch (err: any) {
        return succeedOrRetry(count - 1, fn);
    }
}

export default videoPlaybackProxy;

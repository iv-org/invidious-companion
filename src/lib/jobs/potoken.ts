import { BG, buildURL, GOOG_API_KEY, USER_AGENT } from "bgutils";
import type { WebPoSignalOutput } from "bgutils";
import { JSDOM } from "jsdom";
import { Innertube, UniversalCache } from "youtubei.js";
import { Store } from "@willsoto/node-konfig-core";
import {
    youtubePlayerParsing,
    youtubeVideoInfo,
} from "../helpers/youtubePlayerHandling.ts";
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

// Adapted from https://github.com/LuanRT/BgUtils/blob/main/examples/node/index.ts
export const poTokenGenerate = async (
    innertubeClient: Innertube,
    konfigStore: Store<Record<string, unknown>>,
    innertubeClientCache: UniversalCache,
): Promise<{ innertubeClient: Innertube; tokenMinter: BG.WebPoMinter }> => {
    if (innertubeClient.session.po_token) {
        innertubeClient = await Innertube.create({
            enable_session_cache: false,
            user_agent: USER_AGENT,
            retrieve_player: false,
        });
    }

    const fetchImpl = await getFetchClient(konfigStore);

    const visitorData = innertubeClient.session.context.client.visitorData;

    if (!visitorData) {
        throw new Error("Could not get visitor data");
    }

    const dom = new JSDOM(
        '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
        {
            url: "https://www.youtube.com/",
            referrer: "https://www.youtube.com/",
            userAgent: USER_AGENT,
        },
    );

    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        location: dom.window.location,
        origin: dom.window.origin,
    });

    if (!Reflect.has(globalThis, "navigator")) {
        Object.defineProperty(globalThis, "navigator", {
            value: dom.window.navigator,
        });
    }

    const challengeResponse = await innertubeClient.getAttestationChallenge(
        "ENGAGEMENT_TYPE_UNBOUND",
    );
    if (!challengeResponse.bg_challenge) {
        throw new Error("Could not get challenge");
    }

    const interpreterUrl = challengeResponse.bg_challenge.interpreter_url
        .private_do_not_access_or_else_trusted_resource_url_wrapped_value;
    const bgScriptResponse = await fetchImpl(
        `http:${interpreterUrl}`,
    );
    const interpreterJavascript = await bgScriptResponse.text();

    if (interpreterJavascript) {
        new Function(interpreterJavascript)();
    } else throw new Error("Could not load VM");

    // Botguard currently surfaces a "Not implemented" error here, due to the environment
    // not having a valid Canvas API in JSDOM. At the time of writing, this doesn't cause
    // any issues as the Canvas check doesn't appear to be an enforced element of the checks
    console.log(
        '[INFO] the "Not implemented: HTMLCanvasElement.prototype.getContext" error is normal. Please do not open a bug report about it.',
    );
    const botguard = await BG.BotGuardClient.create({
        program: challengeResponse.bg_challenge.program,
        globalName: challengeResponse.bg_challenge.global_name,
        globalObj: globalThis,
    });

    const webPoSignalOutput: WebPoSignalOutput = [];
    const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
    const requestKey = "O43z0dpjhgX20SCx4KAo";

    const integrityTokenResponse = await fetchImpl(
        buildURL("GenerateIT", true),
        {
            method: "POST",
            headers: {
                "content-type": "application/json+protobuf",
                "x-goog-api-key": GOOG_API_KEY,
                "x-user-agent": "grpc-web-javascript/0.1",
                "user-agent": USER_AGENT,
            },
            body: JSON.stringify([requestKey, botguardResponse]),
        },
    );

    const response = await integrityTokenResponse.json() as unknown[];

    if (typeof response[0] !== "string") {
        throw new Error("Could not get integrity token");
    }

    const integrityTokenBasedMinter = await BG.WebPoMinter.create({
        integrityToken: response[0],
    }, webPoSignalOutput);

    const sessionPoToken = await integrityTokenBasedMinter.mintAsWebsafeString(
        visitorData,
    );

    const instantiatedInnertubeClient = await Innertube.create({
        enable_session_cache: false,
        po_token: sessionPoToken,
        visitor_data: visitorData,
        fetch: getFetchClient(konfigStore),
        cache: innertubeClientCache,
        generate_session_locally: true,
    });

    try {
        const feed = await instantiatedInnertubeClient.getTrending();
        // get all videos and shuffle them randomly to avoid using the same trending video over and over
        const videos = feed.videos
            .filter((video) => video.type === "Video")
            .map((value) => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);

        const video = videos.find((video) => "id" in video);
        if (!video) {
            throw new Error("no videos with id found in trending");
        }

        const youtubePlayerResponseJson = await youtubePlayerParsing({
            innertubeClient: instantiatedInnertubeClient,
            videoId: video.id,
            konfigStore,
            tokenMinter: integrityTokenBasedMinter,
            overrideCache: true,
        });
        const videoInfo = youtubeVideoInfo(
            instantiatedInnertubeClient,
            youtubePlayerResponseJson,
        );
        const validFormat = videoInfo.streaming_data?.adaptive_formats[0];
        if (!validFormat) {
            throw new Error(
                "failed to find valid video with adaptive format to check token against",
            );
        }
        const result = await fetchImpl(validFormat?.url, { method: "HEAD" });
        if (result.status !== 200) {
            throw new Error(
                `did not get a 200 when checking video, got ${result.status} instead`,
            );
        }
    } catch (err) {
        console.log("Failed to get valid PO token, will retry", { err });
        throw err;
    }

    return {
        innertubeClient: instantiatedInnertubeClient,
        tokenMinter: integrityTokenBasedMinter,
    };
};

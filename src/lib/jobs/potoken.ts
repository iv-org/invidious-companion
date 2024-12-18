import { BG } from "bgutils";
import type { BgConfig, PoTokenResult } from "bgutils";
import { JSDOM } from "jsdom";
import { Innertube, UniversalCache } from "youtubei.js";
import { Store } from "@willsoto/node-konfig-core";
import { poTokenFail } from "../../routes/index.ts";
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
): Promise<Innertube> => {
    const requestKey = "O43z0dpjhgX20SCx4KAo";

    if (innertubeClient.session.po_token) {
        innertubeClient = await Innertube.create({ retrieve_player: false });
    }

    const visitorData = innertubeClient.session.context.client.visitorData;

    if (!visitorData) {
        throw new Error("Could not get visitor data");
    }

    const dom = new JSDOM();

    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
    });

    const bgConfig: BgConfig = {
        fetch: getFetchClient(konfigStore),
        globalObj: globalThis,
        identifier: visitorData,
        requestKey,
    };

    const bgChallenge = await BG.Challenge.create(bgConfig);

    if (!bgChallenge) {
        poTokenFail.inc()
        throw new Error("Could not get challenge");
    }

    const interpreterJavascript = bgChallenge.interpreterJavascript
        .privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (interpreterJavascript) {
        new Function(interpreterJavascript)();
    } else { 
        poTokenFail.inc()
        throw new Error("Could not load VM");
    }

    let poTokenResult: PoTokenResult
    try {
        poTokenResult = await BG.PoToken.generate({
            program: bgChallenge.program,
            globalName: bgChallenge.globalName,
            bgConfig,
        });
    } catch(_) {
        poTokenFail.inc()
        throw new Error("Failed to generate a poToken")
    }

    await BG.PoToken.generatePlaceholder(visitorData);

    let innertube: Innertube
    try {
        innertube = await Innertube.create({
            po_token: poTokenResult.poToken,
            visitor_data: visitorData,
            fetch: getFetchClient(konfigStore),
            cache: innertubeClientCache,
            generate_session_locally: true,
        })
    } catch(_) {
        poTokenFail.inc()
        throw new Error("Failed to create a new Innertube session")
    }
    return innertube;
};

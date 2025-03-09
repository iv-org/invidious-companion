import { Hono } from "hono";
import { routes } from "./routes/index.ts";
import { Innertube, UniversalCache } from "youtubei.js";
import { poTokenGenerate } from "./lib/jobs/potoken.ts";
import { USER_AGENT } from "bgutils";
import { konfigLoader } from "./lib/helpers/konfigLoader.ts";
import { retry } from "jsr:@std/async";
import type { HonoVariables } from "./lib/types/HonoVariables.ts";
import type { BG } from "bgutils";

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

declare module "hono" {
    interface ContextVariableMap extends HonoVariables {}
}
const app = new Hono();
const konfigStore = await konfigLoader();

let tokenMinter: BG.WebPoMinter;
let innertubeClient: Innertube;
let innertubeClientFetchPlayer = true;
const innertubeClientOauthEnabled = konfigStore.get(
    "youtube_session.oauth_enabled",
) as boolean;
const innertubeClientJobPoTokenEnabled = konfigStore.get(
    "jobs.youtube_session.po_token_enabled",
) as boolean;
const innertubeClientCookies = konfigStore.get(
    "jobs.youtube_session.cookies",
) as string;
let innertubeClientCache = new UniversalCache(
    true,
    konfigStore.get("cache.directory") as string + "/youtubei.js/",
) as UniversalCache;

Deno.env.set("TMPDIR", konfigStore.get("cache.directory") as string);

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is active.");
        // Don't fetch fetch player yet for po_token
        innertubeClientFetchPlayer = false;
    } else if (!innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is NOT active.");
    }
} else if (innertubeClientOauthEnabled) {
    // Can't use cache if using OAuth#cacheCredentials
    innertubeClientCache = new UniversalCache(false);
}

innertubeClient = await Innertube.create({
    enable_session_cache: false,
    cache: innertubeClientCache,
    retrieve_player: innertubeClientFetchPlayer,
    fetch: getFetchClient(konfigStore),
    cookie: innertubeClientCookies || undefined,
    user_agent: USER_AGENT,
});

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        ({ innertubeClient, tokenMinter } = await retry(
            poTokenGenerate.bind(
                poTokenGenerate,
                innertubeClient,
                konfigStore,
                innertubeClientCache as UniversalCache,
            ),
            { minTimeout: 1_000, maxTimeout: 60_000, multiplier: 5, jitter: 0 },
        ));
    }
    Deno.cron(
        "regenerate youtube session",
        konfigStore.get("jobs.youtube_session.frequency") as string,
        { backoffSchedule: [5_000, 15_000, 60_000, 180_000] },
        async () => {
            if (innertubeClientJobPoTokenEnabled) {
                ({ innertubeClient, tokenMinter } = await poTokenGenerate(
                    innertubeClient,
                    konfigStore,
                    innertubeClientCache,
                ));
            } else {
                innertubeClient = await Innertube.create({
                    enable_session_cache: false,
                    cache: innertubeClientCache,
                    fetch: getFetchClient(konfigStore),
                    retrieve_player: innertubeClientFetchPlayer,
                    user_agent: USER_AGENT,
                });
            }
        },
    );
} else if (innertubeClientOauthEnabled) {
    // Fired when waiting for the user to authorize the sign in attempt.
    innertubeClient.session.on("auth-pending", (data) => {
        console.log(
            `[INFO] [OAUTH] Go to ${data.verification_url} in your browser and enter code ${data.user_code} to authenticate.`,
        );
    });
    // Fired when authentication is successful.
    innertubeClient.session.on("auth", () => {
        console.log("[INFO] [OAUTH] Sign in successful!");
    });
    // Fired when the access token expires.
    innertubeClient.session.on("update-credentials", async () => {
        console.log("[INFO] [OAUTH] Credentials updated.");
        await innertubeClient.session.oauth.cacheCredentials();
    });

    // Attempt to sign in and then cache the credentials
    await innertubeClient.session.signIn();
    await innertubeClient.session.oauth.cacheCredentials();
}

app.use("*", async (c, next) => {
    c.set("innertubeClient", innertubeClient);
    c.set("tokenMinter", tokenMinter);
    c.set("konfigStore", konfigStore);
    await next();
});

routes(app, konfigStore);

Deno.serve({
    port: Number(Deno.env.get("PORT")) ||
        konfigStore.get("server.port") as number,
    hostname: Deno.env.get("HOST") || konfigStore.get("server.host") as string,
}, app.fetch);

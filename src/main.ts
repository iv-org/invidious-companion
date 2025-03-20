import { Hono } from "hono";
import { routes } from "./routes/index.ts";
import { Innertube } from "youtubei.js";
import { poTokenGenerate, type TokenMinter } from "./lib/jobs/potoken.ts";
import { USER_AGENT } from "bgutils";
import { retry } from "@std/async";
import type { HonoVariables } from "./lib/types/HonoVariables.ts";

import { parseConfig } from "./lib/helpers/config.ts";
const config = await parseConfig();

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

setInterval(() => {
    Deno.memoryUsage();
    console.log(`[__MAIN] \
heapUsed: ${
        (Deno.memoryUsage().heapUsed / 1_000_000).toFixed(0).toString()
            .padStart(4, " ")
    }MB, \
external: ${
        (Deno.memoryUsage().external / 1_000_000).toFixed(0).toString()
            .padStart(4, " ")
    }MB, \
rss: ${
        (Deno.memoryUsage().rss / 1_000_000).toFixed(0).toString().padStart(
            4,
            " ",
        )
    }MB`);
}, 1_000);

declare module "hono" {
    interface ContextVariableMap extends HonoVariables {}
}
const app = new Hono();

let tokenMinter: TokenMinter;
let innertubeClient: Innertube;
let innertubeClientFetchPlayer = true;
const innertubeClientOauthEnabled = config.youtube_session.oauth_enabled;
const innertubeClientJobPoTokenEnabled =
    config.jobs.youtube_session.po_token_enabled;
const innertubeClientCookies = config.youtube_session.cookies;

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is active.");
        // Don't fetch fetch player yet for po_token
        innertubeClientFetchPlayer = false;
    } else if (!innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is NOT active.");
    }
}

innertubeClient = await Innertube.create({
    enable_session_cache: false,
    retrieve_player: innertubeClientFetchPlayer,
    fetch: getFetchClient(config),
    cookie: innertubeClientCookies || undefined,
    user_agent: USER_AGENT,
});

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        ({ innertubeClient, tokenMinter } = await retry(
            poTokenGenerate.bind(
                poTokenGenerate,
                config,
            ),
            { minTimeout: 1_000, maxTimeout: 60_000, multiplier: 5, jitter: 0 },
        ));
    }
    Deno.cron(
        "regenerate youtube session",
        config.jobs.youtube_session.frequency,
        { backoffSchedule: [5_000, 15_000, 60_000, 180_000] },
        async () => {
            if (innertubeClientJobPoTokenEnabled) {
                ({ innertubeClient, tokenMinter } = await poTokenGenerate(
                    config,
                ));
            } else {
                innertubeClient = await Innertube.create({
                    enable_session_cache: false,
                    fetch: getFetchClient(config),
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
    c.set("config", config);
    await next();
});

routes(app, config);

Deno.serve({
    port: config.server.port,
    hostname: config.server.host,
}, app.fetch);

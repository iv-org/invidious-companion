import { Hono } from "hono";
import { companionRoutes, miscRoutes } from "./routes/index.ts";
import { Innertube, Platform } from "youtubei.js";
import { poTokenGenerate, type TokenMinter } from "./lib/jobs/potoken.ts";
import { USER_AGENT } from "bgutils";
import { retry } from "@std/async";
import type { HonoVariables } from "./lib/types/HonoVariables.ts";
import { parseArgs } from "@std/cli/parse-args";
import { existsSync } from "@std/fs/exists";

import { parseConfig } from "./lib/helpers/config.ts";
const config = await parseConfig();
import { Metrics } from "./lib/helpers/metrics.ts";
import { PLAYER_ID } from "./constants.ts";
import { jsInterpreter } from "./lib/helpers/jsInterpreter.ts";

const args = parseArgs(Deno.args);

if (args._version_date && args._version_commit) {
    console.log(
        `[INFO] Using Invidious companion version ${args._version_date}-${args._version_commit}`,
    );
}

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

const app = new Hono({
    getPath: (req) => new URL(req.url).pathname,
});
const companionApp = new Hono({
    getPath: (req) => new URL(req.url).pathname,
}).basePath(config.server.base_path);
const metrics = config.server.enable_metrics ? new Metrics() : undefined;

let tokenMinter: TokenMinter | undefined;
let innertubeClient: Innertube;
let innertubeClientFetchPlayer = true;
const innertubeClientOauthEnabled = config.youtube_session.oauth_enabled;
const innertubeClientJobPoTokenEnabled =
    config.jobs.youtube_session.po_token_enabled;
const innertubeClientCookies = config.youtube_session.cookies;

// Promise that resolves when tokenMinter initialization is complete (for tests)
let tokenMinterReadyResolve: (() => void) | undefined;
export const tokenMinterReady = new Promise<void>((resolve) => {
    tokenMinterReadyResolve = resolve;
});

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is active.");
        // Don't fetch fetch player yet for po_token
        innertubeClientFetchPlayer = false;
    } else if (!innertubeClientJobPoTokenEnabled) {
        console.log("[INFO] job po_token is NOT active.");
    }
}

Platform.shim.eval = jsInterpreter;

innertubeClient = await Innertube.create({
    enable_session_cache: false,
    retrieve_player: innertubeClientFetchPlayer,
    fetch: getFetchClient(config),
    cookie: innertubeClientCookies || undefined,
    user_agent: USER_AGENT,
    player_id: PLAYER_ID,
});

if (!innertubeClientOauthEnabled) {
    if (innertubeClientJobPoTokenEnabled) {
        // Initialize tokenMinter in background to not block server startup
        console.log("[INFO] Starting PO token generation in background...");
        retry(
            poTokenGenerate.bind(
                poTokenGenerate,
                config,
                metrics,
            ),
            { minTimeout: 1_000, maxTimeout: 60_000, multiplier: 5, jitter: 0 },
        ).then((result) => {
            innertubeClient = result.innertubeClient;
            tokenMinter = result.tokenMinter;
            tokenMinterReadyResolve?.();
        }).catch((err) => {
            console.error("[ERROR] Failed to initialize PO token:", err);
            metrics?.potokenGenerationFailure.inc();
            tokenMinterReadyResolve?.();
        });
    } else {
        // If PO token is not enabled, resolve immediately
        tokenMinterReadyResolve?.();
    }
    Deno.cron(
        "regenerate youtube session",
        config.jobs.youtube_session.frequency,
        { backoffSchedule: [5_000, 15_000, 60_000, 180_000] },
        async () => {
            if (innertubeClientJobPoTokenEnabled) {
                try {
                    ({ innertubeClient, tokenMinter } = await poTokenGenerate(
                        config,
                        metrics,
                    ));
                } catch (err) {
                    metrics?.potokenGenerationFailure.inc();
                    throw err;
                }
            } else {
                innertubeClient = await Innertube.create({
                    enable_session_cache: false,
                    fetch: getFetchClient(config),
                    retrieve_player: innertubeClientFetchPlayer,
                    user_agent: USER_AGENT,
                    cookie: innertubeClientCookies || undefined,
                    player_id: PLAYER_ID,
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
    // Resolve promise for tests
    tokenMinterReadyResolve?.();
}

companionApp.use("*", async (c, next) => {
    c.set("innertubeClient", innertubeClient);
    c.set("tokenMinter", tokenMinter);
    c.set("config", config);
    c.set("metrics", metrics);
    await next();
});
companionRoutes(companionApp, config);

app.use("*", async (c, next) => {
    c.set("metrics", metrics);
    await next();
});
miscRoutes(app, config);

app.route("/", companionApp);

// This cannot be changed since companion restricts the
// files it can access using deno `--allow-write` argument
const udsPath = config.server.unix_socket_path;

export function run(signal: AbortSignal, port: number, hostname: string) {
    if (config.server.use_unix_socket) {
        try {
            if (existsSync(udsPath)) {
                // Delete the unix domain socket manually before starting the server
                Deno.removeSync(udsPath);
            }
        } catch (err) {
            console.log(
                `[ERROR] Failed to delete unix domain socket '${udsPath}' before starting the server:`,
                err,
            );
        }

        const srv = Deno.serve(
            {
                onListen() {
                    Deno.chmodSync(udsPath, 0o777);
                    console.log(
                        `[INFO] Server successfully started at ${udsPath} with permissions set to 777.`,
                    );
                },
                signal: signal,
                path: udsPath,
            },
            app.fetch,
        );

        return srv;
    } else {
        return Deno.serve(
            {
                onListen() {
                    console.log(
                        `[INFO] Server successfully started at http://${config.server.host}:${config.server.port}${config.server.base_path}`,
                    );
                },
                signal: signal,
                port: port,
                hostname: hostname,
            },
            app.fetch,
        );
    }
}
if (import.meta.main) {
    const controller = new AbortController();
    const { signal } = controller;
    run(signal, config.server.port, config.server.host);

    Deno.addSignalListener("SIGTERM", () => {
        console.log("Caught SIGINT, shutting down...");
        controller.abort();
        Deno.exit(0);
    });

    Deno.addSignalListener("SIGINT", () => {
        console.log("Caught SIGINT, shutting down...");
        controller.abort();
        Deno.exit(0);
    });
}

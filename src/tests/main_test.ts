import { test } from "node:test";

process.env.SERVER_SECRET_KEY = "aaaaaaaaaaaaaaaa";
const { run, tokenMinterReady } = await import("../main.ts");

const { parseConfig } = await import("../lib/helpers/config.ts");
const config = await parseConfig();

import { dashManifest } from "./dashManifest.ts";
import { latestVersion } from "./latestVersion.ts";
import { youtubePlayer } from "./youtubePlayer.ts";

test("Checking if Invidious companion works", async (t) => {
    const controller = new AbortController();
    const baseUrl = `http://${config.server.host}:${config.server.port.toString()}${config.server.base_path}`;
    const headers = { Authorization: "Bearer aaaaaaaaaaaaaaaa" };

    await run(
        controller.signal,
        config.server.port,
        config.server.host,
    );

    // Wait for tokenMinter to be ready before running tests
    await tokenMinterReady;

    await t.test(
        "Check if it can get an OK playabilityStatus on /youtubei/v1/player",
        youtubePlayer.bind(null, baseUrl, headers),
    );

    await t.test(
        "Check if it can generate a DASH manifest",
        dashManifest.bind(null, baseUrl),
    );

    await t.test(
        "Check if it can generate a valid URL for latest_version",
        latestVersion.bind(null, baseUrl),
    );

    await controller.abort();
});

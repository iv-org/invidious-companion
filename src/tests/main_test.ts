Deno.env.set("SERVER_SECRET_KEY", "aaaaaaaaaaaaaaaa");
const { run } = await import("../main.ts");

import { dashManifest } from "./dashManifest.ts";
import { youtubePlayer } from "./youtubePlayer.ts";
import { latestVersion } from "./latestVersion.ts";

Deno.test({
    name: "Checking if Invidious companion works",
    async fn(t) {
        const controller = new AbortController();
        const port = 8282;
        const baseUrl = `http://localhost:${port.toString()}`;
        const headers = { Authorization: "Bearer aaaaaaaaaaaaaaaa" };

        await run(
            controller.signal,
            port,
            "localhost",
        );

        await t.step(
            "Check if it can get an OK playabilityStatus on /youtubei/v1/player",
            youtubePlayer.bind(null, baseUrl, headers),
        );

        await t.step(
            "Check if it can generate a DASH manifest",
            dashManifest.bind(null, baseUrl),
        );

        await t.step(
            "Check if it can generate a valid URL for latest_version",
            latestVersion.bind(null, baseUrl),
        );

        await controller.abort();
    },
    // need to disable leaks test for now because we are leaking resources when using HTTPClient using a proxy
    sanitizeResources: false,
});

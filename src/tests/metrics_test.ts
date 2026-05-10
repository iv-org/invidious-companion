import { assertExists } from "jsr:@std/assert@1";
import { Metrics } from "../lib/helpers/metrics.ts";

Deno.test("Metrics - new counters exist and are incrementable", () => {
    const metrics = new Metrics();

    // Test gracefulShutdowns
    assertExists(metrics.gracefulShutdowns, "gracefulShutdowns counter should exist");
    metrics.gracefulShutdowns.inc();

    // Test videoPlaybackRequests
    assertExists(metrics.videoPlaybackRequests, "videoPlaybackRequests counter should exist");
    metrics.videoPlaybackRequests.inc();

    // Test poTokenGenerationSuccess
    assertExists(metrics.poTokenGenerationSuccess, "poTokenGenerationSuccess counter should exist");
    metrics.poTokenGenerationSuccess.inc();

    // Also verify existing important counters still work
    assertExists(metrics.cacheHit, "cacheHit counter should exist");
    assertExists(metrics.ipv6Fallback, "ipv6Fallback counter should exist");
});

Deno.test("Metrics - registry contains all expected metrics", () => {
    const metrics = new Metrics();
    const metricNames = Array.from(metrics.register.getMetricsAsArray()).map(m => m.name);

    const expectedNewMetrics = [
        "invidious_companion_graceful_shutdowns_total",
        "invidious_companion_video_playback_requests_total",
        "invidious_companion_potoken_generation_success_total",
    ];

    for (const expected of expectedNewMetrics) {
        assertExists(
            metricNames.find(name => name === expected),
            `Expected metric ${expected} not found in registry`
        );
    }
});

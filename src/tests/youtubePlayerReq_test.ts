import "youtubei.js";
import NavigationEndpoint from "youtubei.js/NavigationEndpoint";
import { assert, assertEquals } from "./deps.ts";

const { youtubePlayerReq } = await import(
    "../lib/helpers/youtubePlayerReq.ts"
);

const VIDEO_ID = "2wUJ-x8vR0s";

function playableResponse(client: string) {
    return {
        playabilityStatus: { status: "OK" },
        videoDetails: { videoId: VIDEO_ID, client },
        streamingData: {
            expiresInSeconds: "21600",
            formats: [{ itag: 18, url: "https://example.com/video.mp4" }],
            adaptiveFormats: [{
                itag: 140,
                url: "https://example.com/audio.mp4",
            }],
        },
    };
}

function unavailableResponse(reason: string) {
    return {
        playabilityStatus: { status: "ERROR", reason },
        videoDetails: { videoId: VIDEO_ID, client: "WEB" },
    };
}

// Stub the watch endpoint so the fallback branches can be tested without
// relying on live YouTube responses.
function stubClients(clients: Record<string, unknown>) {
    const calls: string[] = [];
    const originalCall = NavigationEndpoint.prototype.call;
    (NavigationEndpoint.prototype as unknown as { call: unknown }).call =
        function (_actions: unknown, payload: { client: string }) {
            calls.push(payload.client);
            const value = clients[payload.client];
            if (value instanceof Error) {
                return Promise.reject(value);
            }
            return Promise.resolve({
                success: true,
                status_code: 200,
                data: value,
            });
        };
    return {
        calls,
        restore: () => {
            (NavigationEndpoint.prototype as unknown as { call: unknown })
                .call = originalCall;
        },
    };
}

function requestPlayer() {
    return youtubePlayerReq(
        { actions: {}, session: { player: null } } as never,
        VIDEO_ID,
        { youtube_session: { oauth_enabled: false } } as never,
        (() => Promise.resolve("test-pot")) as never,
    );
}

Deno.test("player fallback recovery", async (t) => {
    await t.step(
        "uses a fallback when the primary has no streamingData",
        async () => {
            const stub = stubClients({
                WEB: unavailableResponse("Video unavailable"),
                TV_SIMPLY: playableResponse("TV_SIMPLY"),
            });
            try {
                const result = await requestPlayer();
                assertEquals(stub.calls, ["WEB", "TV_SIMPLY"]);
                assertEquals(result.data.playabilityStatus?.status, "OK");
                assertEquals(result.data.videoDetails?.client, "TV_SIMPLY");
                assert(result.data.streamingData?.adaptiveFormats?.length);
            } finally {
                stub.restore();
            }
        },
    );

    await t.step(
        "keeps captions from the accepted fallback",
        async () => {
            const captions = {
                playerCaptionsTracklistRenderer: {
                    captionTracks: [{
                        languageCode: "en",
                        baseUrl: "https://example.com/captions",
                    }],
                },
            };
            const fallback = playableResponse("TV_SIMPLY");
            (fallback as unknown as { captions: unknown }).captions = captions;
            const stub = stubClients({
                WEB: unavailableResponse("Video unavailable"),
                TV_SIMPLY: fallback,
            });
            try {
                const result = await requestPlayer();
                assertEquals(
                    (result.data as unknown as { captions: unknown }).captions,
                    captions,
                );
            } finally {
                stub.restore();
            }
        },
    );

    await t.step(
        "skips candidates with SABR-only adaptive formats",
        async () => {
            const unusable = playableResponse("TV_SIMPLY");
            unusable.streamingData.adaptiveFormats = [{}] as never;
            const stub = stubClients({
                WEB: unavailableResponse("Video unavailable"),
                TV_SIMPLY: unusable,
                ANDROID: playableResponse("ANDROID"),
            });
            try {
                const result = await requestPlayer();
                assertEquals(stub.calls, ["WEB", "TV_SIMPLY", "ANDROID"]);
                assertEquals(result.data.videoDetails?.client, "ANDROID");
                assert(result.data.streamingData?.adaptiveFormats?.length);
            } finally {
                stub.restore();
            }
        },
    );

    await t.step(
        "skips candidates with SABR-only regular formats",
        async () => {
            const unusable = playableResponse("TV_SIMPLY");
            unusable.streamingData.formats = [{}] as never;
            const stub = stubClients({
                WEB: unavailableResponse("Video unavailable"),
                TV_SIMPLY: unusable,
                ANDROID: playableResponse("ANDROID"),
            });
            try {
                const result = await requestPlayer();
                assertEquals(stub.calls, ["WEB", "TV_SIMPLY", "ANDROID"]);
                assertEquals(result.data.videoDetails?.client, "ANDROID");
            } finally {
                stub.restore();
            }
        },
    );

    await t.step("does not retain undecipherable primary formats", async () => {
        const primary = unavailableResponse("Video unavailable");
        (primary as { streamingData?: unknown }).streamingData = {
            formats: [{ itag: 18 }],
            adaptiveFormats: [{}],
        };
        const fallback = playableResponse("TV_SIMPLY");
        fallback.streamingData.formats = [];
        const stub = stubClients({
            WEB: primary,
            TV_SIMPLY: fallback,
        });
        try {
            const result = await requestPlayer();
            assertEquals(result.data.playabilityStatus?.status, "OK");
            assertEquals(result.data.streamingData?.formats?.length, 0);
            assert(result.data.streamingData?.adaptiveFormats?.length);
        } finally {
            stub.restore();
        }
    });

    await t.step(
        "preserves the original error when every fallback fails",
        async () => {
            const stub = stubClients({
                WEB: unavailableResponse("Video unavailable"),
                TV_SIMPLY: new Error("503 Service Unavailable"),
                ANDROID: new Error("connection reset"),
                ANDROID_VR: new Error("timeout"),
                MWEB: new Error("timeout"),
            });
            try {
                const result = await requestPlayer();
                assertEquals(
                    stub.calls,
                    ["WEB", "TV_SIMPLY", "ANDROID", "ANDROID_VR", "MWEB"],
                );
                assertEquals(result.data.playabilityStatus?.status, "ERROR");
                assertEquals(
                    result.data.playabilityStatus?.reason,
                    "Video unavailable",
                );
            } finally {
                stub.restore();
            }
        },
    );
});

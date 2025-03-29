import { assert, assertEquals } from "./deps.ts";

export async function youtubePlayer(
    baseUrl: string,
    headers: { Authorization: string },
) {
    const resp = await fetch(`${baseUrl}/youtubei/v1/player`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            videoId: "jNQXAC9IVRw",
        }),
    });

    assertEquals(resp.status, 200, "response status code is not 200");

    const youtubeV1Player = await resp.json();

    assertEquals(
        youtubeV1Player.playabilityStatus?.status,
        "OK",
        "playabilityStatus is not OK",
    );
    assertEquals(
        youtubeV1Player.videoDetails?.videoId,
        "jNQXAC9IVRw",
        "videoDetails is not jNQXAC9IVRw",
    );
    assert(
        youtubeV1Player.streamingData?.adaptiveFormats,
        "adaptiveFormats is not present",
    );
    assert(
        youtubeV1Player.streamingData?.adaptiveFormats.length > 0,
        "adaptiveFormats is empty",
    );
}

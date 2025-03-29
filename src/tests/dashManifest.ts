import { assertEquals } from "./deps.ts";

export async function dashManifest(baseUrl: string) {
    const resp = await fetch(
        `${baseUrl}/api/manifest/dash/id/jNQXAC9IVRw?local=true&unique_res=1`,
        {
            method: "GET",
        },
    );

    await resp.body?.cancel();
    assertEquals(resp.status, 200, "response status code is not 200");
}

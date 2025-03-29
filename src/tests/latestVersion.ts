import { assertEquals } from "./deps.ts";

export async function latestVersion(baseUrl: string) {
    const resp = await fetch(
        `${baseUrl}/latest_version?id=jNQXAC9IVRw&itag=18&local=true`,
        {
            method: "GET",
            redirect: "manual",
        },
    );

    await resp.body?.cancel();
    assertEquals(resp.status, 302);
}

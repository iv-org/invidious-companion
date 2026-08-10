import { type Browser, firefox } from "playwright-core";
import { sampleWebGL } from "./webgl.ts";

type FingerprintOperatingSystem = "linux" | "macos" | "windows";

const CAMOU_CONFIG_PREFIX = "CAMOU_CONFIG_";

export async function launchCamoufox(
    operatingSystem: FingerprintOperatingSystem,
): Promise<Browser> {
    const { launchOptions } = await import("camoufox-js");
    const webGLFingerprint = sampleWebGL(toCamoufoxOperatingSystem(
        operatingSystem,
    ));
    const webGl2Enabled = webGLFingerprint.webGl2Enabled;
    delete webGLFingerprint.webGl2Enabled;

    // Camoufox 0.12 opens its read-only fingerprint DB in write mode. Skip that
    // internal query, then restore the same sampled WebGL config before launch.
    // Revalidate the DB path and CAMOU_CONFIG protocol on camoufox-js upgrades.
    const options = await launchOptions({
        block_webrtc: true,
        block_webgl: true,
        enable_cache: false,
        exclude_addons: ["UBO"],
        geoip: false,
        headless: true,
        i_know_what_im_doing: true,
        os: operatingSystem,
        timeout: 60_000,
    });
    options.firefoxUserPrefs ??= {};
    options.firefoxUserPrefs["webgl.disabled"] = false;
    options.firefoxUserPrefs["webgl.enable-webgl2"] = webGl2Enabled;
    options.firefoxUserPrefs["webgl.force-enabled"] = true;
    injectFingerprint(
        options.env ??= {},
        webGLFingerprint,
        operatingSystem === "windows" ? 2_047 : 32_767,
    );

    return await firefox.launch(options);
}

function injectFingerprint(
    environment: Record<string, string | number | boolean>,
    fingerprint: Record<string, unknown>,
    chunkSize: number,
): void {
    const chunks = Object.entries(environment)
        .filter(([key]) => key.startsWith(CAMOU_CONFIG_PREFIX))
        .map(([key, value]) =>
            [
                Number(key.slice(CAMOU_CONFIG_PREFIX.length)),
                String(value),
            ] as const
        )
        .sort(([left], [right]) => left - right);
    const config = JSON.parse(chunks.map(([, value]) => value).join(""));
    Object.assign(config, fingerprint);
    for (const [key] of chunks) {
        delete environment[`${CAMOU_CONFIG_PREFIX}${key}`];
    }

    const serialized = JSON.stringify(config);
    for (
        let offset = 0, index = 1;
        offset < serialized.length;
        offset += chunkSize, index++
    ) {
        environment[`${CAMOU_CONFIG_PREFIX}${index}`] = serialized.slice(
            offset,
            offset + chunkSize,
        );
    }
}

function toCamoufoxOperatingSystem(
    operatingSystem: FingerprintOperatingSystem,
): "lin" | "mac" | "win" {
    if (operatingSystem === "macos") return "mac";
    if (operatingSystem === "windows") return "win";
    return "lin";
}

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Derived from https://github.com/apify/camoufox-js/blob/master/src/pkgman.ts
//
// Runtime installer used outside Docker (dev / non-container). The Docker
// image instead ships docker/camoufox-bootstrap.go, which installs the same
// browser from a baked-in zip with no network. Both installers read the
// committed dependencies.json for the target version
// (`.camoufox.linux[<arch>].version` = "vX.Y.Z-release", plus `.sha256`), so
// keep that parsing in lockstep across the two. (version.json is the generated
// install marker, not a committed file; see installCamoufox below.)

import { dirname, join } from "@std/path";
import { Unzip, UnzipInflate } from "fflate";
import { createHash } from "node:crypto";

const CAMOUFOX_REPOSITORY = "daijro/camoufox";
const DOWNLOAD_RETRIES = 5;
const DEPENDENCIES_URL = new URL("../../../dependencies.json", import.meta.url);

const ARCHITECTURES: Partial<Record<typeof Deno.build.arch, string>> = {
    x86_64: "x86_64",
    aarch64: "arm64",
};

const OPERATING_SYSTEMS: Partial<Record<typeof Deno.build.os, string>> = {
    darwin: "mac",
    linux: "lin",
    windows: "win",
};

interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    assets: GitHubAsset[];
}

interface CamoufoxVersion {
    digest: string;
    release: string;
    tag: string;
    version: string;
}

interface Dependencies {
    camoufox?: {
        linux?: Record<string, { version?: string; sha256?: string }>;
    };
}

export async function isConfiguredCamoufoxInstalled(
    installDirectory: string,
): Promise<boolean> {
    const executable = await Deno.stat(join(installDirectory, "camoufox-bin"));
    if (!executable.isFile) return false;
    const configured = await readConfiguredVersion();
    const installed = JSON.parse(
        await Deno.readTextFile(join(installDirectory, "version.json")),
    ) as { version?: string; release?: string };
    return installed.version === configured.version &&
        installed.release === configured.release;
}

export async function installCamoufox(
    installDirectory: string,
): Promise<void> {
    // Keep version.json and extracted layout aligned with
    // docker/camoufox-bootstrap.go, which seeds the Distroless volume.
    const version = await readConfiguredVersion();
    const url = await getReleaseUrl(version);
    const installParent = dirname(installDirectory);
    await Deno.mkdir(installParent, { recursive: true });
    const stagingDirectory = await Deno.makeTempDir({
        dir: installParent,
        prefix: ".camoufox-install-",
    });
    const archivePath = join(stagingDirectory, "camoufox.zip");
    const extractedDirectory = join(stagingDirectory, "browser");

    try {
        console.log("[INFO] Downloading Camoufox", {
            version: version.tag,
        });
        const digest = await downloadFile(url, archivePath);
        if (digest !== version.digest) {
            throw new Error(
                `Camoufox checksum mismatch: expected ${version.digest}, got ${digest}`,
            );
        }
        await extractArchive(archivePath, extractedDirectory);
        await Deno.writeTextFile(
            join(extractedDirectory, "version.json"),
            JSON.stringify({
                version: version.version,
                release: version.release,
            }),
        );
        if (Deno.build.os !== "windows") {
            await makeExecutable(extractedDirectory);
        }

        await Deno.remove(installDirectory, { recursive: true }).catch(
            (error) => {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            },
        );
        await Deno.rename(extractedDirectory, installDirectory);
        console.log("[INFO] Camoufox was installed", { installDirectory });
    } finally {
        await Deno.remove(stagingDirectory, { recursive: true }).catch(
            () => {},
        );
    }
}

async function readConfiguredVersion(): Promise<CamoufoxVersion> {
    const architecture = ARCHITECTURES[Deno.build.arch];
    if (!architecture) {
        throw new Error(`Camoufox does not support ${Deno.build.arch}`);
    }
    const dependencies = JSON.parse(
        await Deno.readTextFile(DEPENDENCIES_URL),
    ) as Dependencies;
    const configured = dependencies.camoufox?.linux?.[architecture];
    const match = configured?.version?.match(/^v(\d+(?:\.\d+)+)-(.+)$/);
    if (!match) {
        throw new Error(`No valid Camoufox version for ${architecture}`);
    }
    if (!configured?.sha256?.match(/^[a-f0-9]{64}$/)) {
        throw new Error(`No valid Camoufox checksum for ${architecture}`);
    }
    return {
        tag: `v${match[1]}-${match[2]}`,
        version: match[1],
        release: match[2],
        digest: configured.sha256,
    };
}

async function getReleaseUrl(version: CamoufoxVersion): Promise<string> {
    const operatingSystem = OPERATING_SYSTEMS[Deno.build.os];
    if (!operatingSystem) {
        throw new Error(`Camoufox does not support ${Deno.build.os}`);
    }
    const architecture = ARCHITECTURES[Deno.build.arch];
    if (!architecture) {
        throw new Error(`Camoufox does not support ${Deno.build.arch}`);
    }

    const apiUrl =
        `https://api.github.com/repos/${CAMOUFOX_REPOSITORY}/releases/tags/${version.tag}`;
    const response = await fetchWithRetries(apiUrl);
    const release = await response.json() as GitHubRelease;
    const assetName =
        `camoufox-${version.version}-${version.release}-${operatingSystem}.${architecture}.zip`;
    const asset = release.assets.find((candidate) =>
        candidate.name === assetName
    );
    if (!asset) {
        throw new Error(`Camoufox release ${version.tag} has no ${assetName}`);
    }
    return asset.browser_download_url;
}

async function downloadFile(url: string, destination: string): Promise<string> {
    const response = await fetchWithRetries(url);
    if (!response.body) throw new Error("Camoufox download had no body");
    const file = await Deno.create(destination);
    const digest = createHash("sha256");
    try {
        for await (const chunk of response.body) {
            digest.update(chunk);
            await writeAll(file, chunk);
        }
    } finally {
        file.close();
    }
    return digest.digest("hex");
}

async function fetchWithRetries(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers: authorizationHeaders(url),
            });
            if (response.ok) return response;
            await response.body?.cancel();
            lastError = new Error(
                `Camoufox download returned HTTP ${response.status}`,
            );
        } catch (error) {
            lastError = error;
        }
        if (attempt < DOWNLOAD_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
    }
    throw new Error(
        `Failed to download ${url} after ${DOWNLOAD_RETRIES} attempts`,
        { cause: lastError },
    );
}

function authorizationHeaders(url: string): HeadersInit {
    const token = Deno.env.get("GITHUB_TOKEN");
    const host = new URL(url).hostname;
    return token && (host === "api.github.com" || host === "github.com")
        ? { authorization: `Bearer ${token}` }
        : {};
}

async function extractArchive(
    archivePath: string,
    destination: string,
): Promise<void> {
    await Deno.mkdir(destination, { recursive: true });
    const openFiles = new Set<Deno.FsFile>();
    let extractionError: unknown;
    const archive = new Unzip((entry) => {
        try {
            const outputPath = safeArchivePath(destination, entry.name);
            if (entry.name.endsWith("/")) {
                Deno.mkdirSync(outputPath, { recursive: true });
                entry.ondata = (error) => {
                    if (error) extractionError = error;
                };
            } else {
                Deno.mkdirSync(dirname(outputPath), { recursive: true });
                const output = Deno.createSync(outputPath);
                openFiles.add(output);
                let closed = false;
                const closeOutput = () => {
                    if (closed) return;
                    closed = true;
                    output.close();
                    openFiles.delete(output);
                };
                entry.ondata = (error, data, final) => {
                    if (closed) return;
                    if (error) {
                        extractionError = error;
                        closeOutput();
                        return;
                    }
                    try {
                        writeAllSync(output, data);
                    } catch (writeError) {
                        extractionError = writeError;
                        closeOutput();
                        return;
                    }
                    if (final) closeOutput();
                };
            }
            entry.start();
        } catch (error) {
            extractionError = error;
            entry.terminate();
        }
    });
    archive.register(UnzipInflate);

    try {
        const source = await Deno.open(archivePath, { read: true });
        for await (const chunk of source.readable) {
            archive.push(chunk);
            if (extractionError) throw extractionError;
        }
        archive.push(new Uint8Array(), true);
        if (extractionError) throw extractionError;
    } finally {
        for (const file of openFiles) file.close();
    }
}

async function writeAll(file: Deno.FsFile, data: Uint8Array): Promise<void> {
    let written = 0;
    while (written < data.length) {
        written += await file.write(data.subarray(written));
    }
}

function safeArchivePath(destination: string, entryName: string): string {
    const segments = entryName.replaceAll("\\", "/").split("/").filter(
        Boolean,
    );
    if (
        entryName.startsWith("/") ||
        segments.some((segment) => segment === "..")
    ) {
        throw new Error(`Unsafe Camoufox archive path: ${entryName}`);
    }
    return join(destination, ...segments);
}

function writeAllSync(file: Deno.FsFile, data: Uint8Array): void {
    let written = 0;
    while (written < data.length) {
        written += file.writeSync(data.subarray(written));
    }
}

async function makeExecutable(directory: string): Promise<void> {
    await Deno.chmod(directory, 0o755);
    for await (const entry of Deno.readDir(directory)) {
        const path = join(directory, entry.name);
        if (entry.isDirectory) await makeExecutable(path);
        else await Deno.chmod(path, 0o755);
    }
}

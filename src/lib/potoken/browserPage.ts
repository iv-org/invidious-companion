// The functions below run BotGuard and mint PO tokens *inside the browser
// page* (real Firefox), so they reimplement by hand what bgutils'
// `BG.BotGuardClient` and `BG.WebPoMinter` do in Node — see
// https://github.com/LuanRT/BgUtils. The VM argument order and the short
// error codes (PMD:*, APF:*, ODM:*) mirror that library; revisit both if
// BotGuard changes. The JSDOM fallback (jobs/worker.ts) still uses bgutils
// directly.
import type { Page, Route } from "playwright-core";
import type { AttestationChallenge } from "./attestation.ts";

const PAGE_URL = "https://www.youtube.com/__invidious_companion_potoken__";
const STATE_PROPERTY = "__invidiousCompanionPoTokenState";
const OPERATION_TIMEOUT_MS = 10_000;

export async function initializePoTokenPage(page: Page): Promise<void> {
    await page.route("**/*", handlePageRoute);
    const response = await page.goto(PAGE_URL, {
        waitUntil: "domcontentloaded",
    });
    if (!response?.ok()) {
        throw new Error(
            `Could not initialize browser PO token page: ${response?.status()}`,
        );
    }
}

async function handlePageRoute(route: Route): Promise<void> {
    const request = route.request();
    if (
        request.url() === PAGE_URL && request.isNavigationRequest() &&
        request.resourceType() === "document"
    ) {
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body:
                '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
        });
        return;
    }
    await route.abort("blockedbyclient");
}

export function runBotGuard(
    page: Page,
    generationId: string,
    challenge: AttestationChallenge,
): Promise<string> {
    // Mirrors BG.BotGuardClient and BG.WebPoMinter inside the real browser
    // context. Keep this flow aligned with BgUtils when its VM contract changes.
    return page.evaluate(
        async ({ challenge, generationId, stateProperty, timeoutMs }) => {
            type VMFunctions = {
                asyncSnapshotFunction: (
                    callback: (response: unknown) => void,
                    args: unknown[],
                ) => unknown;
                shutdownFunction?: () => unknown;
            };
            type GenerationState = {
                webPoSignalOutput: unknown[];
                shutdownFunction?: () => unknown;
                mintCallback?: (identifier: Uint8Array) => unknown;
            };
            type RootState = {
                generations: Record<string, GenerationState>;
            };

            const root = globalThis as
                & typeof globalThis
                & Record<string, unknown>;
            const state = (root[stateProperty] ??= {
                generations: {},
            }) as RootState;
            new Function(challenge.interpreterJavascript)();
            const vm = root[challenge.globalName] as
                | { a?: (...args: unknown[]) => unknown }
                | undefined;
            if (!vm?.a) throw new Error("BotGuard VM was unavailable");

            const webPoSignalOutput: unknown[] = [];
            const vmFunctions = await new Promise<VMFunctions>(
                (resolve, reject) => {
                    let functions: VMFunctions | undefined;
                    let programLoaded = false;
                    let settled = false;
                    const timer = setTimeout(
                        () =>
                            reject(
                                new Error("BotGuard initialization timed out"),
                            ),
                        timeoutMs,
                    );
                    const finish = () => {
                        if (!settled && functions && programLoaded) {
                            settled = true;
                            clearTimeout(timer);
                            resolve(functions);
                        }
                    };
                    const fail = (error: unknown) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        reject(error);
                    };
                    const noOp = () => {};
                    try {
                        const result = vm.a!(
                            challenge.program,
                            (snapshot: unknown, shutdown: unknown) => {
                                if (typeof snapshot !== "function") {
                                    fail(
                                        new Error(
                                            "Snapshot function was unavailable",
                                        ),
                                    );
                                    return;
                                }
                                functions = {
                                    asyncSnapshotFunction:
                                        snapshot as VMFunctions[
                                            "asyncSnapshotFunction"
                                        ],
                                    shutdownFunction:
                                        typeof shutdown === "function"
                                            ? shutdown as () => unknown
                                            : undefined,
                                };
                                finish();
                            },
                            true,
                            undefined,
                            noOp,
                            [[], []],
                            undefined,
                            false,
                            undefined,
                        );
                        const synchronousSnapshot = Array.isArray(result)
                            ? result[0]
                            : result;
                        Promise.resolve(synchronousSnapshot).then(() => {
                            programLoaded = true;
                            finish();
                        }).catch(fail);
                    } catch (error) {
                        fail(error);
                    }
                },
            );

            state.generations[generationId] = {
                webPoSignalOutput,
                shutdownFunction: vmFunctions.shutdownFunction,
            };
            try {
                return await new Promise<string>((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error("BotGuard snapshot timed out")),
                        timeoutMs,
                    );
                    const fail = (error: unknown) => {
                        clearTimeout(timer);
                        reject(error);
                    };
                    try {
                        const result = vmFunctions.asyncSnapshotFunction(
                            (value) => {
                                clearTimeout(timer);
                                if (typeof value === "string" && value) {
                                    resolve(value);
                                } else {
                                    reject(
                                        new Error(
                                            "BotGuard snapshot was invalid",
                                        ),
                                    );
                                }
                            },
                            [
                                undefined,
                                undefined,
                                webPoSignalOutput,
                                undefined,
                            ],
                        );
                        Promise.resolve(result).catch(fail);
                    } catch (error) {
                        fail(error);
                    }
                });
            } catch (error) {
                delete state.generations[generationId];
                vmFunctions.shutdownFunction?.();
                throw error;
            }
        },
        {
            challenge,
            generationId,
            stateProperty: STATE_PROPERTY,
            timeoutMs: OPERATION_TIMEOUT_MS,
        },
    );
}

export function createMinter(
    page: Page,
    generationId: string,
    integrityToken: string,
): Promise<void> {
    return page.evaluate(
        async ({ generationId, integrityToken, stateProperty }) => {
            type GenerationState = {
                webPoSignalOutput: unknown[];
                mintCallback?: (identifier: Uint8Array) => unknown;
            };
            type RootState = {
                generations: Record<string, GenerationState>;
            };
            const root = globalThis as
                & typeof globalThis
                & Record<string, unknown>;
            const state = (root[stateProperty] as RootState | undefined)
                ?.generations[generationId];
            if (!state) throw new Error("BotGuard state was unavailable");
            const getMinter = state.webPoSignalOutput[0];
            if (typeof getMinter !== "function") {
                throw new Error("PMD:Undefined");
            }

            let normalized = integrityToken
                .replace(/-/g, "+")
                .replace(/_/g, "/")
                .replace(/\./g, "=");
            normalized += "=".repeat((4 - normalized.length % 4) % 4);
            const bytes = Uint8Array.from(
                atob(normalized),
                (character) => character.charCodeAt(0),
            );
            const mintCallback = await getMinter(bytes);
            if (typeof mintCallback !== "function") {
                throw new Error("APF:Failed");
            }
            state.mintCallback = mintCallback as (
                identifier: Uint8Array,
            ) => unknown;
        },
        { generationId, integrityToken, stateProperty: STATE_PROPERTY },
    );
}

export function mintOnPage(
    page: Page,
    generationId: string,
    contentBinding: string,
): Promise<string> {
    return page.evaluate(
        async ({ contentBinding, generationId, stateProperty, timeoutMs }) => {
            type GenerationState = {
                mintCallback?: (identifier: Uint8Array) => unknown;
            };
            type RootState = {
                generations: Record<string, GenerationState>;
            };
            const root = globalThis as
                & typeof globalThis
                & Record<string, unknown>;
            const state = (root[stateProperty] as RootState | undefined)
                ?.generations[generationId];
            if (typeof state?.mintCallback !== "function") {
                throw new Error("PO token minter was unavailable");
            }

            const result = await Promise.race([
                state.mintCallback(new TextEncoder().encode(contentBinding)),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error("PO token mint timed out")),
                        timeoutMs,
                    )
                ),
            ]);
            if (!(result instanceof Uint8Array)) throw new Error("ODM:Invalid");
            let binary = "";
            for (const byte of result) binary += String.fromCharCode(byte);
            return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
        },
        {
            contentBinding,
            generationId,
            stateProperty: STATE_PROPERTY,
            timeoutMs: OPERATION_TIMEOUT_MS,
        },
    );
}

export function destroyGenerationOnPage(
    page: Page,
    generationId: string,
): Promise<void> {
    return page.evaluate(
        async ({ generationId, stateProperty }) => {
            type GenerationState = { shutdownFunction?: () => unknown };
            type RootState = {
                generations: Record<string, GenerationState>;
            };
            const root = globalThis as
                & typeof globalThis
                & Record<string, unknown>;
            const generations = (root[stateProperty] as RootState | undefined)
                ?.generations;
            const state = generations?.[generationId];
            if (!state) return;
            delete generations![generationId];
            await Promise.resolve(state.shutdownFunction?.());
        },
        { generationId, stateProperty: STATE_PROPERTY },
    );
}

export function destroyAllGenerationsOnPage(page: Page): Promise<void> {
    return page.evaluate(async (stateProperty) => {
        type GenerationState = { shutdownFunction?: () => unknown };
        type RootState = { generations: Record<string, GenerationState> };
        const root = globalThis as typeof globalThis & Record<string, unknown>;
        const state = root[stateProperty] as RootState | undefined;
        if (!state) return;
        delete root[stateProperty];
        await Promise.all(
            Object.values(state.generations).map((generation) =>
                Promise.resolve(generation.shutdownFunction?.())
            ),
        );
    }, STATE_PROPERTY);
}

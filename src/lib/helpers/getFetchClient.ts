import { Store } from "@willsoto/node-konfig-core";
import { retry, type RetryOptions } from "jsr:@std/async";

const retryOptions: RetryOptions = {
    maxAttempts: 3,
    minTimeout: 500,
    multiplier: 2,
    jitter: 0,
};

export const getFetchClient = (konfigStore: Store): {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    (
        input: Request | URL | string,
        init?: RequestInit & {
            client: Deno.HttpClient;
        },
    ): Promise<Response>;
    (input: URL | Request | string, init?: RequestInit): Promise<Response>;
} => {
    if (Deno.env.get("PROXY") || konfigStore.get("networking.proxy")) {
        return async (
            input: RequestInfo | URL,
            init?: RequestInit,
        ) => {
            const client = Deno.createHttpClient({
                proxy: {
                    url: Deno.env.get("PROXY") ||
                        konfigStore.get("networking.proxy") as string,
                },
            });
            const fetchRes = await fetchShim(input, {
                client,
                headers: init?.headers,
                method: init?.method,
                body: init?.body,
            });
            return new Response(fetchRes.body, {
                status: fetchRes.status,
                headers: fetchRes.headers,
            });
        };
    }

    return fetchShim;
};

function fetchShim(
    ...[input, init]: Parameters<typeof globalThis.fetch>
): ReturnType<typeof globalThis.fetch> {
    const callFetch = () =>
        globalThis.fetch(input, {
            signal: AbortSignal.timeout(10000),
            ...(init || {}),
        });
    return retry(callFetch, retryOptions);
}

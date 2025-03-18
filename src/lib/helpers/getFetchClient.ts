import { Store } from "@willsoto/node-konfig-core";
import { retry, type RetryOptions } from "@std/async";

type FetchInputParameter = Parameters<typeof fetch>[0];
type FetchInitParameterWithClient =
    | RequestInit
    | RequestInit & { client: Deno.HttpClient };
type FetchReturn = ReturnType<typeof fetch>;

export const getFetchClient = (konfigStore: Store): {
    (
        input: FetchInputParameter,
        init?: FetchInitParameterWithClient,
    ): FetchReturn;
} => {
    if (Deno.env.get("PROXY") || konfigStore.get("networking.proxy")) {
        return async (
            input: FetchInputParameter,
            init?: RequestInit,
        ) => {
            const client = Deno.createHttpClient({
                proxy: {
                    url: Deno.env.get("PROXY") ||
                        konfigStore.get("networking.proxy") as string,
                },
            });
            const fetchRes = await fetchShim(konfigStore, input, {
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

    return (input: FetchInputParameter, init?: FetchInitParameterWithClient) =>
        fetchShim(konfigStore, input, init);
};

function fetchShim(
    konfigStore: Store,
    input: FetchInputParameter,
    init?: FetchInitParameterWithClient,
): FetchReturn {
    const fetchTimeout = konfigStore.get("networking.fetch_timeout_ms");
    const fetchRetry = konfigStore.get("networking.fetch_retry_enable");
    const fetchMaxAttempts = konfigStore.get("networking.fetch_retry_times");
    const fetchInitialDebounce = konfigStore.get(
        "networking.fetch_retry_initial_debounce",
    );
    const fetchDebounceMultiplier = konfigStore.get(
        "networking.fetch_retry_debounce_multiplier",
    );
    const retryOptions: RetryOptions = {
        maxAttempts: Number(fetchMaxAttempts) || 1,
        minTimeout: Number(fetchInitialDebounce) || 0,
        multiplier: Number(fetchDebounceMultiplier) || 0,
        jitter: 0,
    };

    const callFetch = () =>
        fetch(input, {
            // only set the AbortSignal if the timeout is supplied in the config
            signal: fetchTimeout
                ? AbortSignal.timeout(Number(fetchTimeout))
                : null,
            ...(init || {}),
        });
    // if retry enabled, call retry with the fetch shim, otherwise pass the fetch shim back directly
    return fetchRetry ? retry(callFetch, retryOptions) : callFetch();
}

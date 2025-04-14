import { retry, type RetryOptions } from "@std/async";
import type { Config } from "./config.ts";

type FetchInputParameter = Parameters<typeof fetch>[0];
type FetchInitParameterWithClient =
    | RequestInit
    | RequestInit & { client: Deno.HttpClient };
type FetchReturn = ReturnType<typeof fetch>;

export const getFetchClient = (config: Config): {
    (
        input: FetchInputParameter,
        init?: FetchInitParameterWithClient,
    ): FetchReturn;
} => {
    const proxyAddress = config.networking.proxy;
    if (proxyAddress) {
        return async (
            input: FetchInputParameter,
            init?: RequestInit,
        ) => {
            const client = Deno.createHttpClient({
                proxy: {
                    url: proxyAddress,
                },
            });
            const fetchRes = await fetchShim(config, input, {
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
        fetchShim(config, input, init);
};

function fetchShim(
    config: Config,
    input: FetchInputParameter,
    init?: FetchInitParameterWithClient,
): FetchReturn {
    const fetchTimeout = config.networking.fetch?.timeout_ms;
    const fetchRetry = config.networking.fetch?.retry?.enabled;
    const fetchMaxAttempts = config.networking.fetch?.retry?.times;
    const fetchInitialDebounce = config.networking.fetch?.retry
        ?.initial_debounce;
    const fetchDebounceMultiplier = config.networking.fetch?.retry
        ?.debounce_multiplier;
    const retryOptions: RetryOptions = {
        maxAttempts: fetchMaxAttempts,
        minTimeout: fetchInitialDebounce,
        multiplier: fetchDebounceMultiplier,
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

import { retry, type RetryOptions } from "@std/async";
import type { Config } from "./config.ts";
import { generateRandomIPv6 } from "./ipv6Rotation.ts";

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
    const ipv6Block = config.networking.ipv6_block;

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

    // If proxy or IPv6 rotation is configured, create a custom HTTP client
    // IPv6 rotation generates a unique localAddress for each request to help
    // avoid YouTube's "Please login" errors
    if (proxyAddress || ipv6Block) {
        // For proxy-only (no IPv6 rotation), reuse a single client. It is
        // created on first use, so callers that always bring their own
        // client (e.g. the videoplayback proxy) never allocate it.
        const useReusableClient = Boolean(proxyAddress && !ipv6Block);
        let reusableClient: Deno.HttpClient | undefined;

        return async (
            input: FetchInputParameter,
            init?: FetchInitParameterWithClient,
        ) => {
            // The caller brought its own client (already configured with the
            // proxy / IPv6 address), so it also owns closing it.
            if (init && "client" in init && init.client) {
                return fetchShim(config, retryOptions, input, init);
            }

            let client: Deno.HttpClient;

            if (useReusableClient) {
                reusableClient ??= Deno.createHttpClient({
                    proxy: { url: proxyAddress as string },
                });
                client = reusableClient;
            } else {
                const clientOptions: Deno.CreateHttpClientOptions = {};
                if (proxyAddress) {
                    clientOptions.proxy = { url: proxyAddress };
                }
                if (ipv6Block) {
                    clientOptions.localAddress = generateRandomIPv6(ipv6Block);
                }
                client = Deno.createHttpClient(clientOptions);
            }

            const fetchRes = await fetchShim(config, retryOptions, input, {
                client,
                headers: init?.headers,
                method: init?.method,
                body: init?.body,
                redirect: init?.redirect,
                signal: init?.signal,
            });

            // If using a reusable client, return directly without closing
            if (useReusableClient) {
                return new Response(fetchRes.body, {
                    status: fetchRes.status,
                    headers: fetchRes.headers,
                });
            }

            // For per-request clients (IPv6 rotation), close after body is consumed
            const originalBody = fetchRes.body;
            if (!originalBody) {
                client.close();
                return new Response(null, {
                    status: fetchRes.status,
                    headers: fetchRes.headers,
                });
            }

            const reader = originalBody.getReader();
            const wrappedBody = new ReadableStream({
                async pull(controller) {
                    const { done, value } = await reader.read();
                    if (done) {
                        controller.close();
                        client.close();
                        return;
                    }
                    controller.enqueue(value);
                },
                cancel() {
                    reader.cancel();
                    client.close();
                },
            });

            return new Response(wrappedBody, {
                status: fetchRes.status,
                headers: fetchRes.headers,
            });
        };
    }

    return (input: FetchInputParameter, init?: FetchInitParameterWithClient) =>
        fetchShim(config, retryOptions, input, init);
};

function fetchShim(
    config: Config,
    retryOptions: RetryOptions,
    input: FetchInputParameter,
    init?: FetchInitParameterWithClient,
): FetchReturn {
    const fetchTimeout = config.networking.fetch?.timeout_ms;
    const fetchRetry = config.networking.fetch?.retry?.enabled;

    const callFetch = () => {
        // A fresh timeout for every attempt (only if it is supplied in the
        // config), combined with the caller's signal when there is one, so a
        // caller-provided signal does not drop the timeout and a timed-out
        // attempt does not make the retries fail immediately.
        const signals: AbortSignal[] = [];
        if (fetchTimeout) {
            signals.push(AbortSignal.timeout(Number(fetchTimeout)));
        }
        if (init?.signal) signals.push(init.signal);
        return fetch(input, {
            ...(init || {}),
            signal: signals.length > 0 ? AbortSignal.any(signals) : null,
        });
    };
    // if retry enabled, call retry with the fetch shim, otherwise pass the fetch shim back directly
    return fetchRetry ? retry(callFetch, retryOptions) : callFetch();
}

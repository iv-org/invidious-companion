import { Agent, ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import type { Config } from "./config.ts";
import { generateRandomIPv6 } from "./ipv6Rotation.ts";
import { retry } from "./retry.ts";
import type { RetryOptions } from "./retry.ts";

type FetchInputParameter = Parameters<typeof fetch>[0];
type FetchInitParameter = Parameters<typeof fetch>[1];
type FetchReturn = ReturnType<typeof fetch>;

export const getFetchClient = (config: Config): {
    (
        input: FetchInputParameter,
        init?: FetchInitParameter,
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

    // If proxy or IPv6 rotation is configured, use a custom dispatcher
    // IPv6 rotation generates a unique localAddress for each request to help
    // avoid YouTube's "Please login" errors
    if (proxyAddress || ipv6Block) {
        // For proxy-only (no IPv6 rotation), reuse a single dispatcher
        const reusableDispatcher = proxyAddress && !ipv6Block
            ? new ProxyAgent({ uri: proxyAddress })
            : undefined;

        return async (
            input: FetchInputParameter,
            init?: FetchInitParameter,
        ) => {
            let dispatcher: Dispatcher;

            if (reusableDispatcher) {
                dispatcher = reusableDispatcher;
            } else {
                const localAddress = ipv6Block
                    ? generateRandomIPv6(ipv6Block)
                    : undefined;
                dispatcher = proxyAddress
                    ? new ProxyAgent({ uri: proxyAddress, localAddress })
                    : new Agent({ localAddress });
            }

            const fetchRes = await fetchShim(config, retryOptions, input, {
                ...(init || {}),
                dispatcher,
            } as RequestInit);

            // If using a reusable dispatcher, return directly without closing
            if (reusableDispatcher) {
                return fetchRes;
            }

            // For per-request dispatchers (IPv6 rotation), close after body is consumed
            const originalBody = fetchRes.body;
            if (!originalBody) {
                dispatcher.close();
                return fetchRes;
            }

            const reader = originalBody.getReader();
            const wrappedBody = new ReadableStream({
                async pull(controller) {
                    const { done, value } = await reader.read();
                    if (done) {
                        controller.close();
                        dispatcher.close();
                        return;
                    }
                    controller.enqueue(value);
                },
                cancel() {
                    reader.cancel();
                    dispatcher.close();
                },
            });

            return new Response(wrappedBody, {
                status: fetchRes.status,
                headers: fetchRes.headers,
            });
        };
    }

    return (input: FetchInputParameter, init?: FetchInitParameter) => fetchShim(config, retryOptions, input, init);
};

function fetchShim(
    config: Config,
    retryOptions: RetryOptions,
    input: FetchInputParameter,
    init?: FetchInitParameter,
): FetchReturn {
    const fetchTimeout = config.networking.fetch?.timeout_ms;
    const fetchRetry = config.networking.fetch?.retry?.enabled;

    // Use the global fetch (which accepts undici dispatchers via the
    // dispatcher init option) so Request/Response objects handed in by
    // youtubei.js are recognized; undici's own fetch would not accept
    // Request instances from Node's bundled undici copy.
    const callFetch = () =>
        fetch(input, {
            // only set the AbortSignal if the timeout is supplied in the config
            signal: fetchTimeout
                ? AbortSignal.timeout(Number(fetchTimeout))
                : null,
            ...(init || {}),
        } as RequestInit);
    // if retry enabled, call retry with the fetch shim, otherwise pass the fetch shim back directly
    return fetchRetry ? retry(callFetch, retryOptions) : callFetch();
}

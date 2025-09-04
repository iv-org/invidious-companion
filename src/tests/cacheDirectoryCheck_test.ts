import { checkCacheDirectoryPermissions } from "../lib/helpers/cacheDirectoryCheck.ts";
import type { Config } from "../lib/helpers/config.ts";

function createMockConfig(
    cacheConfig: { enabled: boolean; directory: string },
): Config {
    return {
        server: {
            port: 8282,
            host: "127.0.0.1",
            use_unix_socket: false,
            unix_socket_path: "/tmp/invidious-companion.sock",
            secret_key: "1234567890123456",
            verify_requests: false,
            encrypt_query_params: false,
            enable_metrics: false,
        },
        cache: cacheConfig,
        networking: {
            proxy: null,
            fetch: {
                timeout_ms: 30000,
                retry: {
                    enabled: false,
                    times: 1,
                    initial_debounce: 0,
                    debounce_multiplier: 0,
                },
            },
            videoplayback: {
                ump: false,
                video_fetch_chunk_size_mb: 5,
            },
        },
        jobs: {
            youtube_session: {
                po_token_enabled: false,
                frequency: "*/5 * * * *",
            },
        },
        youtube_session: {
            oauth_enabled: false,
            cookies: "",
        },
    };
}

Deno.test({
    name: "Cache directory permissions check - disabled cache",
    fn() {
        const config = createMockConfig({
            enabled: false,
            directory: "/nonexistent/path",
        });

        // Should not throw when cache is disabled
        checkCacheDirectoryPermissions(config);
    },
});

Deno.test({
    name: "Cache directory permissions check - valid directory",
    fn() {
        const config = createMockConfig({
            enabled: true,
            directory: "/var/tmp",
        });

        // Should not throw for /var/tmp which should be writable
        checkCacheDirectoryPermissions(config);
    },
});

Deno.test({
    name: "Cache directory permissions check - nonexistent parent directory",
    fn() {
        const config = createMockConfig({
            enabled: true,
            directory: "/nonexistent/path",
        });

        // Should throw for nonexistent parent directory
        try {
            checkCacheDirectoryPermissions(config);
            throw new Error("Expected function to throw");
        } catch (err) {
            const errorMessage = err instanceof Error
                ? err.message
                : String(err);
            if (errorMessage.includes("Expected function to throw")) {
                throw err;
            }
            // Expected error - check it contains helpful information
            if (!errorMessage.includes("does not exist")) {
                throw new Error(
                    `Expected error message to mention directory doesn't exist, got: ${errorMessage}`,
                );
            }
        }
    },
});

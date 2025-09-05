import { checkCacheDirectoryPermissions } from "../lib/helpers/cacheDirectoryCheck.ts";
import { ConfigSchema } from "../lib/helpers/config.ts";

// Set required environment variable for secret key (16 characters required)
Deno.env.set("SERVER_SECRET_KEY", "aaaaaaaaaaaaaaaa");

function createMockConfig(
    cacheConfig: { enabled: boolean; directory: string },
) {
    // Use minimal config - let ConfigSchema provide defaults for everything except cache
    // The SERVER_SECRET_KEY environment variable is set above to satisfy the 16-character requirement
    return ConfigSchema.parse({
        cache: cacheConfig,
    });
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

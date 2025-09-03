import { checkCacheDirectoryPermissions } from "../lib/helpers/cacheDirectoryCheck.ts";

Deno.test({
    name: "Cache directory permissions check - disabled cache",
    fn() {
        const config = {
            cache: {
                enabled: false,
                directory: "/nonexistent/path"
            }
        };
        
        // Should not throw when cache is disabled
        checkCacheDirectoryPermissions(config);
    },
});

Deno.test({
    name: "Cache directory permissions check - valid directory",
    fn() {
        const config = {
            cache: {
                enabled: true,
                directory: "/tmp"
            }
        };
        
        // Should not throw for /tmp which should be writable
        checkCacheDirectoryPermissions(config);
    },
});

Deno.test({
    name: "Cache directory permissions check - nonexistent parent directory",
    fn() {
        const config = {
            cache: {
                enabled: true,
                directory: "/nonexistent/path"
            }
        };
        
        // Should throw for nonexistent parent directory
        try {
            checkCacheDirectoryPermissions(config);
            throw new Error("Expected function to throw");
        } catch (err) {
            if (err.message.includes("Expected function to throw")) {
                throw err;
            }
            // Expected error - check it contains helpful information
            if (!err.message.includes("does not exist")) {
                throw new Error(`Expected error message to mention directory doesn't exist, got: ${err.message}`);
            }
        }
    },
});
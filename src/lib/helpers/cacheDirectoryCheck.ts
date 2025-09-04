import type { Config } from "./config.ts";

/**
 * Checks if the cache directory exists and is writable.
 * Throws an error with a helpful message if the directory cannot be used.
 */
export function checkCacheDirectoryPermissions(config: Config): void {
    if (!config.cache.enabled) {
        return; // No need to check if cache is disabled
    }

    const cacheDir = config.cache.directory;
    const youtubeiJsDir = `${cacheDir}/youtubei.js`;

    try {
        // Check if the base cache directory exists
        let baseDirExists = false;
        try {
            const stat = Deno.statSync(cacheDir);
            baseDirExists = stat.isDirectory;
        } catch {
            baseDirExists = false;
        }

        if (!baseDirExists) {
            throw new Error(
                `Cache directory '${cacheDir}' does not exist. Please create it or mount a volume to this path.`,
            );
        }

        // Try to create the youtubei.js subdirectory if it doesn't exist
        let youtubeiDirExists = false;
        try {
            const stat = Deno.statSync(youtubeiJsDir);
            youtubeiDirExists = stat.isDirectory;
        } catch {
            youtubeiDirExists = false;
        }

        if (!youtubeiDirExists) {
            try {
                Deno.mkdirSync(youtubeiJsDir, { recursive: true });
            } catch (err) {
                const errorMessage = err instanceof Error
                    ? err.message
                    : String(err);
                throw new Error(
                    `Cannot create youtubei.js cache directory '${youtubeiJsDir}'. ` +
                        `Check directory permissions. Original error: ${errorMessage}`,
                );
            }
        }

        // Test write permissions by creating a temporary file
        const testFile = `${youtubeiJsDir}/.write_test_${Date.now()}`;
        try {
            Deno.writeTextFileSync(testFile, "test");
            Deno.removeSync(testFile);
        } catch (err) {
            const errorMessage = err instanceof Error
                ? err.message
                : String(err);
            throw new Error(
                `Cannot write to youtubei.js cache directory '${youtubeiJsDir}'. ` +
                    `This usually indicates a permission issue. ` +
                    `Ensure the directory is writable by the application user. ` +
                    `For Docker containers, check volume mount permissions. ` +
                    `Original error: ${errorMessage}`,
            );
        }

        console.log(
            `[INFO] Cache directory '${youtubeiJsDir}' is accessible and writable`,
        );
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`[ERROR] Cache directory check failed: ${errorMessage}`);
        console.log(`[ERROR] Common solutions:`);
        console.log(
            `[ERROR] - For Docker: Ensure the mounted volume has correct permissions (chmod 777 or appropriate ownership)`,
        );
        console.log(
            `[ERROR] - For bare metal: Ensure the process user can write to '${youtubeiJsDir}'`,
        );
        console.log(`[ERROR] - Check SELinux/AppArmor policies if applicable`);
        throw err;
    }
}

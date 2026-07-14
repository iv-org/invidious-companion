import type { Config } from "./config.ts";

// Deno 2.9 moved the no-argument Deno.openKv() default store to a
// per-app OS data directory (e.g. $XDG_DATA_HOME) instead of DENO_DIR,
// which is neither in the compiled binary's --allow-write allowlist
// (see deno.jsonc's "compile" task) nor writable under the container's
// read-only root filesystem, so it throws PermissionDenied. Open it at
// config.cache.directory/youtubei.js instead: the same path already
// granted write access (Dockerfile / docker-compose.yaml).
//
// The directory is created first because Deno.openKv() does not create
// parent directories and would otherwise fail with "unable to open
// database file" when running from source (CI, bare-metal) where the
// Dockerfile's `mkdir -p /var/tmp/youtubei.js` hasn't run.
//
// Done lazily because config is only available once parseConfig()
// resolves in main.ts, and memoized so callers share one handle.
//
// If the on-disk store cannot be written (e.g. a read-only filesystem
// where neither the cache directory nor its parent is writable), fall
// back to an ephemeral in-memory KV store (the special ":memory:" path,
// see https://docs.deno.com/api/deno/~/Deno.openKv). This keeps the app
// running instead of crash-looping; the cache is simply not persisted
// across restarts. A warning is logged so the misconfiguration is
// visible. The in-memory store always succeeds, so once the fallback is
// taken it is memoized like the on-disk handle.
let kvPromise: Promise<Deno.Kv> | undefined;

export const getKv = (config: Config): Promise<Deno.Kv> => {
    if (!kvPromise) {
        const cacheDir = `${config.cache.directory}/youtubei.js`;
        kvPromise = Deno.mkdir(cacheDir, { recursive: true })
            .then(() => Deno.openKv(`${cacheDir}/kv_cache.sqlite3`))
            .catch((err) => {
                console.error(
                    `[WARN] Failed to open the on-disk KV cache at ${cacheDir}/kv_cache.sqlite3, falling back to an in-memory store (cache will not persist across restarts)`,
                    err,
                );
                return Deno.openKv(":memory:");
            });
    }
    return kvPromise;
};

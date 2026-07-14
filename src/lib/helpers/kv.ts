import type { Config } from "./config.ts";

// Deno 2.9 moved the no-argument Deno.openKv() default store to a
// per-app OS data directory (e.g. $XDG_DATA_HOME) instead of DENO_DIR,
// which is neither in the compiled binary's --allow-write allowlist
// (see deno.json's "compile" task) nor writable under the container's
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
// resolves in main.ts, and memoized so callers share one handle. On
// failure the memo is cleared so a later call can retry instead of
// being stuck on a permanently rejected promise.
let kvPromise: Promise<Deno.Kv> | undefined;

export const getKv = (config: Config): Promise<Deno.Kv> => {
    if (!kvPromise) {
        const cacheDir = `${config.cache.directory}/youtubei.js`;
        kvPromise = Deno.mkdir(cacheDir, { recursive: true })
            .then(() => Deno.openKv(`${cacheDir}/kv_cache.sqlite3`))
            .catch((err) => {
                kvPromise = undefined;
                throw err;
            });
    }
    return kvPromise;
};

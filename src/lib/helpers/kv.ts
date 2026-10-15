import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";

// Deno.Kv was a SQLite-backed key-value store; Node.js ships an embedded
// SQLite driver (node:sqlite) which this module uses to provide the same
// subset of the Deno.Kv API that companion uses: get() and set() with
// optional expireIn TTLs, keyed by string arrays.
//
// The store lives at config.cache.directory/youtubei.js/kv_cache.node.sqlite3
// (a different file name than the old Deno.Kv database so an existing
// volume holding the incompatible Deno.Kv format is never reused).
//
// The directory is created first because the SQLite driver does not create
// parent directories and would otherwise fail with "unable to open database
// file" when running from source (CI, bare-metal) where the Dockerfile's
// `mkdir -p /var/tmp/youtubei.js` hasn't run.
//
// Done lazily because config is only available once parseConfig()
// resolves in main.ts, and memoized so callers share one handle.
//
// If the on-disk store cannot be written (e.g. a read-only filesystem
// where neither the cache directory nor its parent is writable), fall
// back to an ephemeral in-memory store (":memory:"). This keeps the app
// running instead of crash-looping; the cache is simply not persisted
// across restarts. A warning is logged so the misconfiguration is
// visible. The in-memory store always succeeds, so once the fallback is
// taken it is memoized like the on-disk handle.

export type KvKey = readonly (string | number | Uint8Array)[];

interface KvEntry {
    value: unknown;
}

class KvStore {
    #db: DatabaseSync;

    constructor(db: DatabaseSync) {
        this.#db = db;
        this.#db.exec(
            "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, expires_at INTEGER)",
        );
    }

    async get(key: KvKey): Promise<KvEntry> {
        const row = this.#db.prepare(
            "SELECT value, expires_at FROM kv WHERE key = ?",
        ).get(JSON.stringify(key)) as
            | { value: Uint8Array; expires_at: number | null }
            | undefined;

        if (row === undefined) {
            return { value: null };
        }
        if (row.expires_at !== null && row.expires_at <= Date.now()) {
            this.#db.prepare("DELETE FROM kv WHERE key = ?").run(
                JSON.stringify(key),
            );
            return { value: null };
        }
        return { value: row.value };
    }

    async set(
        key: KvKey,
        value: unknown,
        options?: { expireIn?: number },
    ): Promise<void> {
        const expiresAt = options?.expireIn
            ? Date.now() + options.expireIn
            : null;
        this.#db.prepare(
            "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
        ).run(JSON.stringify(key), value as Uint8Array, expiresAt);
    }
}

let kvPromise: Promise<KvStore> | undefined;

export const getKv = (config: Config): Promise<KvStore> => {
    if (!kvPromise) {
        const cacheDir = `${config.cache.directory}/youtubei.js`;
        kvPromise = mkdir(cacheDir, { recursive: true })
            .then(() =>
                new KvStore(
                    new DatabaseSync(`${cacheDir}/kv_cache.node.sqlite3`),
                )
            )
            .catch((err) => {
                console.error(
                    `[WARN] Failed to open the on-disk KV cache at ${cacheDir}/kv_cache.node.sqlite3, falling back to an in-memory store (cache will not persist across restarts)`,
                    err,
                );
                return new KvStore(new DatabaseSync(":memory:"));
            });
    }
    return kvPromise;
};

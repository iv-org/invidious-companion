// SABR ("server ABR") playback for videos YouTube only serves that way.
//
// When none of the clients companion asks gives plain stream URLs, the WEB
// player response still has `serverAbrStreamingUrl`: the stream is then a POST
// conversation in which the player tells YouTube where it is and YouTube
// answers with the next segments (the UMP format), with a PO token bound to
// the video. googlevideo's SabrStream speaks that conversation.
//
// Invidious and its players only know byte ranges of a format, so this module
// turns SABR back into byte ranges: every segment YouTube sends says where it
// belongs in the format's file (`segmentByteRangeStart`), so segments are
// kept in memory at their offset and ranges are answered from there. A range
// that is not there yet is fetched by starting a SABR stream at the time that
// byte plays (estimated from the segments seen so far, otherwise from the
// bitrate), so a seek far ahead does not wait for everything before it.
//
// The format URLs given to Invidious keep the usual shape
// (https://<googlevideo host>/videoplayback?...&sabr=1), so Invidious and
// the DASH manifest route need no change; /videoplayback answers them here.

import type { Innertube } from "youtubei.js";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat, EnabledTrackTypes } from "googlevideo/utils";
import type { FormatStream, SabrFormat } from "googlevideo/shared-types";
import type { MediaHeader } from "googlevideo/protos";
import { USER_AGENT } from "bgutils";
import { encodeBase64 } from "@std/encoding/base64";
import type { TokenMinter } from "../jobs/potoken.ts";
import type { Config } from "./config.ts";
let getFetchClientLocation = "getFetchClient";
if (Deno.env.get("GET_FETCH_CLIENT_LOCATION")) {
    if (Deno.env.has("DENO_COMPILED")) {
        getFetchClientLocation = Deno.mainModule.replace("src/main.ts", "") +
            Deno.env.get("GET_FETCH_CLIENT_LOCATION");
    } else {
        getFetchClientLocation = Deno.env.get(
            "GET_FETCH_CLIENT_LOCATION",
        ) as string;
    }
}
const { getFetchClient } = await import(getFetchClientLocation);

// read at most this far past what a player has asked for
const AHEAD_BYTES = 24_000_000;
// a byte this close ahead of a running fetch will come from it
const NEAR_BYTES = 6_000_000;
// a format not asked for in this long is dropped from memory
const IDLE_MS = 10 * 60_000;
// no segment arriving for this long while a player waits: give up
const STALL_MS = 90_000;
// fetches of one format failing in a row before it is given up
const MAX_FAILS = 6;

// deno-lint-ignore no-explicit-any
type RawFormat = Record<string, any>;

interface Session {
    videoId: string;
    sabrUrl: string;
    ustreamerConfig: string;
    clientVersion: string;
    expire: number;
    formats: Map<string, RawFormat>;
}

interface Run {
    stream: SabrStream;
    from: number;
    head: number;
    bad: boolean;
    late: boolean;
}

interface Track {
    id: string;
    videoId: string;
    format: RawFormat;
    length: number;
    // segments at their byte offset in the format's file
    pieces: Map<number, Uint8Array>;
    starts: number[];
    bytes: number;
    // [byte offset, start ms] of the segments seen, to turn a byte into a time
    points: [number, number][];
    headEnd: number;
    run: Run | null;
    chain: { n: number } | null;
    // where each open response reads; fetches run ahead of the farthest
    wants: Map<number, number>;
    want: number;
    wantWaiters: (() => void)[];
    // open responses (a format being read is never dropped)
    readers: number;
    minter: TokenMinter | undefined;
    waiters: (() => void)[];
    fails: number;
    failed: boolean;
    dead: boolean;
    used: number;
}

const sessions = new Map<string, Session>();
const tracks = new Map<string, Track>();
let totalBytes = 0;
let liveMinter: TokenMinter | undefined;

/** the validated minter companion uses now (called when it is replaced) */
export function setSabrMinter(m: TokenMinter | undefined) {
    liveMinter = m;
}
let readerIds = 0;
let signKey: Promise<CryptoKey> | undefined;
let config: Config | undefined;

const formatKey = (itag: number | string, xtags?: string) =>
    `${itag}:${xtags || ""}`;

/** whether a player response only plays over SABR */
export function onlySabr(data: RawFormat): boolean {
    const sd = data.streamingData;
    // no plain source in any adaptive format (the muxed 360p one may still
    // have one, which alone is not enough)
    const all: RawFormat[] = sd?.adaptiveFormats || [];
    return !!(sd?.serverAbrStreamingUrl && all.length &&
        all.every((f) => !f.url && !f.signatureCipher && !f.cipher) &&
        data.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig
            ?.videoPlaybackUstreamerConfig);
}

// SABR format URLs are signed with the secret key, so /videoplayback only
// starts SABR work for URLs companion handed out itself
async function sign(c: Config, text: string): Promise<string> {
    signKey ??= crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(c.server.secret_key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const mac = await crypto.subtle.sign(
        "HMAC",
        await signKey,
        new TextEncoder().encode(text),
    );
    return encodeBase64(new Uint8Array(mac)).replace(/\+/g, "-")
        .replace(/\//g, "_").replace(/=+$/, "");
}

const signedText = (q: URLSearchParams) =>
    [q.get("id"), q.get("itag"), q.get("xtags") || "", q.get("expire")]
        .join("|");

/** whether a /videoplayback query is a SABR URL companion gave out, unexpired */
export async function sabrUrlValid(
    q: URLSearchParams,
    c: Config,
): Promise<boolean> {
    if (Number(q.get("expire")) * 1000 < Date.now()) return false;
    return q.get("sig") === await sign(c, signedText(q));
}

/**
 * Keeps what a SABR stream of this video needs and points each adaptive
 * format of the response at /videoplayback with `sabr=1`.
 */
export async function useSabr(
    data: RawFormat,
    videoId: string,
    innertubeClient: Innertube,
    companionConfig: Config,
): Promise<void> {
    config = companionConfig;
    const sd = data.streamingData;
    const sabrUrl = await innertubeClient.session.player!.decipher(
        sd.serverAbrStreamingUrl,
    );
    const url = new URL(sabrUrl);
    const expire = Number(url.searchParams.get("expire")) ||
        Math.floor(Date.now() / 1000) + Number(sd.expiresInSeconds || 21540);
    const session: Session = {
        videoId,
        sabrUrl,
        ustreamerConfig: data.playerConfig.mediaCommonConfig
            .mediaUstreamerRequestConfig.videoPlaybackUstreamerConfig,
        clientVersion: innertubeClient.session.context.client.clientVersion,
        expire,
        formats: new Map(),
    };
    // only formats of known length can be served as byte ranges
    sd.adaptiveFormats = sd.adaptiveFormats.filter((f: RawFormat) =>
        Number(f.contentLength) > 0
    );
    for (const f of sd.adaptiveFormats) {
        session.formats.set(formatKey(f.itag, f.xtags), f);
        const q = new URLSearchParams({
            expire: String(expire),
            c: "WEB",
            sabr: "1",
            id: videoId,
            itag: String(f.itag),
        });
        if (f.xtags) q.set("xtags", f.xtags);
        q.set("clen", f.contentLength);
        if (f.mimeType) q.set("mime", f.mimeType.split(";")[0]);
        if (f.approxDurationMs) {
            q.set("dur", (Number(f.approxDurationMs) / 1000).toFixed(3));
        }
        q.set("sig", await sign(companionConfig, signedText(q)));
        f.url = `https://${url.host}/videoplayback?${q}`;
    }
    // the muxed formats have no SABR equivalent
    sd.formats = [];
    sessions.set(videoId, session);
}

export const hasSabrSession = (videoId: string) => {
    const s = sessions.get(videoId);
    return !!s && s.expire * 1000 > Date.now();
};

// a format by itag and xtags; without xtags, the original audio track
function pickFormat(s: Session, itag: string, xtags: string) {
    const exact = s.formats.get(formatKey(itag, xtags));
    if (exact || xtags) return exact;
    const same = [...s.formats.values()].filter((f) => String(f.itag) === itag);
    return same.find((f) => f.audioTrack?.audioIsDefault) || same[0];
}

// ---------------------------------------------------------------- a format in memory

function wake(t: Track) {
    const w = t.waiters;
    t.waiters = [];
    for (const f of w) f();
}

function setWant(t: Track, reader: number, n: number | null) {
    if (n === null) t.wants.delete(reader);
    else t.wants.set(reader, n);
    t.want = t.dead ? Infinity : Math.max(0, ...t.wants.values());
    const w = t.wantWaiters;
    t.wantWaiters = [];
    for (const f of w) f();
}

// index in t.starts of the segment holding byte n, or -1
function pieceAt(t: Track, n: number): number {
    let lo = 0, hi = t.starts.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t.starts[mid] <= n) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    if (found < 0) return -1;
    const s = t.starts[found];
    return n < s + t.pieces.get(s)!.length ? found : -1;
}

// the end of the bytes in memory from byte n on, or 0 if n is not there
function haveUntil(t: Track, n: number): number {
    let i = pieceAt(t, n);
    if (i < 0) return 0;
    let end = t.starts[i] + t.pieces.get(t.starts[i])!.length;
    while (++i < t.starts.length && t.starts[i] <= end) {
        end = Math.max(end, t.starts[i] + t.pieces.get(t.starts[i])!.length);
    }
    return end;
}

function addPiece(t: Track, at: number, data: Uint8Array) {
    if (t.pieces.has(at)) return;
    t.pieces.set(at, data);
    t.bytes += data.length;
    totalBytes += data.length;
    let i = t.starts.length;
    while (i > 0 && t.starts[i - 1] > at) i--;
    t.starts.splice(i, 0, at);
    if (totalBytes > limit()) trim();
}

const limit = () =>
    (config?.networking.videoplayback.sabr_cache_mb ?? 512) * 1_000_000;

// segments well behind where every response reads, least recently used first
function trim() {
    const all = [...tracks.values()].sort((a, b) => a.used - b.used);
    for (const t of all) {
        if (totalBytes <= limit()) return;
        // a segment a response is reading or about to read stays; anything
        // else is fetched again if it is wanted later
        const windows = [...t.wants.values()];
        const needed = (a: number, b: number) =>
            windows.some((w) => b > w - NEAR_BYTES && a < w + AHEAD_BYTES);
        for (const at of [...t.starts]) {
            if (totalBytes <= limit()) return;
            if (at === 0) continue; // the init segment stays
            if (needed(at, at + t.pieces.get(at)!.length)) continue;
            dropPiece(t, at);
        }
    }
}

function dropPiece(t: Track, at: number) {
    const p = t.pieces.get(at);
    if (!p) return;
    t.pieces.delete(at);
    t.bytes -= p.length;
    totalBytes -= p.length;
    t.starts.splice(t.starts.indexOf(at), 1);
}

// the time to ask SABR to start at for byte n
function timeOf(t: Track, n: number): number {
    if (n <= t.headEnd) return 0;
    let lo: [number, number] | null = null, hi: [number, number] | null = null;
    for (const p of t.points) {
        if (p[0] <= n && (!lo || p[0] > lo[0])) lo = p;
        if (p[0] > n && (!hi || p[0] < hi[0])) hi = p;
    }
    lo ??= [t.headEnd, 0];
    hi ??= [t.length || 1, Number(t.format.approxDurationMs) || 0];
    const ms = lo[1] +
        (hi[1] - lo[1]) * ((n - lo[0]) / Math.max(1, hi[0] - lo[0]));
    return Math.max(0, Math.floor(ms - 2000));
}

function track(videoId: string, f: RawFormat): Track {
    const id = `${videoId}|${formatKey(f.itag, f.xtags)}`;
    let t = tracks.get(id);
    if (t && !t.failed) {
        t.used = Date.now();
        return t;
    }
    if (t) { for (const at of [...t.starts]) dropPiece(t, at); }
    t = newTrack(id, videoId, f);
    tracks.set(id, t);
    return t;
}

function newTrack(id: string, videoId: string, f: RawFormat): Track {
    return {
        id,
        videoId,
        format: f,
        length: Number(f.contentLength) || 0,
        pieces: new Map(),
        starts: [],
        bytes: 0,
        points: [],
        headEnd: 0,
        run: null,
        chain: null,
        wants: new Map(),
        want: 0,
        readers: 0,
        minter: undefined,
        wantWaiters: [],
        waiters: [],
        fails: 0,
        failed: false,
        dead: false,
        used: Date.now(),
    };
}

// a SABR stream that starts at the segment holding byte n (`backMs` earlier
// after a start that came too late) and stores what it gets
async function fetchFrom(
    t: Track,
    n: number,
    backMs: number,
    chain: { n: number },
): Promise<Run> {
    const s = sessions.get(t.videoId);
    const tokenMinter = t.minter ?? liveMinter;
    if (!s || !tokenMinter) throw new Error("no SABR session");
    const isVideo = String(t.format.mimeType).startsWith("video/");
    const formats = [...s.formats.values()].map((f) =>
        buildSabrFormat(f as FormatStream)
    );
    const me = buildSabrFormat(t.format as FormatStream);
    // the stream wants an audio format even for video only
    const audio = isVideo
        ? formats.filter((x: SabrFormat) => x.audioQuality)
            .sort((a: SabrFormat, b: SabrFormat) => a.bitrate - b.bitrate)[0]
        : me;
    const startTimeMs = Math.max(0, timeOf(t, n) - backMs);
    const fetchClient: typeof fetch = config ? getFetchClient(config) : fetch;
    const stream = new SabrStream({
        videoId: t.videoId,
        formats,
        serverAbrStreamingUrl: s.sabrUrl,
        videoPlaybackUstreamerConfig: s.ustreamerConfig,
        clientInfo: {
            clientName: 1,
            clientVersion: s.clientVersion,
            osName: "Windows",
            osVersion: "10.0",
        },
        poToken: await tokenMinter(t.videoId),
        fetchFunction: (input, init = {}) =>
            fetchClient(input, {
                ...init,
                headers: {
                    ...(init.headers || {}),
                    "user-agent": USER_AGENT,
                    origin: "https://www.youtube.com",
                    referer: "https://www.youtube.com/",
                },
            }),
    });
    const run: Run = { stream, from: n, head: n, bad: false, late: false };
    if (t.chain !== chain || t.dead) {
        // another byte was asked for meanwhile
        stream.abort().catch(() => {});
        return run;
    }
    t.run = run;

    // 1: token taken. 3: turned down, the stream stops soon after
    stream.on("streamProtectionStatusUpdate", (p: { status?: number }) => {
        if (p.status === 3) {
            run.bad = true;
            stream.abort().catch(() => {});
        }
    });
    stream.on("error", () => {});

    // The segments' headers, in the order their data reaches the stream:
    // every segment is recorded in the track state right after it is queued.
    const kind = isVideo ? "video" : "audio";
    const seen = new Set<number>();
    const heads: MediaHeader[] = [];
    stream.on(
        "trackStateUpdate",
        // deno-lint-ignore no-explicit-any
        (tc: any) => {
            const segs = [...tc[kind].trackedSegments.values()]
                .filter((x) => !seen.has(x.segmentNumber))
                .sort((a, b) => a.segmentNumber - b.segmentNumber);
            for (const x of segs) {
                seen.add(x.segmentNumber);
                heads.push(x.mediaHeader);
            }
        },
    );

    const { videoStream, audioStream } = stream.start({
        videoFormat: isVideo ? me : undefined,
        audioFormat: audio,
        startTimeMs,
        isPostLiveDvr: false,
        enabledTrackTypes: isVideo
            ? EnabledTrackTypes.VIDEO_ONLY
            : EnabledTrackTypes.AUDIO_ONLY,
        // a player that is not reading on is not a stall
        stallDetectionMs: 1e12,
    });
    const mine = isVideo ? videoStream : audioStream;
    const other = isVideo ? audioStream : videoStream;
    (async () => {
        const r = other.getReader();
        while (!(await r.read()).done);
    })().catch(() => {});

    const reader = mine.getReader();
    const chunks: Uint8Array[] = [];
    let media = 0;
    try {
        loop: for (;;) {
            // far enough ahead of the players: wait until one reads on
            while (
                run.head > t.want + AHEAD_BYTES && t.run === run && !t.dead
            ) {
                await new Promise<void>((r) => {
                    t.wantWaiters.push(r);
                    setTimeout(r, 10_000);
                });
            }
            if (t.run !== run || t.dead) break;
            let next;
            try {
                next = await reader.read();
            } catch (e) {
                // aborted here: turned-down token or a fetch taking over
                if (run.bad || t.run !== run || t.dead) break;
                throw e;
            }
            const { done, value } = next;
            if (done || t.run !== run || t.dead) break;
            chunks.push(value as Uint8Array);
            // pair each segment with its header (the init segment's comes
            // with the next media segment's state update)
            while (chunks.length && heads.length) {
                const h = heads.shift()!;
                const data = chunks.shift()!;
                const at = h.isInitializationSegment
                    ? 0
                    : Number(h.segmentByteRangeStart ?? -1);
                if (at < 0) continue;
                if (h.isInitializationSegment) {
                    t.headEnd = Math.max(t.headEnd, data.length);
                } else {
                    if (h.startMs != null) {
                        t.points.push([at, Number(h.startMs)]);
                    }
                    // started past the byte wanted (the time was guessed
                    // late): again, earlier
                    if (media++ === 0 && at > Math.max(n, t.headEnd)) {
                        run.late = true;
                        break loop;
                    }
                }
                addPiece(t, at, data);
                if (!h.isInitializationSegment) run.head = at + data.length;
                wake(t);
                if (t.length && haveUntil(t, 0) >= t.length) break loop;
                // caught up with bytes already in memory: nothing new to get
                if (
                    !h.isInitializationSegment &&
                    haveUntil(t, run.head) - run.head > NEAR_BYTES
                ) break loop;
            }
        }
    } finally {
        stream.abort().catch(() => {});
        if (t.run === run) t.run = null;
        wake(t);
    }
    return run;
}

// byte n is wanted: start a fetch that brings it, unless one is on its way
function ensure(t: Track, n: number) {
    if (haveUntil(t, n) || t.failed || t.dead) return;
    const r = t.run;
    if (r && r.from <= n && n - Math.max(r.head, r.from) < NEAR_BYTES) return;
    // tries for a byte close before this one are still starting
    const c = t.chain;
    if (c && !r && c.n <= n && n - c.n < NEAR_BYTES) return;
    const chain = { n };
    t.chain = chain;
    r?.stream.abort().catch(() => {});
    t.run = null;
    const attempt = (backMs: number, left: number): Promise<void> =>
        fetchFrom(t, n, backMs, chain).then((run) => {
            if (t.chain !== chain) return;
            t.fails = run.bad ? t.fails + 1 : 0;
            if (run.late && left > 0) {
                return attempt(backMs ? backMs * 3 : 5_000, left - 1);
            }
            if (run.bad && t.fails < MAX_FAILS && !haveUntil(t, n)) {
                return attempt(backMs, left);
            }
            if (t.fails >= MAX_FAILS) {
                t.failed = true;
                console.log(`[ERROR] SABR: tokens turned down for ${t.id}`);
            }
        }).catch((e) => {
            if (t.chain !== chain) return;
            console.log(`[WARNING] SABR fetch failed for ${t.id}:`, String(e));
            if (++t.fails >= MAX_FAILS) t.failed = true;
        }).finally(() => {
            if (t.chain === chain) t.chain = null;
            wake(t);
        });
    attempt(0, 4);
}

// wait until byte n is in memory
async function until(t: Track, n: number) {
    let lastBytes = t.bytes, quiet = Date.now();
    while (!haveUntil(t, n)) {
        if (t.failed || t.dead) throw new Error("SABR format failed");
        ensure(t, n);
        await new Promise<void>((r) => {
            t.waiters.push(r);
            setTimeout(r, 15_000);
        });
        if (t.bytes !== lastBytes) {
            lastBytes = t.bytes;
            quiet = Date.now();
        } else if (Date.now() - quiet > STALL_MS) {
            throw new Error("SABR stalled");
        }
    }
}

// keeps memory under the configured limit: segments well behind what players
// read go first, then whole formats nobody is waiting on
function sweep() {
    const now = Date.now();
    const drop = (t: Track) => {
        for (const at of [...t.starts]) dropPiece(t, at);
        tracks.delete(t.id);
        t.dead = true;
        t.run?.stream.abort().catch(() => {});
        t.run = null;
        wake(t);
        setWant(t, -1, null);
        for (const f of t.wantWaiters.splice(0)) f();
    };
    for (const t of [...tracks.values()]) {
        if (t.readers === 0 && now - t.used > IDLE_MS) drop(t);
    }
    trim();
    const idle = [...tracks.values()].filter((t) => t.readers === 0)
        .sort((x, y) => x.used - y.used);
    for (const t of idle) if (totalBytes > limit()) drop(t);
    for (const [id, s] of sessions) {
        if (s.expire * 1000 < now) sessions.delete(id);
    }
}
setInterval(sweep, 30_000);

// a single byte range "a-b", "a-" or "-n" of a file of `length` bytes
function parseRange(range: string | null, length: number) {
    if (!range) return { start: 0, end: length - 1 };
    const m = range.trim().match(/^(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) return null;
    let start: number, end: number;
    if (!m[1]) {
        start = Math.max(0, length - Number(m[2]));
        end = length - 1;
    } else {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), length - 1) : length - 1;
    }
    return start <= end && start < length ? { start, end } : null;
}

// a response reading track t from byte `start` to `end`
function readBody(t: Track, start: number, end: number) {
    const id = ++readerIds;
    let pos = start, open = true;
    t.readers++;
    const close = () => {
        if (!open) return;
        open = false;
        t.readers--;
        setWant(t, id, null);
    };
    setWant(t, id, start);
    return {
        ready: () =>
            until(t, start).catch((e) => {
                close();
                throw e;
            }),
        body: new ReadableStream<Uint8Array>({
            async pull(c) {
                try {
                    if (pos > end) {
                        close();
                        return c.close();
                    }
                    t.used = Date.now();
                    setWant(t, id, pos);
                    await until(t, pos);
                    const i = pieceAt(t, pos);
                    const at = t.starts[i];
                    const piece = t.pieces.get(at)!;
                    const to = Math.min(piece.length, end + 1 - at);
                    c.enqueue(piece.subarray(pos - at, to));
                    pos = at + to;
                } catch (e) {
                    close();
                    c.error(e);
                }
            },
            cancel: close,
        }),
    };
}

/** answers a /videoplayback request with `sabr=1` */
export async function sabrResponse(
    videoId: string,
    itag: string,
    xtags: string,
    range: string | null,
    tokenMinter: TokenMinter,
    extraHeaders: Record<string, string> = {},
    headOnly = false,
): Promise<Response> {
    const s = sessions.get(videoId);
    if (!s) return new Response("No SABR session", { status: 404 });
    const f = pickFormat(s, itag, xtags);
    if (!f) return new Response("No such format", { status: 404 });
    const t = track(videoId, f);
    liveMinter ??= tokenMinter;
    const r = parseRange(range, t.length);
    if (!r) {
        return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${t.length}` },
        });
    }
    const headers: Record<string, string> = {
        "access-control-allow-origin": "*",
        "accept-ranges": "bytes",
        "content-type": String(f.mimeType || "application/octet-stream")
            .split(";")[0],
        "content-length": String(r.end + 1 - r.start),
        ...extraHeaders,
    };
    if (range) {
        headers["content-range"] = `bytes ${r.start}-${r.end}/${t.length}`;
    }
    const status = range ? 206 : 200;
    if (headOnly) return new Response(null, { status, headers });
    const { ready, body } = readBody(t, r.start, r.end);
    try {
        await ready();
    } catch (e) {
        await body.cancel();
        return new Response(String(e), { status: 502 });
    }
    return new Response(body, { status, headers });
}

/**
 * Whether `tokenMinter` gets media over SABR for this video: a fresh fetch
 * of its first segment, apart from the shared cache (for token validation).
 */
export async function sabrProbe(
    videoId: string,
    tokenMinter: TokenMinter,
): Promise<boolean> {
    const s = sessions.get(videoId);
    const f = s &&
        [...s.formats.values()].find((x) =>
            String(x.mimeType).startsWith("audio/")
        );
    if (!f) return false;
    const t = newTrack(`probe|${videoId}|${crypto.randomUUID()}`, videoId, f);
    t.minter = tokenMinter;
    const { ready, body } = readBody(t, 0, 0);
    try {
        await ready();
        return t.bytes > 0;
    } catch {
        return false;
    } finally {
        await body.cancel();
        t.dead = true;
        t.run?.stream.abort().catch(() => {});
        for (const at of [...t.starts]) dropPiece(t, at);
    }
}

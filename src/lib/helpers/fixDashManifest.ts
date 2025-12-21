// Fix DASH manifest for Chromium compatibility.
// Prevents MEDIA_ERR_DECODE when the player auto-switches between
// different codec families mid-stream.
//
// Two-part fix based on investigation by MMaster in issue #172:
// 1. Filter adaptive formats BEFORE DASH generation to keep only one codec per height+fps
// 2. Remove SupplementalProperty elements that cause color transfer issues

import type { Misc } from "youtubei.js";

// Codec priority: lower index = higher priority
const CODEC_PRIORITY = ["av01", "av1", "vp09", "vp9", "hev", "avc"];

/**
 * Get codec priority value from format's mime_type.
 * Lower value = higher priority. Returns 99 for unknown codecs.
 */
function getFormatCodecPriority(fmt: Misc.Format): number {
    const mimeCodecsIdx = fmt.mime_type.indexOf("codecs=");
    if (mimeCodecsIdx < 0) return 99;

    const codecs = fmt.mime_type.substring(mimeCodecsIdx + "codecs=".length);
    for (let i = 0; i < CODEC_PRIORITY.length; i++) {
        if (codecs.includes(CODEC_PRIORITY[i])) return i;
    }
    return 99;
}

/**
 * Calculate sort value for a format.
 * Sorts by: audio first, then preferred codec, then higher height, then fps close to 30.
 */
function getFormatSortValue(fmt: Misc.Format): number {
    // Audio first
    if (fmt.has_video === false) return 0;

    // No height is treated like height 1 to be after all other heights
    const heightVal = 100000 - (fmt.height ? fmt.height : 1);

    let fpsVal = 0.0;
    if (!fmt.fps) {
        // No fps is worst
        fpsVal = 5.0;
    } else if (fmt.fps < 24) {
        // fps lower than 24 is worse (higher is better)
        fpsVal = 5.0 - fmt.fps / 100; // (fps 24) 4.76 => (fps 0) 5.0
    } else if (fmt.fps < 40) {
        // fps between 24 and 40 is ideal (higher is better)
        fpsVal = 0.4 - fmt.fps / 100; // (fps 40) 0.0 => (fps 24) 0.16
    } else {
        // fps higher than 40 is worse than around 30 (higher is worse)
        fpsVal = 0.0 + fmt.fps / 100; // (fps 40) 0.4 => (fps 120) 1.2
    }

    return getFormatCodecPriority(fmt) * 100000 + heightVal + fpsVal;
}

/**
 * Filter and sort adaptive formats to prevent codec switching issues.
 * - Sorts by codec preference, height, and fps
 * - Keeps only one format per height+fps combination (the most preferred codec)
 * - Preserves all audio formats
 */
export function filterAdaptiveFormats(
    formats: Misc.Format[],
): Misc.Format[] {
    // Sort: audio first, then by codec preference, height desc, fps preference
    const sorted = [...formats].sort(
        (a, b) => getFormatSortValue(a) - getFormatSortValue(b),
    );

    // Filter out duplicates by height+fps, keeping only the first (most preferred codec)
    const seen = new Set<string>();
    return sorted.filter((fmt) => {
        // Keep all audio
        if (fmt.has_video === false) return true;
        // Keep formats without height info
        if (!fmt.height) return true;
        // Use height+fps as the unique key
        const key = `${fmt.height}@${fmt.fps || 0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Remove SupplementalProperty elements from DASH manifest that cause
 * color transfer issues when switching qualities.
 */
export function fixDashManifest(xml: string): string {
    let result = xml;
    let i = 0;

    while (true) {
        const start = result.indexOf("<SupplementalProperty", i);
        if (start === -1) break;

        const end = result.indexOf(">", start);
        if (end === -1) break;

        const tag = result.slice(start, end + 1);
        if (tag.includes('schemeIdUri="urn:mpeg:mpegB:')) {
            let removeEnd = end + 1;
            if (!tag.endsWith("/>")) {
                const closeTag = "</SupplementalProperty>";
                const close = result.indexOf(closeTag, end);
                if (close !== -1) {
                    removeEnd = close + closeTag.length;
                }
            }
            result = result.slice(0, start) + result.slice(removeEnd);
        } else {
            i = end + 1;
        }
    }

    return result;
}

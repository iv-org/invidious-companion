// Fix DASH manifest for Chromium compatibility.
// Prevents MEDIA_ERR_DECODE when the player auto-switches between
// different codec families mid-stream.
//
// Two-part fix based on investigation by MMaster in issue #172:
// 1. Filter adaptive formats BEFORE DASH generation using legacy Invidious unique_res behavior
//    (one format per height, first codec encountered after sorting by height/fps desc)
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
 * Filter and sort adaptive formats to prevent codec switching issues.
 * Uses legacy Invidious behavior (unique_res):
 * - Sorts by preferred codec, then height desc, then fps desc
 * - Keeps only the first format per height (best codec, highest fps)
 * - Preserves all audio formats
 */
export function filterAdaptiveFormats(
    formats: Misc.Format[],
): Misc.Format[] {
    // Sort: audio first, then by codec preference, height desc, fps desc
    const sorted = [...formats].sort((a, b) => {
        // Audio first
        if (a.has_video !== b.has_video) {
            return a.has_video ? 1 : -1;
        }
        // Preferred codec first
        const codecDiff = getFormatCodecPriority(a) - getFormatCodecPriority(b);
        if (codecDiff !== 0) return codecDiff;
        // Higher height first
        if ((a.height || 0) !== (b.height || 0)) {
            return (b.height || 0) - (a.height || 0);
        }
        // Higher fps first
        return (b.fps || 0) - (a.fps || 0);
    });

    // Filter by height only, taking the first codec encountered (legacy unique_res behavior)
    const seen = new Set<number>();
    return sorted.filter((fmt) => {
        // Keep all audio
        if (fmt.has_video === false) return true;
        // Keep formats without height info
        if (!fmt.height) return true;
        // Use height only as the unique key (legacy behavior)
        if (seen.has(fmt.height)) return false;
        seen.add(fmt.height);
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

import { assertEquals } from "./deps.ts";
import { validateVideoId } from "../lib/helpers/validateVideoId.ts";

Deno.test("Video ID validation", async (t) => {
    await t.step("accepts valid YouTube video IDs", () => {
        const validIds = [
            "jNQXAC9IVRw", // Standard video ID from tests
            "dQw4w9WgXcQ", // Rick Roll video
            "aqz-KE-bpKQ", // Video with hyphens
            "A_B_C_D_E_1", // Video with underscores
            "0123456789a", // Numbers and letters
            "ABCDEFGHIJK", // All uppercase
            "abcdefghijk", // All lowercase
            "-_-_-_-_-_-", // Hyphens and underscores
        ];

        for (const id of validIds) {
            assertEquals(
                validateVideoId(id),
                true,
                `Video ID "${id}" should be valid`,
            );
        }
    });

    await t.step("rejects invalid video IDs", () => {
        const invalidIds = [
            "", // Empty string
            "short", // Too short
            "thisistoolongtobeavalidvideoid", // Too long
            "exactly10c", // 10 characters (too short)
            "exactly12chr", // 12 characters (too long)
            "jNQXAC9IVR", // 10 characters
            "jNQXAC9IVRwX", // 12 characters
            "jNQX AC9IVRw", // Contains space
            "jNQX@AC9IVRw", // Contains @
            "jNQX#AC9IVRw", // Contains #
            "jNQX!AC9IVRw", // Contains !
            "jNQX$AC9IVRw", // Contains $
            "jNQX%AC9IVRw", // Contains %
            "jNQX&AC9IVRw", // Contains &
            "jNQX*AC9IVRw", // Contains *
            "jNQX(AC9IVRw", // Contains (
            "jNQX)AC9IVRw", // Contains )
            "jNQX=AC9IVRw", // Contains =
            "jNQX+AC9IVRw", // Contains +
            "jNQX[AC9IVRw", // Contains [
            "jNQX]AC9IVRw", // Contains ]
            "jNQX{AC9IVRw", // Contains {
            "jNQX}AC9IVRw", // Contains }
            "jNQX|AC9IVRw", // Contains |
            "jNQX\\AC9IVRw", // Contains \
            "jNQX/AC9IVRw", // Contains /
            "jNQX:AC9IVRw", // Contains :
            "jNQX;AC9IVRw", // Contains ;
            "jNQX'AC9IVRw", // Contains '
            'jNQX"AC9IVRw', // Contains "
            "jNQX<AC9IVRw", // Contains <
            "jNQX>AC9IVRw", // Contains >
            "jNQX,AC9IVRw", // Contains ,
            "jNQX.AC9IVRw", // Contains .
            "jNQX?AC9IVRw", // Contains ?
            "../../../etc", // Path traversal attempt
            "'; DROP TABLE", // SQL injection attempt
            "<script>xss", // XSS attempt (11 chars but invalid)
        ];

        for (const id of invalidIds) {
            assertEquals(
                validateVideoId(id),
                false,
                `Video ID "${id}" should be invalid`,
            );
        }
    });

    await t.step("handles edge cases", () => {
        // Test null/undefined handling with proper type casting
        assertEquals(
            validateVideoId(null as unknown as string),
            false,
            "null should be invalid",
        );
        assertEquals(
            validateVideoId(undefined as unknown as string),
            false,
            "undefined should be invalid",
        );

        // Test numbers
        assertEquals(
            validateVideoId(12345678901 as unknown as string),
            false,
            "Number should be invalid",
        );
    });
});

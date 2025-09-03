/**
 * Test for secret key validation in the config schema
 * This test verifies that SERVER_SECRET_KEY validation properly rejects special characters
 */
import { assert, assertEquals } from "./deps.ts";
import { z } from "zod";

// Extract the exact validation logic we implemented
const SecretKeySchema = z.string().length(16).regex(
    /^[a-zA-Z0-9]+$/,
    "SERVER_SECRET_KEY contains invalid characters. Only alphanumeric characters (a-z, A-Z, 0-9) are allowed. Please generate a valid key using 'pwgen 16 1' or ensure your key contains only letters and numbers.",
);

Deno.test("Secret key validation in config schema", async (t) => {
    await t.step("accepts valid alphanumeric keys", () => {
        const validKeys = [
            "aaaaaaaaaaaaaaaa", // all lowercase
            "AAAAAAAAAAAAAAAA", // all uppercase
            "1234567890123456", // all numbers
            "Aa1Bb2Cc3Dd4Ee5F", // mixed case
            "ABC123DEF456789A", // mixed letters and numbers
        ];

        for (const key of validKeys) {
            const result = SecretKeySchema.safeParse(key);
            assert(
                result.success,
                `Key "${key}" should be valid but was rejected`,
            );
            if (result.success) {
                assertEquals(result.data, key);
            }
        }
    });

    await t.step("rejects keys with special characters", () => {
        const invalidKeys = [
            "my#key!123456789", // Contains # and !
            "test@key12345678", // Contains @ (fixed length)
            "key-with-dashes1", // Contains -
            "key_with_under_s", // Contains _
            "key with spaces12", // Contains spaces (fixed length)
            "key$with$dollar$", // Contains $
            "key+with+plus+12", // Contains +
            "key=with=equals=", // Contains =
            "key(with)parens1", // Contains ()
            "key[with]bracket", // Contains []
        ];

        for (const key of invalidKeys) {
            const result = SecretKeySchema.safeParse(key);
            assert(
                !result.success,
                `Key "${key}" should be invalid but was accepted`,
            );
            if (!result.success) {
                const errorMessage = result.error.issues[0].message;
                assert(
                    errorMessage.includes(
                        "SERVER_SECRET_KEY contains invalid characters",
                    ),
                    `Error message should mention invalid characters, got: ${errorMessage}`,
                );
                assert(
                    errorMessage.includes("alphanumeric characters"),
                    `Error message should mention alphanumeric, got: ${errorMessage}`,
                );
                assert(
                    errorMessage.includes("pwgen"),
                    `Error message should suggest pwgen, got: ${errorMessage}`,
                );
            }
        }
    });

    await t.step("rejects keys with wrong length", () => {
        const wrongLengthKeys = [
            "short", // Too short
            "thiskeyistoolongtobevalid", // Too long
            "", // Empty
            "a", // Single character
            "exactly15chars", // 15 chars
            "exactly17charss", // 17 chars
        ];

        for (const key of wrongLengthKeys) {
            const result = SecretKeySchema.safeParse(key);
            assert(
                !result.success,
                `Key "${key}" (length ${key.length}) should be invalid but was accepted`,
            );
        }
    });

    await t.step("validates error message content", () => {
        // Test that special character validation provides the right error
        const specialCharResult = SecretKeySchema.safeParse("my#key!123456789");
        assert(!specialCharResult.success);
        
        if (!specialCharResult.success) {
            const errorMessage = specialCharResult.error.issues[0].message;
            
            // Check that the error message contains all expected elements
            assert(
                errorMessage.includes("SERVER_SECRET_KEY contains invalid characters"),
                "Should mention SERVER_SECRET_KEY and invalid characters",
            );
            assert(
                errorMessage.includes("Only alphanumeric characters (a-z, A-Z, 0-9) are allowed"),
                "Should specify allowed character set",
            );
            assert(
                errorMessage.includes("pwgen 16 1"),
                "Should suggest pwgen command",
            );
        }

        // Test that length validation still works and provides clear message
        const lengthResult = SecretKeySchema.safeParse("short");
        assert(!lengthResult.success);
        
        if (!lengthResult.success) {
            const lengthMessage = lengthResult.error.issues[0].message;
            assert(
                lengthMessage.includes("exactly 16 character"),
                `Should mention 16 characters: ${lengthMessage}`,
            );
        }
    });

    await t.step("validates precedence - length vs character validation", () => {
        // When both length and character validation fail, length should be checked first
        // This is the default Zod behavior
        const result = SecretKeySchema.safeParse("bad#");
        assert(!result.success);
        
        if (!result.success) {
            const errorMessage = result.error.issues[0].message;
            // Should get length error since it's checked first
            assert(
                errorMessage.includes("exactly 16 character"),
                `Should get length error first: ${errorMessage}`,
            );
        }
    });
});
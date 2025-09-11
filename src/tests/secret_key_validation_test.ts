/**
 * Test for secret key validation in the actual Invidious companion configuration
 * This test verifies that SERVER_SECRET_KEY validation properly rejects special characters
 * when the actual config is parsed
 */
import { assert, assertEquals } from "./deps.ts";
import { parseConfig } from "../lib/helpers/config.ts";

Deno.test("Secret key validation in Invidious companion config", async (t) => {
    // Clean up any existing environment variables that might interfere
    Deno.env.delete("SERVER_SECRET_KEY");

    await t.step("accepts valid alphanumeric keys", async () => {
        const validKeys = [
            "aaaaaaaaaaaaaaaa", // all lowercase
            "AAAAAAAAAAAAAAAA", // all uppercase
            "1234567890123456", // all numbers
            "Aa1Bb2Cc3Dd4Ee5F", // mixed case
            "ABC123DEF456789A", // mixed letters and numbers
        ];

        for (const key of validKeys) {
            // Set the environment variable for each test
            Deno.env.set("SERVER_SECRET_KEY", key);

            try {
                const config = await parseConfig();
                assertEquals(
                    config.server.secret_key,
                    key,
                    `Key "${key}" should be accepted and stored correctly`,
                );
            } catch (error) {
                assert(
                    false,
                    `Key "${key}" should be valid but config parsing failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    });

    await t.step("rejects keys with special characters", async () => {
        const invalidKeys = [
            "my#key!123456789", // Contains # and !
            "test@key12345678", // Contains @ (fixed length)
            "key-with-dashes1", // Contains -
            "key_with_under_s", // Contains _
            "key with spaces1", // Contains spaces (fixed length to 16)
            "key$with$dollar$", // Contains $
            "key+with+plus+12", // Contains +
            "key=with=equals=", // Contains =
            "key(with)parens1", // Contains ()
            "key[with]bracket", // Contains []
        ];

        for (const key of invalidKeys) {
            // Set the environment variable for each test
            Deno.env.set("SERVER_SECRET_KEY", key);

            try {
                await parseConfig();
                assert(
                    false,
                    `Key "${key}" should be invalid but config parsing succeeded`,
                );
            } catch (error) {
                // Verify it's a config parsing error with the right message
                assert(
                    error instanceof Error &&
                        error.message.includes("Failed to parse configuration"),
                    `Should get config parsing error, got: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );

                // Check that the error contains expected validation message content
                const errorStr = error instanceof Error
                    ? error.toString()
                    : String(error);
                assert(
                    errorStr.includes(
                        "SERVER_SECRET_KEY contains invalid characters",
                    ) ||
                        errorStr.includes("alphanumeric characters"),
                    `Error should mention invalid characters or alphanumeric, got: ${errorStr}`,
                );
            }
        }
    });

    await t.step("rejects keys with wrong length", async () => {
        const wrongLengthKeys = [
            "short", // Too short
            "thiskeyistoolongtobevalid", // Too long
            "", // Empty
            "a", // Single character
            "exactly15chars", // 15 chars
            "exactly17charss", // 17 chars
        ];

        for (const key of wrongLengthKeys) {
            // Set the environment variable for each test
            Deno.env.set("SERVER_SECRET_KEY", key);

            try {
                await parseConfig();
                assert(
                    false,
                    `Key "${key}" (length ${key.length}) should be invalid but config parsing succeeded`,
                );
            } catch (error) {
                // Verify it's a config parsing error
                assert(
                    error instanceof Error &&
                        error.message.includes("Failed to parse configuration"),
                    `Should get config parsing error, got: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );

                // Check that the error mentions length requirement
                const errorStr = error instanceof Error
                    ? error.toString()
                    : String(error);
                assert(
                    errorStr.includes("exactly 16 character") ||
                        errorStr.includes(
                            "String must contain exactly 16 character",
                        ),
                    `Error should mention 16 characters, got: ${errorStr}`,
                );
            }
        }
    });

    await t.step("validates error message content", async () => {
        // Test that special character validation provides the right error
        Deno.env.set("SERVER_SECRET_KEY", "my#key!123456789");

        try {
            await parseConfig();
            assert(false, "Should have failed with special character key");
        } catch (error) {
            const errorStr = error instanceof Error
                ? error.toString()
                : String(error);

            // Check that the error message contains validation details
            assert(
                errorStr.includes(
                    "SERVER_SECRET_KEY contains invalid characters",
                ) ||
                    errorStr.includes("alphanumeric characters"),
                "Should mention SERVER_SECRET_KEY and character validation",
            );
        }

        // Test that length validation still works and provides clear message
        Deno.env.set("SERVER_SECRET_KEY", "short");

        try {
            await parseConfig();
            assert(false, "Should have failed with short key");
        } catch (error) {
            const errorStr = error instanceof Error
                ? error.toString()
                : String(error);
            assert(
                errorStr.includes("exactly 16 character") ||
                    errorStr.includes(
                        "String must contain exactly 16 character",
                    ),
                `Should mention 16 characters: ${errorStr}`,
            );
        }
    });

    await t.step(
        "validates precedence - length vs character validation",
        async () => {
            // When both length and character validation fail, length should be checked first
            // This is the default Zod behavior
            Deno.env.set("SERVER_SECRET_KEY", "bad#");

            try {
                await parseConfig();
                assert(
                    false,
                    "Should have failed with short key containing special chars",
                );
            } catch (error) {
                const errorStr = error instanceof Error
                    ? error.toString()
                    : String(error);
                // Should get length error since it's checked first
                assert(
                    errorStr.includes("exactly 16 character") ||
                        errorStr.includes(
                            "String must contain exactly 16 character",
                        ),
                    `Should get length error first: ${errorStr}`,
                );
            }
        },
    );

    // Clean up environment variable after tests
    await t.step("validates missing SERVER_SECRET_KEY fails", async () => {
        // Test with no SERVER_SECRET_KEY set (uses default empty string)
        Deno.env.delete("SERVER_SECRET_KEY");

        try {
            await parseConfig();
            assert(
                false,
                "Should have failed with missing/empty SERVER_SECRET_KEY",
            );
        } catch (error) {
            const errorStr = error instanceof Error
                ? error.toString()
                : String(error);
            assert(
                errorStr.includes("exactly 16 character") ||
                    errorStr.includes(
                        "String must contain exactly 16 character",
                    ),
                `Should get length error for empty key: ${errorStr}`,
            );
        }
    });

    await t.step("cleanup", () => {
        Deno.env.delete("SERVER_SECRET_KEY");
    });
});

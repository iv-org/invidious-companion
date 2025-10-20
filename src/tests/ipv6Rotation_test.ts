import { assertEquals, assertThrows } from "./deps.ts";
import { generateRandomIPv6 } from "../lib/helpers/ipv6Rotation.ts";

Deno.test("generateRandomIPv6 - generates valid IPv6 addresses", () => {
    const ipv6Block = "2001:db8::/32";

    // Generate multiple addresses to ensure randomness
    const addresses = new Set<string>();
    for (let i = 0; i < 100; i++) {
        const addr = generateRandomIPv6(ipv6Block);
        addresses.add(addr);

        // Verify the address starts with the correct prefix
        // For /32 block, the first 32 bits should match
        // 2001:db8 = first 32 bits
        const parts = addr.split(":");
        assertEquals(parts[0], "2001");
        assertEquals(parts[1], "db8");
    }

    // Ensure we got different addresses (high probability with randomization)
    // At least 50 unique addresses out of 100 should be generated
    assertEquals(addresses.size > 50, true);
});

Deno.test("generateRandomIPv6 - handles different block sizes", () => {
    // Test with /32 block
    const addr32 = generateRandomIPv6("2001:db8::/32");
    const parts32 = addr32.split(":");
    assertEquals(parts32[0], "2001");
    assertEquals(parts32[1], "db8");

    // Test with /48 block
    const addr48 = generateRandomIPv6("2001:db8:1234::/48");
    const parts48 = addr48.split(":");
    assertEquals(parts48[0], "2001");
    assertEquals(parts48[1], "db8");
    assertEquals(parts48[2], "1234");

    // Test with /64 block
    const addr64 = generateRandomIPv6("2001:db8::/64");
    const parts64 = addr64.split(":");
    assertEquals(parts64[0], "2001");
    assertEquals(parts64[1], "db8");
});

Deno.test("generateRandomIPv6 - throws error for invalid block size", () => {
    assertThrows(
        () => generateRandomIPv6("2001:db8::/129"),
        Error,
        "Invalid IPv6 block size",
    );

    assertThrows(
        () => generateRandomIPv6("2001:db8::/0"),
        Error,
        "Invalid IPv6 block size",
    );
});

Deno.test("generateRandomIPv6 - handles compressed IPv6 notation", () => {
    const ipv6Block = "2001:db8::/32";
    const addr = generateRandomIPv6(ipv6Block);

    // Address should be valid IPv6
    const parts = addr.split(":");
    assertEquals(parts.length >= 3, true); // At least some parts should be present
    assertEquals(parts[0], "2001");
    assertEquals(parts[1], "db8");
});

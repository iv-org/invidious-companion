import { assertEquals, assertThrows } from "@std/assert";
import { generateRandomIPv6 } from "../lib/helpers/ipv6Rotation.ts";

Deno.test("generateRandomIPv6 - generates valid IPv6 addresses", () => {
    const ipv6Block = "2001:db8::/32";
    const subnetBits = 48;

    // Generate multiple addresses to ensure randomness
    const addresses = new Set<string>();
    for (let i = 0; i < 100; i++) {
        const addr = generateRandomIPv6(ipv6Block, subnetBits);
        addresses.add(addr);

        // Verify the address starts with the correct prefix
        // For /32 block with /48 subnet, the first 32 bits should match
        // 2001:db8 = first 32 bits
        const parts = addr.split(":");
        assertEquals(parts[0], "2001");
        assertEquals(parts[1], "db8");
    }

    // Ensure we got different addresses (high probability with randomization)
    // At least 50 unique addresses out of 100 should be generated
    assertEquals(addresses.size > 50, true);
});

Deno.test("generateRandomIPv6 - handles different subnet sizes", () => {
    const ipv6Block = "2001:db8::/32";

    // Test with /64 subnet
    const addr64 = generateRandomIPv6(ipv6Block, 64);
    const parts64 = addr64.split(":");
    assertEquals(parts64[0], "2001");
    assertEquals(parts64[1], "db8");

    // Test with /128 subnet (should return exact address within block)
    const addr128 = generateRandomIPv6(ipv6Block, 128);
    const parts128 = addr128.split(":");
    assertEquals(parts128[0], "2001");
    assertEquals(parts128[1], "db8");
});

Deno.test("generateRandomIPv6 - throws error for invalid block size", () => {
    assertThrows(
        () => generateRandomIPv6("2001:db8::/129", 48),
        Error,
        "Invalid IPv6 block size",
    );

    assertThrows(
        () => generateRandomIPv6("2001:db8::/0", 48),
        Error,
        "Invalid IPv6 block size",
    );
});

Deno.test("generateRandomIPv6 - throws error for invalid subnet size", () => {
    assertThrows(
        () => generateRandomIPv6("2001:db8::/32", 31),
        Error,
        "Subnet bits",
    );

    assertThrows(
        () => generateRandomIPv6("2001:db8::/32", 129),
        Error,
        "Subnet bits",
    );
});

Deno.test("generateRandomIPv6 - handles compressed IPv6 notation", () => {
    const ipv6Block = "2001:db8::/32";
    const addr = generateRandomIPv6(ipv6Block, 48);

    // Address should be valid IPv6
    const parts = addr.split(":");
    assertEquals(parts.length >= 3, true); // At least some parts should be present
    assertEquals(parts[0], "2001");
    assertEquals(parts[1], "db8");
});

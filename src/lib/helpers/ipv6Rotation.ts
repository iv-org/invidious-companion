/**
 * IPv6 Rotation Utility
 *
 * This module provides IPv6 address rotation functionality to help avoid
 * "Please login" errors from YouTube by sending each request from a unique
 * IPv6 address within a configured IPv6 block.
 *
 * Setup instructions: https://gist.github.com/unixfox/2a9dbcb23d8f69c4582f7c85a849d5cc#linux-setup
 */

/**
 * Generate a random IPv6 address within the specified IPv6 block
 * @param ipv6Block - The IPv6 block in CIDR notation (e.g., "2001:db8::/32")
 * @returns A random IPv6 address within the specified IPv6 block
 */
export function generateRandomIPv6(ipv6Block: string): string {
    // Parse the IPv6 block
    const [baseAddress, blockSize] = ipv6Block.split("/");
    const blockBits = parseInt(blockSize, 10);

    if (isNaN(blockBits) || blockBits < 1 || blockBits > 128) {
        throw new Error("Invalid IPv6 block size");
    }

    // Expand IPv6 address to full form
    const expandedBase = expandIPv6(baseAddress);

    // Convert to binary representation
    const baseBytes = ipv6ToBytes(expandedBase);

    // Randomize all bits after the block prefix
    for (let i = Math.floor(blockBits / 8); i < 16; i++) {
        const bitOffset = Math.max(0, blockBits - i * 8);
        if (bitOffset === 0) {
            // Fully random byte
            baseBytes[i] = Math.floor(Math.random() * 256);
        } else if (bitOffset < 8) {
            // Partially random byte
            const mask = (1 << (8 - bitOffset)) - 1;
            const randomPart = Math.floor(Math.random() * (mask + 1));
            baseBytes[i] = (baseBytes[i] & ~mask) | randomPart;
        }
        // else: keep the original byte (bitOffset >= 8)
    }

    // Convert back to IPv6 string
    return bytesToIPv6(baseBytes);
}

/**
 * Expand an IPv6 address to its full form
 */
function expandIPv6(address: string): string {
    // Handle :: expansion
    if (address.includes("::")) {
        const parts = address.split("::");
        const leftParts = parts[0] ? parts[0].split(":") : [];
        const rightParts = parts[1] ? parts[1].split(":") : [];
        const missingParts = 8 - leftParts.length - rightParts.length;
        const middle = Array(missingParts).fill("0000");
        const allParts = [...leftParts, ...middle, ...rightParts];
        return allParts.map((p) => p.padStart(4, "0")).join(":");
    }

    // Pad each part to 4 characters
    return address.split(":").map((p) => p.padStart(4, "0")).join(":");
}

/**
 * Convert IPv6 address string to byte array
 */
function ipv6ToBytes(address: string): number[] {
    const parts = address.split(":");
    const bytes: number[] = [];

    for (const part of parts) {
        const value = parseInt(part, 16);
        bytes.push((value >> 8) & 0xFF);
        bytes.push(value & 0xFF);
    }

    return bytes;
}

/**
 * Convert byte array back to IPv6 address string
 */
function bytesToIPv6(bytes: number[]): string {
    const parts: string[] = [];

    for (let i = 0; i < 16; i += 2) {
        const value = (bytes[i] << 8) | bytes[i + 1];
        parts.push(value.toString(16));
    }

    // Compress consecutive zeros
    let ipv6 = parts.join(":");

    // Find the longest sequence of consecutive zeros
    const zeroSequences = ipv6.match(/(^|:)(0:)+/g);
    if (zeroSequences) {
        const longestZeroSeq = zeroSequences.reduce((a, b) =>
            a.length > b.length ? a : b
        );
        ipv6 = ipv6.replace(longestZeroSeq, longestZeroSeq[0] + ":");
    }

    return ipv6;
}

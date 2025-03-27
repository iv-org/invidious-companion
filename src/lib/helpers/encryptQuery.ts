import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { Aes } from "crypto/aes.ts";
import { Ecb, Padding } from "crypto/block-modes.ts";
import type { Config } from "./config.ts";

export const encryptQuery = (
    queryParams: string,
    config: Config,
): string => {
    try {
        const cipher = new Ecb(
            Aes,
            new TextEncoder().encode(
                config.server.secret_key,
            ),
            Padding.PKCS7,
        );

        const encodedData = new TextEncoder().encode(
            queryParams,
        );

        const encryptedData = cipher.encrypt(encodedData);

        return encodeBase64(encryptedData);
    } catch (err) {
        console.error("[ERROR] Failed to encrypt query parameters:", err);
        return "";
    }
};

export const decryptQuery = (
    queryParams: string,
    config: Config,
): string => {
    try {
        const decipher = new Ecb(
            Aes,
            new TextEncoder().encode(config.server.secret_key),
            Padding.PKCS7,
        );

        const decryptedData = new TextDecoder().decode(
            decipher.decrypt(
                decodeBase64(
                    queryParams,
                ),
            ),
        );

        return decryptedData;
    } catch (err) {
        console.error("[ERROR] Failed to decrypt query parameters:", err);
        return "";
    }
};

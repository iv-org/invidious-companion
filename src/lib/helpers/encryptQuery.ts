import { createCipheriv, createDecipheriv } from "node:crypto";
import type { Config } from "./config.ts";

export const encryptQuery = (
    queryParams: string,
    config: Config,
): string => {
    try {
        const cipher = createCipheriv(
            "aes-128-ecb",
            Buffer.from(config.server.secret_key),
            null,
        );

        return Buffer.concat([
            cipher.update(queryParams, "utf8"),
            cipher.final(),
        ]).toString("base64");
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
        const decipher = createDecipheriv(
            "aes-128-ecb",
            Buffer.from(config.server.secret_key),
            null,
        );

        return Buffer.concat([
            decipher.update(Buffer.from(queryParams, "base64")),
            decipher.final(),
        ]).toString("utf8");
    } catch (err) {
        console.error("[ERROR] Failed to decrypt query parameters:", err);
        return "";
    }
};

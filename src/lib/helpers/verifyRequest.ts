import { createDecipheriv } from "node:crypto";
import type { Config } from "./config.ts";

export const verifyRequest = (
    stringToCheck: string,
    videoId: string,
    config: Config,
): boolean => {
    try {
        const decipher = createDecipheriv(
            "aes-128-ecb",
            Buffer.from(config.server.secret_key),
            null,
        );

        const encryptedData = Buffer.concat([
            decipher.update(
                Buffer.from(
                    stringToCheck.replace(/-/g, "+").replace(/_/g, "/"),
                    "base64",
                ),
            ),
            decipher.final(),
        ]).toString("utf8");
        const [parsedTimestamp, parsedVideoId] = encryptedData.split("|");
        const parsedTimestampInt = parseInt(parsedTimestamp);
        const timestampNow = Math.round(Date.now() / 1000);
        if (parsedVideoId !== videoId) {
            return false;
        }
        // only allow ID to live for 6 hours
        if ((timestampNow + 6 * 60 * 60) - parsedTimestampInt < 0) {
            return false;
        }
    } catch (_) {
        return false;
    }
    return true;
};

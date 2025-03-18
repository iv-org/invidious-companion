import { Store } from "@willsoto/node-konfig-core";
import { decodeBase64 } from "@std/encoding/base64";
import { Aes } from "crypto/aes.ts";
import {
    Ecb,
    Padding,
} from "crypto/block-modes.ts";

export const verifyRequest = (
    stringToCheck: string,
    videoId: string,
    konfigStore: Store,
): boolean => {
    try {
        const decipher = new Ecb(
            Aes,
            new TextEncoder().encode((
                Deno.env.get("SERVER_SECRET_KEY") ||
                konfigStore.get("server.secret_key") as string
            ).substring(0, 16)),
            Padding.PKCS7,
        );

        const encryptedData = new TextDecoder().decode(
            decipher.decrypt(
                decodeBase64(
                    stringToCheck.replace(/-/g, "+").replace(/_/g, "/"),
                ),
            ),
        );
        const [parsedTimestamp, parsedVideoId] = encryptedData.split("|");
        const parsedTimestampInt = parseInt(parsedTimestamp);
        const timestampNow = Math.round(+new Date() / 1000);
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

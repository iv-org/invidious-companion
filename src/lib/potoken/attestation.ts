import type { Innertube } from "youtubei.js";
import { buildURL, GOOG_API_KEY } from "bgutils";
import { INTEGRITY_TOKEN_REQUEST_KEY } from "./constants.ts";

export type FetchFunction = typeof fetch;

export interface AttestationChallenge {
    program: string;
    globalName: string;
    interpreterJavascript: string;
}

export async function getAttestationChallenge(
    innertubeClient: Innertube,
    fetchImpl: FetchFunction,
    userAgent: string,
): Promise<AttestationChallenge> {
    const response = asRecord(
        await innertubeClient.getAttestationChallenge(
            "ENGAGEMENT_TYPE_UNBOUND",
        ),
    );
    const challenge = asRecord(response?.bg_challenge ?? response?.bgChallenge);
    if (!challenge) throw new Error("Could not get attestation challenge");

    const program = getString(challenge, "program");
    const globalName = getString(challenge, "global_name", "globalName");
    if (!program || !globalName) {
        throw new Error("Attestation challenge was incomplete");
    }

    const interpreter = asRecord(
        challenge.interpreter_javascript ?? challenge.interpreterJavascript,
    );
    let interpreterJavascript = interpreter && getString(
        interpreter,
        "private_do_not_access_or_else_safe_script_wrapped_value",
        "privateDoNotAccessOrElseSafeScriptWrappedValue",
    );
    if (!interpreterJavascript) {
        const interpreterUrl = asRecord(
            challenge.interpreter_url ?? challenge.interpreterUrl,
        );
        const rawUrl = (interpreterUrl && getString(
            interpreterUrl,
            "private_do_not_access_or_else_trusted_resource_url_wrapped_value",
            "privateDoNotAccessOrElseTrustedResourceUrlWrappedValue",
        )) || (interpreter && getString(
            interpreter,
            "private_do_not_access_or_else_trusted_resource_url_wrapped_value",
            "privateDoNotAccessOrElseTrustedResourceUrlWrappedValue",
        ));
        if (!rawUrl) {
            throw new Error("Attestation challenge had no interpreter");
        }

        const scriptResponse = await fetchImpl(
            new URL(rawUrl, "https://www.youtube.com/"),
            { headers: { accept: "*/*", "user-agent": userAgent } },
        );
        if (!scriptResponse.ok) {
            throw new Error(
                `Could not load BotGuard interpreter: ${scriptResponse.status}`,
            );
        }
        interpreterJavascript = await scriptResponse.text();
    }

    if (!interpreterJavascript.trim()) {
        throw new Error("BotGuard interpreter was empty");
    }
    return { program, globalName, interpreterJavascript };
}

export async function getIntegrityToken(
    fetchImpl: FetchFunction,
    userAgent: string,
    botguardResponse: string,
): Promise<string> {
    const response = await fetchImpl(
        buildURL("GenerateIT", true),
        {
            method: "POST",
            headers: {
                "content-type": "application/json+protobuf",
                "x-goog-api-key": GOOG_API_KEY,
                "x-user-agent": "grpc-web-javascript/0.1",
                "user-agent": userAgent,
            },
            body: JSON.stringify([
                INTEGRITY_TOKEN_REQUEST_KEY,
                botguardResponse,
            ]),
        },
    );
    if (!response.ok) {
        throw new Error(`Could not get integrity token: ${response.status}`);
    }
    const body = await response.json();
    if (!Array.isArray(body) || typeof body[0] !== "string") {
        throw new Error("Integrity token response was invalid");
    }
    return body[0];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function getString(
    record: Record<string, unknown>,
    ...keys: string[]
): string | undefined {
    for (const key of keys) {
        if (typeof record[key] === "string" && record[key]) {
            return record[key] as string;
        }
    }
    return undefined;
}

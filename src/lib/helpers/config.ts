import { z, ZodError } from "zod";
import { parse } from "@std/toml";

export const ConfigSchema = z.object({
    server: z.object({
        port: z.number().default(Number(Deno.env.get("PORT")) || 8282),
        host: z.string().default(Deno.env.get("HOST") || "127.0.0.1"),
        secret_key: z.string().length(16).default(
            Deno.env.get("SERVER_SECRET_KEY") || "",
        ),
        verify_requests: z.boolean().default(false),
        encrypt_query_params: z.boolean().default(
            Deno.env.get("SERVER_ENCRYPT_QUERY_PARAMS") === "true" || false,
        ),
        enable_metrics: z.boolean().default(
            Deno.env.get("SERVER_ENABLE_METRICS") === "true" || false,
        ),
    }).strict().default({}),
    cache: z.object({
        enabled: z.boolean().default(true),
        directory: z.string().default("/var/tmp"),
    }).strict().default({}),
    networking: z.object({
        ump: z.boolean().default(false),
        proxy: z.string().nullable().default(Deno.env.get("PROXY") || null),
        fetch: z.object({
            timeout_ms: z.number().default(30_000),
            retry: z.object({
                enabled: z.boolean(),
                times: z.number().optional(),
                initial_debounce: z.number().optional(),
                debounce_multiplier: z.number().optional(),
            }).strict().optional(),
        }).strict().optional(),
    }).strict().default({}),
    jobs: z.object({
        youtube_session: z.object({
            po_token_enabled: z.boolean().default(true),
            frequency: z.string().default("*/5 * * * *"),
        }).strict().default({}),
    }).strict().default({}),
    youtube_session: z.object({
        oauth_enabled: z.boolean().default(false),
        cookies: z.string().default(""),
    }).strict().default({}),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

export async function parseConfig() {
    const configFileName = Deno.env.get("CONFIG_FILE") || "config/config.toml";
    const configFileContents = await Deno.readTextFile(configFileName).catch(
        () => null,
    );
    if (configFileContents) {
        console.log("[INFO] Using custom settings local file");
    } else {
        console.log(
            "[INFO] No local config file found, using default config",
        );
    }

    try {
        const rawConfig = configFileContents ? parse(configFileContents) : {};
        const validatedConfig = ConfigSchema.parse(rawConfig);

        console.log("Loaded Configuration", validatedConfig);

        return validatedConfig;
    } catch (err) {
        let errorMessage =
            "There is an error in your configuration, check your environment variables";
        if (configFileContents) {
            errorMessage +=
                ` or in your configuration file located at ${configFileName}`;
        }
        console.log(errorMessage);
        if (err instanceof ZodError) {
            console.log(err.issues);
            throw new Error("Failed to parse configuration file");
        }
        // rethrow error if not Zod
        throw err;
    }
}

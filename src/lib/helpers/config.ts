import { z, ZodError } from "zod";
import { parse } from "@std/toml";

export const ConfigSchema = z.object({
    server: z.object({
        port: z.number().default(Number(Deno.env.get("PORT")) || 8282),
        host: z.string().default(Deno.env.get("HOST") || "127.0.0.1"),
        use_unix_socket: z.boolean().default(
            Deno.env.get("SERVER_USE_UNIX_SOCKET") === "true" || false,
        ),
        unix_socket_path: z.string().default(
            Deno.env.get("SERVER_UNIX_SOCKET_PATH") ||
                "/tmp/invidious-companion.sock",
        ),
        secret_key: z.string().length(16).default(
            Deno.env.get("SERVER_SECRET_KEY") || "",
        ),
        verify_requests: z.boolean().default(
            Deno.env.get("SERVER_VERIFY_REQUESTS") === "true" || false,
        ),
        encrypt_query_params: z.boolean().default(
            Deno.env.get("SERVER_ENCRYPT_QUERY_PARAMS") === "true" || false,
        ),
        enable_metrics: z.boolean().default(
            Deno.env.get("SERVER_ENABLE_METRICS") === "true" || false,
        ),
    }).strict().default({}),
    cache: z.object({
        enabled: z.boolean().default(
            Deno.env.get("CACHE_ENABLED") === "false" ? false : true,
        ),
        directory: z.string().default(
            Deno.env.get("CACHE_DIRECTORY") || "/var/tmp",
        ),
    }).strict().default({}),
    networking: z.object({
        proxy: z.string().nullable().default(Deno.env.get("PROXY") || null),
        fetch: z.object({
            timeout_ms: z.number().default(
                Number(Deno.env.get("NETWORKING_FETCH_TIMEOUT_MS")) || 30_000,
            ),
            retry: z.object({
                enabled: z.boolean().default(
                    Deno.env.get("NETWORKING_FETCH_RETRY_ENABLED") === "true" ||
                        false,
                ),
                times: z.number().optional().default(
                    Number(Deno.env.get("NETWORKING_FETCH_RETRY_TIMES")) || 1,
                ),
                initial_debounce: z.number().optional().default(
                    Number(
                        Deno.env.get("NETWORKING_FETCH_RETRY_INITIAL_DEBOUNCE"),
                    ) || 0,
                ),
                debounce_multiplier: z.number().optional().default(
                    Number(
                        Deno.env.get(
                            "NETWORKING_FETCH_RETRY_DEBOUNCE_MULTIPLIER",
                        ),
                    ) || 0,
                ),
            }).strict().default({}),
        }).strict().default({}),
        videoplayback: z.object({
            ump: z.boolean().default(
                Deno.env.get("NETWORKING_VIDEOPLAYBACK_UMP") === "true" ||
                    false,
            ),
            video_fetch_chunk_size_mb: z.number().default(
                Number(
                    Deno.env.get(
                        "NETWORKING_VIDEOPLAYBACK_VIDEO_FETCH_CHUNK_SIZE_MB",
                    ),
                ) || 5,
            ),
        }).strict().default({}),
    }).strict().default({}),
    jobs: z.object({
        youtube_session: z.object({
            po_token_enabled: z.boolean().default(
                Deno.env.get("JOBS_YOUTUBE_SESSION_PO_TOKEN_ENABLED") ===
                        "false"
                    ? false
                    : true,
            ),
            frequency: z.string().default(
                Deno.env.get("JOBS_YOUTUBE_SESSION_FREQUENCY") || "*/5 * * * *",
            ),
        }).strict().default({}),
    }).strict().default({}),
    youtube_session: z.object({
        oauth_enabled: z.boolean().default(
            Deno.env.get("YOUTUBE_SESSION_OAUTH_ENABLED") === "true" || false,
        ),
        cookies: z.string().default(
            Deno.env.get("YOUTUBE_SESSION_COOKIES") || "",
        ),
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

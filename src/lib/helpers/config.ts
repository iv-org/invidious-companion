import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { z, ZodError } from "zod";

const env = (name: string): string | undefined => process.env[name];

export const ConfigSchema = z.object({
    server: z.object({
        port: z.number().default(Number(env("PORT")) || 8282),
        host: z.string().default(env("HOST") || "127.0.0.1"),
        use_unix_socket: z.boolean().default(
            env("SERVER_USE_UNIX_SOCKET") === "true" || false,
        ),
        unix_socket_path: z.string().default(
            env("SERVER_UNIX_SOCKET_PATH")
                || "/tmp/invidious-companion.sock",
        ),
        base_path: z.string()
            .default(env("SERVER_BASE_PATH") || "/companion")
            .refine(
                (path) => path.startsWith("/"),
                {
                    message: "SERVER_BASE_PATH must start with a forward slash (/). Example: '/companion'",
                },
            )
            .refine(
                (path) => !path.endsWith("/") || path === "/",
                {
                    message:
                        "SERVER_BASE_PATH must not end with a forward slash (/) unless it's the root path. Example: '/companion' not '/companion/'",
                },
            )
            .refine(
                (path) => !path.includes("//"),
                {
                    message:
                        "SERVER_BASE_PATH must not contain double slashes (//). Example: '/companion' not '//companion' or '/comp//anion'",
                },
            ),
        secret_key: z.preprocess(
            (val) =>
                val === undefined
                    ? env("SERVER_SECRET_KEY") || ""
                    : val,
            z.string().length(16).regex(
                /^[a-zA-Z0-9]+$/,
                "SERVER_SECRET_KEY contains invalid characters. Only alphanumeric characters (a-z, A-Z, 0-9) are allowed. Please generate a valid key using 'pwgen 16 1' or ensure your key contains only letters and numbers.",
            ),
        ).default(undefined),
        verify_requests: z.boolean().default(
            env("SERVER_VERIFY_REQUESTS") === "true" || false,
        ),
        encrypt_query_params: z.boolean().default(
            env("SERVER_ENCRYPT_QUERY_PARAMS") === "true" || false,
        ),
        enable_metrics: z.boolean().default(
            env("SERVER_ENABLE_METRICS") === "true" || false,
        ),
    }).strict().default({}),
    cache: z.object({
        enabled: z.boolean().default(
            env("CACHE_ENABLED") === "false" ? false : true,
        ),
        directory: z.string().default(
            env("CACHE_DIRECTORY") || "/var/tmp",
        ),
    }).strict().default({}),
    networking: z.object({
        proxy: z.string().nullable().default(env("PROXY") || null),
        ipv6_block: z.string().nullable().default(
            env("NETWORKING_IPV6_BLOCK") || null,
        ),
        fetch: z.object({
            timeout_ms: z.number().default(
                Number(env("NETWORKING_FETCH_TIMEOUT_MS")) || 30_000,
            ),
            retry: z.object({
                enabled: z.boolean().default(
                    env("NETWORKING_FETCH_RETRY_ENABLED") === "true"
                        || false,
                ),
                times: z.number().optional().default(
                    Number(env("NETWORKING_FETCH_RETRY_TIMES")) || 1,
                ),
                initial_debounce: z.number().optional().default(
                    Number(
                        env("NETWORKING_FETCH_RETRY_INITIAL_DEBOUNCE"),
                    ) || 0,
                ),
                debounce_multiplier: z.number().optional().default(
                    Number(
                        env(
                            "NETWORKING_FETCH_RETRY_DEBOUNCE_MULTIPLIER",
                        ),
                    ) || 0,
                ),
            }).strict().default({}),
        }).strict().default({}),
        videoplayback: z.object({
            ump: z.boolean().default(
                env("NETWORKING_VIDEOPLAYBACK_UMP") === "true"
                    || false,
            ),
            video_fetch_chunk_size_mb: z.number().default(
                Number(
                    env(
                        "NETWORKING_VIDEOPLAYBACK_VIDEO_FETCH_CHUNK_SIZE_MB",
                    ),
                ) || 5,
            ),
        }).strict().default({}),
    }).strict().default({}),
    jobs: z.object({
        youtube_session: z.object({
            po_token_enabled: z.boolean().default(
                env("JOBS_YOUTUBE_SESSION_PO_TOKEN_ENABLED")
                        === "false"
                    ? false
                    : true,
            ),
            frequency: z.string().default(
                env("JOBS_YOUTUBE_SESSION_FREQUENCY") || "*/5 * * * *",
            ),
        }).strict().default({}),
    }).strict().default({}),
    youtube_session: z.object({
        oauth_enabled: z.boolean().default(
            env("YOUTUBE_SESSION_OAUTH_ENABLED") === "true" || false,
        ),
        cookies: z.string().default(
            env("YOUTUBE_SESSION_COOKIES") || "",
        ),
    }).strict().default({}),
    captions: z.object({
        enabled: z.boolean().default(
            env("CAPTIONS_ENABLED") === "false" ? false : true,
        ),
    }).strict().default({}),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

export async function parseConfig() {
    const configFileName = env("CONFIG_FILE") || "config/config.toml";
    const configFileContents = await readFile(configFileName).then((data) => data.toString()).catch(() => null);
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
        let errorMessage = "There is an error in your configuration, check your environment variables";
        if (configFileContents) {
            errorMessage += ` or in your configuration file located at ${configFileName}`;
        }
        console.log(errorMessage);
        if (err instanceof ZodError) {
            console.log(err.issues);
            // Include detailed error information in the thrown error for testing
            const detailedMessage = err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
            throw new Error(
                `Failed to parse configuration file: ${detailedMessage}`,
            );
        }
        // rethrow error if not Zod
        throw err;
    }
}

import { z, ZodError } from "zod";
import { parse } from "jsr:@std/toml";

const ConfigSchema = z.object({
    server: z.object({
        port: z.number().default(8282),
        host: z.string().default("127.0.0.1"),
        secret_key: z.string().default("CHANGE_ME"),
        verify_requests: z.boolean().default(false),
    }).strict().default({}),
    cache: z.object({
        enabled: z.boolean().default(true),
        directory: z.string().default("/var/tmp"),
    }).strict().default({}),
    networking: z.object({
        ump: z.boolean().default(false),
        proxy: z.string().optional(),
        fetch: z.object({
            timeout_ms: z.number().optional(),
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
    try {
        const configFileContents = await Deno.readTextFile("config/local.toml").catch(() => null);
        if (configFileContents) {
            console.log('[INFO] Using custom settings local file')
        } else {
            console.log('[INFO] No local config file found, using default config')
        }
        const rawConfig = configFileContents ? parse(configFileContents) : {};
        const validatedConfig = ConfigSchema.parse(rawConfig);

        console.log("Loaded Configuration", validatedConfig);

        return validatedConfig;
    } catch (err) {
        console.log("There is an error in your local.toml config file");
        if (err instanceof ZodError) {
            console.log(err.issues);
            throw new Error("Failed to parse configuration file");
        }
        // rethrow error if not Zod
        throw err;
    }
}

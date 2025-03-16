import { z } from "https://deno.land/x/zod@v3.24.2/mod.ts";
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
        }).default({}),
    }).strict().default({}),
    youtube_session: z.object({
        oauth_enabled: z.boolean().default(false),
        cookies: z.string().default(""),
    }).strict().default({}),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

export async function parseConfig() {
    const configFile = await Deno.readTextFile("config/local.toml");
    const rawConfig = parse(configFile);

    const validatedConfig = ConfigSchema.parse(rawConfig);
    console.log("Loaded Configuration", validatedConfig);

    return validatedConfig;
}

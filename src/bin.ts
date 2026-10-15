import { config, run } from "./main.ts";

const controller = new AbortController();
const { signal } = controller;
run(signal, config.server.port, config.server.host).catch((err) => {
    console.error("[ERROR] Failed to start server:", err);
    process.exit(1);
});

if (process.platform !== "win32") {
    process.on("SIGTERM", () => {
        console.log("Caught SIGINT, shutting down...");
        controller.abort();
        process.exit(0);
    });
}

process.on("SIGINT", () => {
    console.log("Caught SIGINT, shutting down...");
    controller.abort();
    process.exit(0);
});

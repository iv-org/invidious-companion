import { Hono } from "hono";

const metrics = new Hono();

metrics.get("/", async (c) => {
    return new Response(await c.get("metrics")?.register.metrics(), {
        headers: { "Content-Type": "text/plain" },
    });
});

export default metrics;

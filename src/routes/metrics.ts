import { Hono } from "hono";
import { metrics } from "../lib/helpers/metrics.ts";

const metrics_ = new Hono();

metrics_.get("/", async () => {
    return new Response(await metrics?.register.metrics(), {
        headers: { "Content-Type": "text/plain" },
    });
});

export default metrics_;

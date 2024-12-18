import { Hono } from "hono";
import { register } from "./index.ts";

const metrics = new Hono();
  
metrics.get("/", async () => {
  return new Response(await register.metrics(), {
    headers: { "Content-Type": "text/plain" },
  });
});

export default metrics;

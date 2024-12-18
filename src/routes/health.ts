import { Hono } from "hono";

const health = new Hono();

health.get("/", () => {
  return new Response("OK", {
	status: 200,
    headers: { "Content-Type": "text/plain" },
  });
});

export default health;
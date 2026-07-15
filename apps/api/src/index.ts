import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "@habit-tracker/db";

// Minimal API for L7 — it exists so the monorepo "boots and has data".
// Real routing, validation, and the N-layer split arrive in L8.
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/users", async (c) => {
  const data = await db.query.users.findMany({
    with: { habits: { with: { checkIns: true } } }
  });
  return c.json({ data });
});

const PORT = Number(process.env.PORT) || 3005;
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`habit-tracker api on http://localhost:${info.port}`);
});

import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";

const app = new Hono();
app.use("/*", cors());

const PASSWORD_KEY = "admin_password";
const RECORDS_KEY = "weather_records";
const DEFAULT_PASSWORD = "111";

const kv = await Deno.openKv();

async function getPassword() {
  const entry = await kv.get([PASSWORD_KEY]);
  return entry.value;
}

async function getRecords() {
  const records = [];
  const iter = kv.list({ prefix: [RECORDS_KEY] });
  for await (const entry of iter) {
    records.push(entry.value);
  }
  records.sort((a, b) => b.id - a.id);
  return records;
}

async function getNextId() {
  const entry = await kv.get(["record_counter"]);
  const next = (entry.value ?? 0) + 1;
  await kv.set(["record_counter"], next);
  return next;
}

app.post("/api/records", async (c) => {
  const body = await c.req.json();
  const id = await getNextId();
  const record = { id, ...body };
  await kv.set([RECORDS_KEY, id], record);
  return c.json({ ok: true });
});

app.get("/api/records", async (c) => {
  const records = await getRecords();
  return c.json(records);
});

app.delete("/api/records", async (c) => {
  const body = await c.req.json();
  const storedPassword = await getPassword();
  if (!storedPassword) {
    await kv.set([PASSWORD_KEY], DEFAULT_PASSWORD);
    if (body.password !== DEFAULT_PASSWORD) return c.json({ error: "密码错误" }, 403);
  } else if (body.password !== storedPassword) {
    return c.json({ error: "密码错误" }, 403);
  }

  const iter = kv.list({ prefix: [RECORDS_KEY] });
  for await (const entry of iter) {
    await kv.delete(entry.key);
  }
  return c.json({ ok: true });
});

app.post("/api/verify-password", async (c) => {
  const body = await c.req.json();
  let storedPassword = await getPassword();
  if (!storedPassword) {
    await kv.set([PASSWORD_KEY], DEFAULT_PASSWORD);
    storedPassword = DEFAULT_PASSWORD;
  }
  const ok = body.password === storedPassword;
  return c.json({ ok });
});

app.get("/api/count", async (c) => {
  let count = 0;
  const iter = kv.list({ prefix: [RECORDS_KEY] });
  for await (const _ of iter) { count++; }
  return c.json({ count });
});

// Serve static HTML
const decoder = new TextDecoder();
const htmlBytes = await Deno.readFile(new URL("./weather.html", import.meta.url));
const htmlContent = decoder.decode(htmlBytes);

app.get("*", (c) => {
  return c.html(htmlContent);
});

Deno.serve(app.fetch);

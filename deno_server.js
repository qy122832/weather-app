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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function html(content) {
  return new Response(content, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "Content-Type",
    },
  });
}

async function readBody(req) {
  try { return await req.json(); }
  catch { return {}; }
}

// Load HTML
let htmlContent;
try {
  htmlContent = await Deno.readTextFile("./weather.html");
} catch {
  htmlContent = "<html><body><h1>Weather App</h1><p>HTML file not found</p></body></html>";
}

Deno.serve(async (req, info) => {
  const url = new URL(req.url);
  const method = req.method;

  if (method === "OPTIONS") return corsPreflight();

  // Proxy geo lookup through server to avoid CORS/403 issues
  if (url.pathname === "/api/geo" && method === "GET") {
    const clientIp = info.remoteAddr?.hostname || "me";
    try {
      const geoRes = await fetch(`http://ip-api.com/json/${clientIp}?lang=zh-CN`);
      const geo = await geoRes.json();
      return json(geo);
    } catch (e) {
      return json({ status: "fail", message: e.message }, 502);
    }
  }

  // API routes
  if (url.pathname === "/api/records" && method === "POST") {
    const body = await readBody(req);
    const id = await getNextId();
    await kv.set([RECORDS_KEY, id], { id, ...body });
    return json({ ok: true });
  }

  if (url.pathname === "/api/records" && method === "GET") {
    const records = await getRecords();
    return json(records);
  }

  if (url.pathname === "/api/records" && method === "DELETE") {
    const body = await readBody(req);
    const storedPassword = await getPassword();
    if (!storedPassword) {
      await kv.set([PASSWORD_KEY], DEFAULT_PASSWORD);
      if (body.password !== DEFAULT_PASSWORD) return json({ error: "密码错误" }, 403);
    } else if (body.password !== storedPassword) {
      return json({ error: "密码错误" }, 403);
    }
    const iter = kv.list({ prefix: [RECORDS_KEY] });
    for await (const entry of iter) { await kv.delete(entry.key); }
    return json({ ok: true });
  }

  if (url.pathname === "/api/verify-password" && method === "POST") {
    const body = await readBody(req);
    let storedPassword = await getPassword();
    if (!storedPassword) {
      await kv.set([PASSWORD_KEY], DEFAULT_PASSWORD);
      storedPassword = DEFAULT_PASSWORD;
    }
    return json({ ok: body.password === storedPassword });
  }

  if (url.pathname === "/api/count" && method === "GET") {
    let count = 0;
    const iter = kv.list({ prefix: [RECORDS_KEY] });
    for await (const _ of iter) { count++; }
    return json({ count });
  }

  // Serve HTML for all other routes
  return html(htmlContent);
});

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = "111";
const DATA_PATH = path.join(__dirname, "data.json");
const HTML_PATH = path.join(__dirname, "weather.html");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { admin_password: null, records: [], counter: 0 };
  }
}

let writeLock = false;
const writeQueue = [];

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// thread-safe write via async queue
function enqueueWrite(fn) {
  return new Promise(resolve => {
    writeQueue.push({ fn, resolve });
    if (!writeLock) processQueue();
  });
}

function processQueue() {
  if (writeQueue.length === 0) { writeLock = false; return; }
  writeLock = true;
  const { fn, resolve } = writeQueue.shift();
  resolve(fn());
  // Small delay to batch writes, then continue
  setImmediate(processQueue);
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function getPassword() {
  const data = loadData();
  if (!data.admin_password) {
    data.admin_password = DEFAULT_PASSWORD;
    saveData(data);
  }
  return data.admin_password;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // --- geo proxy ---
  if (url.pathname === "/api/geo" && method === "GET") {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress?.replace(/^::ffff:/, "") || "";
    try {
      const queryUrl = clientIp && clientIp !== "127.0.0.1" && clientIp !== "::1"
        ? `http://ip-api.com/json/${clientIp}?lang=zh-CN`
        : "http://ip-api.com/json/?lang=zh-CN";
      const geoRes = await fetch(queryUrl, { headers: { "user-agent": "WeatherApp/1.0" } });
      const geo = await geoRes.json();
      return json(res, geo);
    } catch (e) {
      return json(res, { status: "fail", message: e.message }, 502);
    }
  }

  // --- records API ---
  if (url.pathname === "/api/records" && method === "POST") {
    const body = await readBody(req);
    await enqueueWrite(() => {
      const data = loadData();
      const id = ++data.counter;
      data.records.push({ id, ...body });
      // Keep max 5000 records
      if (data.records.length > 5000) data.records = data.records.slice(-5000);
      saveData(data);
    });
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/records" && method === "GET") {
    const data = loadData();
    const records = [...data.records].reverse();
    return json(res, records);
  }

  if (url.pathname === "/api/records" && method === "DELETE") {
    const body = await readBody(req);
    const pwd = getPassword();
    if (body.password !== pwd) return json(res, { error: "密码错误" }, 403);
    await enqueueWrite(() => {
      const data = loadData();
      data.records = [];
      saveData(data);
    });
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/verify-password" && method === "POST") {
    const body = await readBody(req);
    return json(res, { ok: body.password === getPassword() });
  }

  if (url.pathname === "/api/count" && method === "GET") {
    const data = loadData();
    return json(res, { count: data.records.length });
  }

  // --- serve HTML ---
  try {
    const html = fs.readFileSync(HTML_PATH, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Weather server running on port ${PORT}`);
});

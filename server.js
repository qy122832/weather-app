const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const DEFAULT_ADMIN_PASSWORD = "111";
const DB_PATH = path.join(__dirname, "weather.db");
const HTML_PATH = path.join(__dirname, "weather.html");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    ip TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    lat REAL,
    lon REAL,
    temperature REAL,
    windspeed REAL,
    winddirection REAL,
    weathercode INTEGER,
    condition TEXT
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// prepared statements
const insertRecord = db.prepare(`
  INSERT INTO records (time, ip, city, region, country, lat, lon, temperature, windspeed, winddirection, weathercode, condition)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listRecords = db.prepare("SELECT * FROM records ORDER BY id DESC");
const countRecords = db.prepare("SELECT COUNT(*) as cnt FROM records");
const deleteAll = db.prepare("DELETE FROM records");
const getConfig = db.prepare("SELECT value FROM config WHERE key = ?");
const setConfig = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");

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

function verifyPassword(inputPwd) {
  const row = getConfig.get("admin_password");
  if (!row) {
    setConfig.run("admin_password", DEFAULT_ADMIN_PASSWORD);
    return inputPwd === DEFAULT_ADMIN_PASSWORD;
  }
  return row.value === inputPwd;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // --- API routes ---

  if (url.pathname === "/api/geo" && method === "GET") {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "";
    try {
      const queryUrl = clientIp ? `http://ip-api.com/json/${clientIp}?lang=zh-CN` : "http://ip-api.com/json/";
      const geoRes = await fetch(queryUrl, { headers: { "user-agent": "WeatherApp/1.0" } });
      const geo = await geoRes.json();
      return json(res, geo);
    } catch (e) {
      return json(res, { status: "fail", message: e.message }, 502);
    }
  }

  if (url.pathname === "/api/records" && method === "POST") {
    const body = await readBody(req);
    insertRecord.run(
      body.time, body.ip, body.city, body.region, body.country,
      body.lat, body.lon, body.temperature, body.windspeed,
      body.winddirection, body.weathercode, body.condition
    );
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/records" && method === "GET") {
    const rows = listRecords.all();
    return json(res, rows);
  }

  if (url.pathname === "/api/records" && method === "DELETE") {
    const body = await readBody(req);
    if (!verifyPassword(body.password)) return json(res, { error: "密码错误" }, 403);
    deleteAll.run();
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/verify-password" && method === "POST") {
    const body = await readBody(req);
    const ok = verifyPassword(body.password);
    return json(res, { ok });
  }

  if (url.pathname === "/api/count" && method === "GET") {
    const row = countRecords.get();
    return json(res, { count: row.cnt });
  }

  // --- serve static ---
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
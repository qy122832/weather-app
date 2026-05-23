const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const DEFAULT_PASSWORD = "111";
const DATA_PATH = path.join(__dirname, "data.json");
const HTML_PATH = path.join(__dirname, "weather.html");
const CHECK_INTERVAL = 10 * 60 * 1000; // 每10分钟轮询一次天气

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { admin_password: null, records: [], counter: 0, subscriptions: [] };
  }
}

let writeLock = false;
const writeQueue = [];

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

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

async function fetchWeatherForLatLon(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  const res = await fetch(url);
  const data = await res.json();
  return data.current_weather;
}

async function sendWechatPush(sendkey, title, content) {
  const desp = encodeURIComponent(content);
  const url = `https://sctapi.ftqq.com/${sendkey}.send?title=${encodeURIComponent(title)}&desp=${desp}`;
  try {
    const res = await fetch(url);
    const result = await res.json();
    console.log(`Push sent to ${sendkey.slice(0, 6)}...: ${result.data?.error || "ok"}: ${title}`);
  } catch (e) {
    console.error(`Push failed for ${sendkey.slice(0, 6)}...: ${e.message}`);
  }
}

// Background poll: check weather for all subscriptions
async function checkAllSubscriptions() {
  const data = loadData();
  if (!data.subscriptions || data.subscriptions.length === 0) return;

  for (const sub of data.subscriptions) {
    try {
      const cw = await fetchWeatherForLatLon(sub.lat, sub.lon);
      if (!cw) continue;

      // Check if current weather matches any monitored codes
      const matched = sub.codes.includes(cw.weathercode);
      if (!matched) continue;

      const conditionNames = {
        0:"晴天",1:"大部晴朗",2:"多云",3:"阴天",45:"雾",48:"雾凇",
        51:"轻毛毛雨",53:"中毛毛雨",55:"浓毛毛雨",56:"轻冻毛毛雨",57:"浓冻毛毛雨",
        61:"小雨",63:"中雨",65:"大雨",66:"轻冻雨",67:"浓冻雨",
        71:"小雪",73:"中雪",75:"大雪",77:"雪粒",
        80:"小阵雨",81:"中阵雨",82:"大阵雨",85:"小阵雪",86:"大阵雪",
        95:"雷暴",96:"雷暴伴小冰雹",99:"雷暴伴大冰雹"
      };
      const cond = conditionNames[cw.weathercode] || `Code ${cw.weathercode}`;
      const location = `${sub.city}(${sub.lat},${sub.lon})`;

      await sendWechatPush(
        sub.sendkey,
        `天气预警: ${cond}`,
        `位置: ${location}\n` +
        `天气: ${cond}\n` +
        `温度: ${cw.temperature}°C\n` +
        `风速: ${cw.windspeed} km/h\n` +
        `风向: ${cw.winddirection}°\n` +
        `时间: ${new Date().toLocaleString("zh-CN")}`
      );
    } catch (e) {
      console.error(`Check failed for sub: ${e.message}`);
    }
  }
}

// Start background polling
setInterval(checkAllSubscriptions, CHECK_INTERVAL);
setTimeout(checkAllSubscriptions, 5000); // first check after 5s

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
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

  // --- push subscription ---
  if (url.pathname === "/api/subscription" && method === "PUT") {
    const body = await readBody(req);
    // body: { sendkey, codes: [61, 63, 65, 95, ...], lat, lon, city }
    if (!body.sendkey) return json(res, { error: "缺少 SendKey" }, 400);
    if (!body.codes || body.codes.length === 0) return json(res, { error: "请选择至少一种天气" }, 400);
    if (body.lat == null || body.lon == null) return json(res, { error: "缺少经纬度" }, 400);

    await enqueueWrite(() => {
      const data = loadData();
      if (!data.subscriptions) data.subscriptions = [];
      // Replace existing subscription for same location+sendkey, or add
      const idx = data.subscriptions.findIndex(s => s.sendkey === body.sendkey);
      if (idx >= 0) data.subscriptions[idx] = body;
      else data.subscriptions.push(body);
      saveData(data);
    });
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/subscription" && method === "GET") {
    const data = loadData();
    const sendkey = url.searchParams.get("sendkey");
    const sub = data.subscriptions?.find(s => s.sendkey === sendkey) || null;
    return json(res, sub);
  }

  if (url.pathname === "/api/subscription" && method === "DELETE") {
    const body = await readBody(req);
    if (!body.sendkey) return json(res, { error: "缺少 SendKey" }, 400);
    await enqueueWrite(() => {
      const data = loadData();
      data.subscriptions = (data.subscriptions || []).filter(s => s.sendkey !== body.sendkey);
      saveData(data);
    });
    return json(res, { ok: true });
  }

  // --- records API ---
  if (url.pathname === "/api/records" && method === "POST") {
    const body = await readBody(req);
    await enqueueWrite(() => {
      const data = loadData();
      const id = ++data.counter;
      data.records.push({ id, ...body });
      if (data.records.length > 5000) data.records = data.records.slice(-5000);
      saveData(data);
    });
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/records" && method === "GET") {
    const data = loadData();
    return json(res, [...data.records].reverse());
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

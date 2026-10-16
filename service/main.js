// src/service/main.ts
import { watchFile } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

// src/shared/normalize.ts
var ACCOUNTS_MAX = 200;
var WINDOWS_MAX = 32;
var TEXT_MAX = 400;
var isFields = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, TEXT_MAX) : null;
};
var percent = (value) => typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
var parseDisplay = (display) => {
  const match = display ? /^\s*([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)\b/.exec(display) : null;
  if (!match?.[1] || !match[2]) return null;
  return [Number(match[1].replaceAll(",", "")), Number(match[2].replaceAll(",", ""))];
};
var normalizeWindow = (raw) => {
  if (!isFields(raw)) return null;
  const name = text(raw.name);
  if (!name) return null;
  const display = text(raw.display);
  const parsed = parseDisplay(display);
  const limit = count(raw.limit) ?? parsed?.[1] ?? null;
  const amount = limit === null ? null : count(raw.amount) ?? parsed?.[0] ?? 0;
  let used = percent(raw.used);
  let remaining = percent(raw.remaining);
  if (used === null && remaining !== null) used = 100 - remaining;
  if (remaining === null && used !== null) remaining = 100 - used;
  return {
    name,
    used,
    remaining,
    resetsAt: text(raw.resetsAt),
    unlimited: raw.unlimited === true,
    display,
    amount,
    limit,
    unit: text(raw.unit),
    pool: text(raw.pool)
  };
};
var normalizeAccount = (raw) => {
  if (!isFields(raw)) return null;
  const provider = text(raw.provider);
  const name = text(raw.name) ?? provider;
  if (!provider || !name) return null;
  const windows = Array.isArray(raw.windows) ? raw.windows.slice(0, WINDOWS_MAX).map(normalizeWindow).filter((window) => window !== null) : [];
  return {
    provider,
    name,
    kind: text(raw.kind) ?? "subscription",
    user: text(raw.user),
    plan: text(raw.plan),
    windows,
    balance: text(raw.balance),
    error: text(raw.error),
    readAt: text(raw.asOf) ?? text(raw.readAt),
    lastServedAt: text(raw.lastServedAt),
    last: raw.last === true
  };
};
var normalizeAccounts = (raw) => {
  const list = Array.isArray(raw) ? raw : isFields(raw) && Array.isArray(raw.data) ? raw.data : null;
  if (!list) return null;
  return list.slice(0, ACCOUNTS_MAX).map(normalizeAccount).filter((account) => account !== null);
};

// src/service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!port || !token) {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var QUOTAS_PATH = "/v1/magpie/quotas";
var UPSTREAM_TIMEOUT_MS = 15e3;
var FRESH_MS = 15e3;
var UPSTREAM_BODY_MAX = 4 * 1024 * 1024;
var UpstreamError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var readings = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
var json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
var getQuotas = (gatewayPort) => new Promise((resolve, reject) => {
  let settled = false;
  let timer;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(value);
  };
  const req = http.get({
    host: "127.0.0.1",
    port: gatewayPort,
    path: QUOTAS_PATH,
    headers: { Accept: "application/json" }
  }, (res) => {
    const chunks = [];
    let size = 0;
    res.on("data", (chunk) => {
      size += chunk.length;
      if (size > UPSTREAM_BODY_MAX) {
        finish(new UpstreamError("bad-response", `The answer is larger than ${UPSTREAM_BODY_MAX} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => {
      if (res.statusCode !== 200) {
        finish(new UpstreamError("http", `HTTP ${res.statusCode ?? 0}`));
        return;
      }
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new UpstreamError("bad-response", "The answer is not JSON."));
      }
    });
    res.on("error", (error) => finish(new UpstreamError("unreachable", error.message)));
  });
  timer = setTimeout(() => {
    finish(new UpstreamError("timeout", `No answer within ${UPSTREAM_TIMEOUT_MS / 1e3} s.`));
    req.destroy();
  }, UPSTREAM_TIMEOUT_MS);
  req.on("error", (error) => finish(new UpstreamError("unreachable", error.message)));
});
var answer = (gatewayPort, reading, error) => ({
  port: gatewayPort,
  fetchedAt: reading?.fetchedAt ?? null,
  accounts: reading?.accounts ?? null,
  error
});
var read = (gatewayPort, force) => {
  const cached = readings.get(gatewayPort);
  if (!force && cached && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve(answer(gatewayPort, cached, null));
  }
  const running = inflight.get(gatewayPort);
  if (running) return running;
  const next = getQuotas(gatewayPort).then((raw) => {
    const accounts = normalizeAccounts(raw);
    if (!accounts) throw new UpstreamError("bad-response", "The answer has no list of accounts.");
    const reading = { at: Date.now(), fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), accounts };
    readings.set(gatewayPort, reading);
    return answer(gatewayPort, reading, null);
  }).catch((error) => {
    const failure = error instanceof UpstreamError ? error : new UpstreamError("unreachable", String(error));
    return answer(gatewayPort, readings.get(gatewayPort), { code: failure.code, message: failure.message });
  }).finally(() => {
    inflight.delete(gatewayPort);
  });
  inflight.set(gatewayPort, next);
  return next;
};
var parsePort = (value) => {
  if (value === null) return null;
  if (!/^\d{1,5}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
};
var server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET" || url.pathname !== "/quotas") {
    json(res, 404, { error: "not-found" });
    return;
  }
  const gatewayPort = parsePort(url.searchParams.get("port"));
  if (gatewayPort === null) {
    json(res, 400, { error: "bad-port" });
    return;
  }
  void read(gatewayPort, url.searchParams.get("force") === "1").then((body) => json(res, 200, body));
});
server.listen(port, "127.0.0.1");
var RESTART_GRACE_MS = 3e3;
watchFile(fileURLToPath(import.meta.url), { interval: 2e3, persistent: false }, (current, previous) => {
  if (current.mtimeMs === previous.mtimeMs) return;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), RESTART_GRACE_MS).unref();
});

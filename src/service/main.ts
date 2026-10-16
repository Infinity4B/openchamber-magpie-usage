// Runs under the app's Node runtime, on 127.0.0.1, only reachable through the host proxy.
// The extension page's sandbox can only reach https origins, so this process reads magpie's
// gateway on loopback for it. Read-only: it only ever sends GET /v1/magpie/quotas.
import { watchFile } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { normalizeAccounts } from '../shared/normalize.ts';
import type { QuotaAccount, QuotaAnswer, QuotaErrorCode } from '../shared/types.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!port || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}

const QUOTAS_PATH = '/v1/magpie/quotas';
// magpie may ask every vendor before it answers; stay under the host's 20 s request limit.
const UPSTREAM_TIMEOUT_MS = 15_000;
// Work Status sections in several windows all poll; they share one reading.
const FRESH_MS = 15_000;
const UPSTREAM_BODY_MAX = 4 * 1024 * 1024;

type Reading = { at: number; fetchedAt: string; accounts: QuotaAccount[] };

class UpstreamError extends Error {
  constructor(readonly code: QuotaErrorCode, message: string) {
    super(message);
  }
}

const readings = new Map<number, Reading>();
const inflight = new Map<number, Promise<QuotaAnswer>>();

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const getQuotas = (gatewayPort: number): Promise<unknown> => new Promise((resolve, reject) => {
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  const finish = (error: UpstreamError | null, value?: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error); else resolve(value);
  };
  const req = http.get({
    host: '127.0.0.1',
    port: gatewayPort,
    path: QUOTAS_PATH,
    headers: { Accept: 'application/json' },
  }, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > UPSTREAM_BODY_MAX) {
        finish(new UpstreamError('bad-response', `The answer is larger than ${UPSTREAM_BODY_MAX} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        finish(new UpstreamError('http', `HTTP ${res.statusCode ?? 0}`));
        return;
      }
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(new UpstreamError('bad-response', 'The answer is not JSON.'));
      }
    });
    res.on('error', (error) => finish(new UpstreamError('unreachable', error.message)));
  });
  timer = setTimeout(() => {
    finish(new UpstreamError('timeout', `No answer within ${UPSTREAM_TIMEOUT_MS / 1000} s.`));
    req.destroy();
  }, UPSTREAM_TIMEOUT_MS);
  req.on('error', (error) => finish(new UpstreamError('unreachable', error.message)));
});

const answer = (gatewayPort: number, reading: Reading | undefined, error: QuotaAnswer['error']): QuotaAnswer => ({
  port: gatewayPort,
  fetchedAt: reading?.fetchedAt ?? null,
  accounts: reading?.accounts ?? null,
  error,
});

const read = (gatewayPort: number, force: boolean): Promise<QuotaAnswer> => {
  const cached = readings.get(gatewayPort);
  if (!force && cached && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve(answer(gatewayPort, cached, null));
  }
  const running = inflight.get(gatewayPort);
  if (running) return running;
  const next = getQuotas(gatewayPort).then((raw) => {
    const accounts = normalizeAccounts(raw);
    if (!accounts) throw new UpstreamError('bad-response', 'The answer has no list of accounts.');
    const reading = { at: Date.now(), fetchedAt: new Date().toISOString(), accounts };
    readings.set(gatewayPort, reading);
    return answer(gatewayPort, reading, null);
  }).catch((error: unknown) => {
    const failure = error instanceof UpstreamError ? error : new UpstreamError('unreachable', String(error));
    return answer(gatewayPort, readings.get(gatewayPort), { code: failure.code, message: failure.message });
  }).finally(() => {
    inflight.delete(gatewayPort);
  });
  inflight.set(gatewayPort, next);
  return next;
};

const parsePort = (value: string | null): number | null => {
  if (value === null) return null;
  if (!/^\d{1,5}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
};

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/quotas') {
    json(res, 404, { error: 'not-found' });
    return;
  }
  const gatewayPort = parsePort(url.searchParams.get('port'));
  if (gatewayPort === null) {
    json(res, 400, { error: 'bad-port' });
    return;
  }
  void read(gatewayPort, url.searchParams.get('force') === '1').then((body) => json(res, 200, body));
});

server.listen(port, '127.0.0.1');

// Settings → Extensions has no reload for a folder install, and the host keeps a
// running service until the extension is paused. When this file is rebuilt, finish
// what is in flight and exit: the host starts the new build on the next request.
const RESTART_GRACE_MS = 3_000;
watchFile(fileURLToPath(import.meta.url), { interval: 2_000, persistent: false }, (current, previous) => {
  if (current.mtimeMs === previous.mtimeMs) return;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), RESTART_GRACE_MS).unref();
});

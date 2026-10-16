// Runs the built service the way OpenChamber does: its own process, a loopback port
// and a bearer token in the environment. A fake magpie gateway stands in for the app.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdtemp, rm, utimes } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { gatewayAnswer } from './fixtures.ts';

const entry = path.resolve(import.meta.dirname, '../service/main.js');
const token = 'test-token';

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    server.close(() => resolve(port));
  });
});

type Reply = { status: number; body: string };
let reply: Reply = { status: 200, body: JSON.stringify(gatewayAnswer) };
let gatewayHits = 0;
const gateway = http.createServer((req, res) => {
  gatewayHits += 1;
  if (req.url !== '/v1/magpie/quotas') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(reply.status, { 'Content-Type': 'application/json' });
  res.end(reply.body);
});

let gatewayPort = 0;
let servicePort = 0;
let child: ChildProcess;

const call = async (pathname: string, auth = true): Promise<{ status: number; body: any }> => {
  const response = await fetch(`http://127.0.0.1:${servicePort}${pathname}`, {
    headers: auth ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  gatewayPort = (gateway.address() as AddressInfo).port;
  servicePort = await freePort();
  child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, OPENCHAMBER_SERVICE_PORT: String(servicePort), OPENCHAMBER_SERVICE_TOKEN: token },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // The host polls /health the same way before it marks the service ready.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await call('/health')).status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The service never became ready.');
});

after(async () => {
  child.kill();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

test('refuses requests without the host token', async () => {
  assert.equal((await call('/health', false)).status, 401);
  assert.equal((await call(`/quotas?port=${gatewayPort}`, false)).status, 401);
});

test('answers only GET /quotas with a valid port', async () => {
  assert.equal((await call('/other')).status, 404);
  assert.equal((await call('/quotas')).status, 400);
  assert.equal((await call('/quotas?port=0')).status, 400);
  assert.equal((await call('/quotas?port=70000')).status, 400);
  assert.equal((await call('/quotas?port=12ab')).status, 400);
});

test('reads and normalizes the gateway, then shares the reading for a moment', async () => {
  const hitsBefore = gatewayHits;
  const first = await call(`/quotas?port=${gatewayPort}&force=1`);
  assert.equal(first.status, 200);
  assert.equal(first.body.port, gatewayPort);
  assert.equal(first.body.error, null);
  assert.equal(first.body.accounts.length, 5);
  assert.equal(first.body.accounts[0].windows[1].remaining, 54);
  assert.ok(!Number.isNaN(Date.parse(first.body.fetchedAt)));

  const second = await call(`/quotas?port=${gatewayPort}`);
  assert.deepEqual(second.body, first.body);
  assert.equal(gatewayHits, hitsBefore + 1);

  await call(`/quotas?port=${gatewayPort}&force=1`);
  assert.equal(gatewayHits, hitsBefore + 2);
});

test('keeps the last reading when magpie answers an error', async () => {
  const good = await call(`/quotas?port=${gatewayPort}&force=1`);
  reply = { status: 500, body: '{"error":"boom"}' };
  try {
    const failed = await call(`/quotas?port=${gatewayPort}&force=1`);
    assert.equal(failed.status, 200);
    assert.deepEqual(failed.body.error, { code: 'http', message: 'HTTP 500' });
    assert.equal(failed.body.fetchedAt, good.body.fetchedAt);
    assert.equal(failed.body.accounts.length, 5);
  } finally {
    reply = { status: 200, body: JSON.stringify(gatewayAnswer) };
  }
});

test('reports an answer that is not a quota list', async () => {
  reply = { status: 200, body: 'not json' };
  try {
    const notJson = await call(`/quotas?port=${gatewayPort}&force=1`);
    assert.equal(notJson.body.error.code, 'bad-response');
    reply = { status: 200, body: '{"object":"list"}' };
    const noList = await call(`/quotas?port=${gatewayPort}&force=1`);
    assert.equal(noList.body.error.code, 'bad-response');
  } finally {
    reply = { status: 200, body: JSON.stringify(gatewayAnswer) };
  }
});

test('exits once its file is rebuilt, so the host starts the new build', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'magpie-usage-'));
  const copy = path.join(dir, 'main.js');
  await copyFile(entry, copy);
  const copyPort = await freePort();
  const copyChild = spawn(process.execPath, [copy], {
    env: { PATH: process.env.PATH, OPENCHAMBER_SERVICE_PORT: String(copyPort), OPENCHAMBER_SERVICE_TOKEN: token },
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const later = new Date(Date.now() + 5_000);
    await utimes(copy, later, later);
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The service kept running after its file changed.')), 8_000);
      copyChild.once('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.equal(code, 0);
  } finally {
    copyChild.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test('reports a gateway that is not running', async () => {
  const closedPort = await freePort();
  const answer = await call(`/quotas?port=${closedPort}`);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.port, closedPort);
  assert.equal(answer.body.error.code, 'unreachable');
  assert.equal(answer.body.accounts, null);
  assert.equal(answer.body.fetchedAt, null);
});

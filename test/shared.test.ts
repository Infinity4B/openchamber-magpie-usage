import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCompactDuration, formatMoment, formatPercent, localizeWindowName, stringsFor } from '../src/shared/i18n.ts';
import { normalizeAccounts, readQuotaAnswer } from '../src/shared/normalize.ts';
import type { QuotaWindow } from '../src/shared/types.ts';
import {
  accountKey,
  orderAccounts,
  orderWindows,
  sessionProvider,
  toneOf,
  windowKey,
} from '../src/shared/usage.ts';
import { describeWindow } from '../src/shared/view.ts';
import { gatewayAnswer } from './fixtures.ts';

const quotaWindow = (fields: Partial<QuotaWindow>): QuotaWindow => ({
  name: 'w', used: null, remaining: null, resetsAt: null, unlimited: false, display: null, amount: null, limit: null, unit: null, pool: null, ...fields,
});

test('normalizes the gateway answer and a bare CLI list alike', () => {
  const fromGateway = normalizeAccounts(gatewayAnswer);
  const fromCli = normalizeAccounts(gatewayAnswer.data);
  assert.ok(fromGateway);
  assert.deepEqual(fromGateway, fromCli);
  assert.equal(fromGateway.length, 5);

  const [claude, workbuddy, , deepseek, codex] = fromGateway;
  assert.equal(claude?.last, true);
  assert.equal(claude?.windows[0]?.remaining, 87);
  assert.equal(claude?.windows[0]?.resetsAt, '2026-10-16T20:00:00+08:00');
  assert.equal(workbuddy?.plan, 'Free');
  assert.equal(workbuddy?.windows[0]?.display, '10.34 / 3069');
  assert.equal(workbuddy?.windows[0]?.unit, 'credits');
  assert.deepEqual([workbuddy?.windows[0]?.amount, workbuddy?.windows[0]?.limit], [10.34, 3069]);
  assert.deepEqual([claude?.windows[0]?.amount, claude?.windows[0]?.limit], [null, null]);
  assert.equal(deepseek?.balance, '¥37.22');
  assert.deepEqual(deepseek?.windows, []);
  assert.equal(codex?.error, 'token expired; sign in again in magpie');
});

test('rejects answers that are not a list and drops malformed entries', () => {
  assert.equal(normalizeAccounts({ object: 'list' }), null);
  assert.equal(normalizeAccounts('nope'), null);
  const accounts = normalizeAccounts([
    null,
    { name: 'No provider' },
    { provider: 'x', windows: [{ used: 5 }, { name: 'Weekly', used: 140 }] },
  ]);
  assert.equal(accounts?.length, 1);
  // A missing name falls back to the provider; out-of-range percentages are clamped.
  assert.equal(accounts?.[0]?.name, 'x');
  assert.deepEqual(accounts?.[0]?.windows.map((window) => [window.name, window.used, window.remaining]), [['Weekly', 100, 0]]);
});

test('derives the missing percentage of a window', () => {
  const [account] = normalizeAccounts([{ provider: 'p', windows: [{ name: 'a', remaining: 30 }, { name: 'b', used: 25 }] }]) ?? [];
  assert.deepEqual(account?.windows.map((window) => [window.used, window.remaining]), [[70, 30], [25, 75]]);
});

test('reads the service answer at the frame boundary', () => {
  const accounts = normalizeAccounts(gatewayAnswer);
  const answer = readQuotaAnswer({ port: 3425, fetchedAt: '2026-10-16T08:30:00.000Z', accounts, error: null });
  assert.equal(answer?.accounts?.length, 5);
  assert.deepEqual(
    readQuotaAnswer({ port: 3425, fetchedAt: null, accounts: null, error: { code: 'unreachable', message: 'ECONNREFUSED' } }),
    { port: 3425, fetchedAt: null, accounts: null, error: { code: 'unreachable', message: 'ECONNREFUSED' } },
  );
  assert.equal(readQuotaAnswer({ port: '3425', accounts: null, error: null }), null);
  assert.equal(readQuotaAnswer({ port: 3425, accounts: null, error: { code: 'weird', message: '' } }), null);
});

test('finds the magpie provider behind the session model and puts it first', () => {
  assert.equal(sessionProvider({ id: 's', title: 't', busy: false, model: 'magpie/claude/claude-opus-5-5' }), 'claude');
  assert.equal(sessionProvider({ id: 's', title: 't', busy: false, model: 'magpie/workbuddy-ai/deepseek-v4.1-flash' }), 'workbuddy-ai');
  assert.equal(sessionProvider({ id: 's', title: 't', busy: false, model: 'anthropic/claude-sonnet-4' }), null);
  assert.equal(sessionProvider({ id: 's', title: 't', busy: false, model: 'openrouter/anthropic/claude' }), null);
  assert.equal(sessionProvider(null), null);

  const accounts = normalizeAccounts(gatewayAnswer) ?? [];
  assert.deepEqual(orderAccounts(accounts, 'antigravity').map((account) => account.provider), ['antigravity', 'claude', 'workbuddy', 'deepseek', 'codex']);
  assert.equal(orderAccounts(accounts, null), accounts);
});

test('colours windows by how much is used, like the built-in section', () => {
  assert.equal(toneOf(quotaWindow({ used: 49, remaining: 51 })), 'default');
  assert.equal(toneOf(quotaWindow({ used: 50, remaining: 50 })), 'warning');
  assert.equal(toneOf(quotaWindow({ used: 80, remaining: 20 })), 'error');
  assert.equal(toneOf(quotaWindow({ unlimited: true })), 'default');
  assert.equal(toneOf(quotaWindow({ display: '1 / 2' })), 'default');
});

test('describes a window in either display mode', () => {
  const now = new Date(2026, 9, 16, 17, 0);
  const window = quotaWindow({ name: '5 hours', used: 72, remaining: 28, resetsAt: new Date(2026, 9, 16, 19, 59).toISOString() });
  const left = describeWindow(window, 'remaining', stringsFor('zh-CN'), 'zh-CN', now);
  assert.deepEqual(left, { label: '5 小时', value: '28%', detail: null, tone: 'warning', resets: '2h59m', resetsAt: '19:59' });
  const used = describeWindow(window, 'used', stringsFor('en'), 'en', now);
  assert.equal(used.value, '72%');
  assert.equal(used.label, '5 hours');
  assert.equal(used.resets, '2h59m');
});

test('describes windows without a percentage and past resets', () => {
  const en = stringsFor('en');
  const now = new Date('2026-10-16T09:00:00Z');
  assert.equal(describeWindow(quotaWindow({ unlimited: true }), 'remaining', en, 'en', now).value, 'Unlimited');
  assert.equal(describeWindow(quotaWindow({ display: '1.2k / 3k' }), 'remaining', en, 'en', now).value, '1.2k / 3k');
  assert.equal(describeWindow(quotaWindow({ remaining: 0, used: 100, resetsAt: '2026-10-16T08:00:00Z' }), 'remaining', en, 'en', now).resets, null);
});

test('writes a reset as a compact span', () => {
  const minute = 60_000;
  assert.equal(formatCompactDuration(3 * 60 * minute + 58 * minute), '3h58m');
  assert.equal(formatCompactDuration(5 * 1440 * minute + 6 * 60 * minute), '5d6h');
  assert.equal(formatCompactDuration(2 * 1440 * minute), '2d');
  assert.equal(formatCompactDuration(45 * minute), '45m');
  assert.equal(formatCompactDuration(10 * 60 * minute), '10h');
  assert.equal(formatCompactDuration(0), '1m');
});

test('writes reset times the way the built-in section does', () => {
  const now = new Date(2026, 9, 16, 17, 0);
  assert.equal(formatMoment(new Date(2026, 9, 16, 19, 59), 'zh-CN', now), '19:59');
  assert.equal(formatMoment(new Date(2026, 9, 18, 11, 59), 'zh-CN', now), '10月18日周日 11:59');
});

test('formats percentages without claiming full or empty too early', () => {
  assert.equal(formatPercent(87), '87%');
  assert.equal(formatPercent(99.663), '99.7%');
  assert.equal(formatPercent(0.337), '0.3%');
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(0), '0%');
});

test('translates common window names for Chinese only', () => {
  assert.equal(localizeWindowName('5 hours', 'zh-CN'), '5 小时');
  assert.equal(localizeWindowName('Gemini · 7 days', 'zh-CN'), 'Gemini · 7 天');
  assert.equal(localizeWindowName('Weekly', 'zh-TW'), '每周');
  assert.equal(localizeWindowName('Premium requests', 'zh-CN'), 'Premium requests');
  assert.equal(localizeWindowName('5 hours', 'en-US'), '5 hours');
});

test('reads counts from the fields or the display text', () => {
  const [account] = normalizeAccounts([{ provider: 'p', windows: [
    { name: 'Credits', used: 0, remaining: 100, display: '0 / 350', limit: 350, unit: 'credits' },
    { name: 'Requests', used: 40, remaining: 60, display: '1,200 / 3,000' },
  ] }]) ?? [];
  assert.deepEqual(account?.windows.map((window) => [window.amount, window.limit]), [[0, 350], [1200, 3000]]);
});

test('shows counted windows as numbers in either mode', () => {
  const credits = quotaWindow({ name: 'Credits', used: 0.337, remaining: 99.663, display: '10.34 / 3069', amount: 10.34, limit: 3069, unit: 'credits' });
  const zh = stringsFor('zh-CN');
  const left = describeWindow(credits, 'remaining', zh, 'zh-CN');
  assert.equal(left.label, '积分');
  assert.equal(left.value, '3,058.66 / 3,069');
  assert.equal(left.detail, '剩余 99.7%');
  assert.equal(describeWindow(credits, 'used', zh, 'zh-CN').value, '10.34 / 3,069');
  assert.equal(describeWindow(quotaWindow({ used: 0, remaining: 100, amount: 0, limit: 350 }), 'remaining', zh, 'zh-CN').value, '350 / 350');
});

test('keeps the natural order until the user drags something', () => {
  const accounts = normalizeAccounts(gatewayAnswer) ?? [];
  const providers = (list: ReturnType<typeof orderAccounts>) => list.map((account) => account.provider);

  // The session's provider leads; the rest keep magpie's order.
  assert.deepEqual(providers(orderAccounts(accounts, 'claude')), ['claude', 'workbuddy', 'antigravity', 'deepseek', 'codex']);
  assert.deepEqual(providers(orderAccounts(accounts, null)), accounts.map((account) => account.provider));

  // A saved order wins, and anything not placed keeps its natural place after it.
  const dragged = [accountKey(accounts[3]!), accountKey(accounts[0]!)];
  assert.deepEqual(providers(orderAccounts(accounts, 'claude', dragged)), ['deepseek', 'claude', 'workbuddy', 'antigravity', 'codex']);
});

test('orders windows by what the user dragged, and by length otherwise', () => {
  const [claude, , antigravity] = normalizeAccounts(gatewayAnswer) ?? [];
  const names = (list: ReturnType<typeof orderWindows>) => list.map((window) => window.name);

  // Natural: shortest first, pools kept together.
  assert.deepEqual(names(orderWindows(claude!, claude!.windows)), ['5 hours', '7 days']);
  assert.deepEqual(names(orderWindows(antigravity!, antigravity!.windows)), ['Gemini · 5 hours', 'Gemini · 7 days']);

  const [gemini7, gemini5] = antigravity!.windows;
  const dragged = [windowKey(antigravity!, gemini5!), windowKey(antigravity!, gemini7!)];
  assert.deepEqual(names(orderWindows(antigravity!, antigravity!.windows, dragged)), ['Gemini · 5 hours', 'Gemini · 7 days']);
  const reversed = [windowKey(antigravity!, gemini7!), windowKey(antigravity!, gemini5!)];
  assert.deepEqual(names(orderWindows(antigravity!, antigravity!.windows, reversed)), ['Gemini · 7 days', 'Gemini · 5 hours']);

  // A window that was never dragged keeps its natural place after the placed ones.
  const onlySecond = [windowKey(antigravity!, gemini5!)];
  assert.deepEqual(names(orderWindows(antigravity!, antigravity!.windows, onlySecond)), ['Gemini · 5 hours', 'Gemini · 7 days']);
});


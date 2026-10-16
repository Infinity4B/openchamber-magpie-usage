import { QUOTA_ERROR_CODES, type QuotaAccount, type QuotaAnswer, type QuotaErrorCode, type QuotaWindow } from './types.ts';

// Upper bounds on what one answer may carry, so a broken gateway cannot flood the section.
const ACCOUNTS_MAX = 200;
const WINDOWS_MAX = 32;
const TEXT_MAX = 400;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, TEXT_MAX) : null;
};

const percent = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
);

const count = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

/** "10.34 / 3069" → [10.34, 3069], for vendors that send the count only as text. */
const parseDisplay = (display: string | null): [number, number] | null => {
  const match = display ? /^\s*([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)\b/.exec(display) : null;
  if (!match?.[1] || !match[2]) return null;
  return [Number(match[1].replaceAll(',', '')), Number(match[2].replaceAll(',', ''))];
};

const normalizeWindow = (raw: unknown): QuotaWindow | null => {
  if (!isFields(raw)) return null;
  const name = text(raw.name);
  if (!name) return null;
  const display = text(raw.display);
  const parsed = parseDisplay(display);
  const limit = count(raw.limit) ?? parsed?.[1] ?? null;
  // magpie leaves `amount` out when nothing is spent yet ("0 / 350").
  const amount = limit === null ? null : count(raw.amount) ?? parsed?.[0] ?? 0;
  let used = percent(raw.used);
  let remaining = percent(raw.remaining);
  // magpie sends both; derive the missing one if a vendor ever sends only one.
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
    pool: text(raw.pool),
  };
};

const normalizeAccount = (raw: unknown): QuotaAccount | null => {
  if (!isFields(raw)) return null;
  const provider = text(raw.provider);
  const name = text(raw.name) ?? provider;
  if (!provider || !name) return null;
  const windows = Array.isArray(raw.windows)
    ? raw.windows.slice(0, WINDOWS_MAX).map(normalizeWindow).filter((window): window is QuotaWindow => window !== null)
    : [];
  return {
    provider,
    name,
    kind: text(raw.kind) ?? 'subscription',
    user: text(raw.user),
    plan: text(raw.plan),
    windows,
    balance: text(raw.balance),
    error: text(raw.error),
    readAt: text(raw.asOf) ?? text(raw.readAt),
    lastServedAt: text(raw.lastServedAt),
    last: raw.last === true,
  };
};

/** The gateway answers `{ data: [...] }`, `magpie quota --json` a bare list. `null` for anything else. */
export const normalizeAccounts = (raw: unknown): QuotaAccount[] | null => {
  const list = Array.isArray(raw) ? raw : isFields(raw) && Array.isArray(raw.data) ? raw.data : null;
  if (!list) return null;
  return list.slice(0, ACCOUNTS_MAX)
    .map(normalizeAccount)
    .filter((account): account is QuotaAccount => account !== null);
};

const isErrorCode = (value: unknown): value is QuotaErrorCode => (
  typeof value === 'string' && (QUOTA_ERROR_CODES as readonly string[]).includes(value)
);

/** Parse the service's answer at the frame boundary. `null` when it is not one. */
export const readQuotaAnswer = (raw: unknown): QuotaAnswer | null => {
  if (!isFields(raw)) return null;
  const port = raw.port;
  if (typeof port !== 'number' || !Number.isInteger(port)) return null;
  const accounts = raw.accounts === null ? null : normalizeAccounts(raw.accounts);
  if (raw.accounts !== null && accounts === null) return null;
  let error: QuotaAnswer['error'] = null;
  if (isFields(raw.error)) {
    if (!isErrorCode(raw.error.code)) return null;
    error = { code: raw.error.code, message: text(raw.error.message) ?? '' };
  }
  return { port, fetchedAt: text(raw.fetchedAt), accounts, error };
};

import { HostRequestError, type HostClient, type SessionSnapshot } from '@openchamber/sdk';

import { readQuotaAnswer } from './normalize.ts';
import type { QuotaAccount, QuotaAnswer, QuotaWindow } from './types.ts';

export type DisplayMode = 'remaining' | 'used';
/**
 * `hidden` holds `accountKey` and `windowKey` values left out of the Work Status
 * section; `accountOrder` and `windowOrder` hold the same keys in the order the
 * user dragged them into. A key that is not in an order list falls in after the
 * ones that are, so a new account or window shows up without being dragged.
 */
export type Settings = {
  mode: DisplayMode;
  port: number;
  hidden: string[];
  accountOrder: string[];
  windowOrder: string[];
};

const DEFAULT_SETTINGS: Settings = { mode: 'remaining', port: 3425, hidden: [], accountOrder: [], windowOrder: [] };
const SETTINGS_KEY = 'settings';
const HIDDEN_MAX = 500;
const ORDER_MAX = 500;

/** Asking the local service failed, as opposed to the service failing to read magpie. */
export type Failure = { code: 'no-service' | 'disabled' | 'service-failed' | 'other'; message: string };

export type UsageState = {
  settings: Settings;
  /** The service's last answer. Its own `error` says whether magpie could be read. */
  answer: QuotaAnswer | null;
  failure: Failure | null;
  loading: boolean;
  session: SessionSnapshot | null;
};

const POLL_MS = 60_000;
// Frames cannot message each other, so a change made in the settings panel
// reaches the Work Status section on its next read of extension storage.
const SETTINGS_MS = 5_000;
// Reset times run down between polls, so a duration is rendered from the clock each time.
const REPAINT_MS = 10_000;
// Give magpie a moment to record the request a finished turn just made.
const AFTER_TURN_MS = 2_000;

export const isValidPort = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 65535;

const keys = (value: unknown, max: number): string[] => (
  Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string').slice(0, max) : []
);

const readSettings = (value: unknown, fallback: Settings): Settings => {
  if (value === undefined) return DEFAULT_SETTINGS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const fields = value as Record<string, unknown>;
  return {
    mode: fields.mode === 'used' ? 'used' : 'remaining',
    port: typeof fields.port === 'number' && isValidPort(fields.port) ? fields.port : DEFAULT_SETTINGS.port,
    hidden: keys(fields.hidden, HIDDEN_MAX),
    accountOrder: keys(fields.accountOrder, ORDER_MAX),
    windowOrder: keys(fields.windowOrder, ORDER_MAX),
  };
};

const sameSettings = (a: Settings, b: Settings): boolean => (
  a.mode === b.mode && a.port === b.port
  && a.hidden.join('\n') === b.hidden.join('\n')
  && a.accountOrder.join('\n') === b.accountOrder.join('\n')
  && a.windowOrder.join('\n') === b.windowOrder.join('\n')
);

const toFailure = (error: unknown): Failure => {
  if (error instanceof HostRequestError) {
    if (error.code === 'NO_SERVICE') return { code: 'no-service', message: error.message };
    if (error.code === 'DISABLED') return { code: 'disabled', message: error.message };
    if (error.code === 'SERVICE_FAILED') return { code: 'service-failed', message: error.message };
    return { code: 'other', message: `${error.code}: ${error.message}` };
  }
  return { code: 'other', message: error instanceof Error ? error.message : String(error) };
};

const askService = async (host: HostClient, port: number, force: boolean): Promise<QuotaAnswer> => {
  const query: Record<string, string> = { port: String(port) };
  if (force) query.force = '1';
  const result = await host.serviceRequest({ method: 'GET', path: '/quotas', query });
  if (result.status !== 200) throw new Error(`The local service answered HTTP ${result.status}.`);
  let body: unknown;
  try {
    body = JSON.parse(result.body);
  } catch {
    throw new Error('The local service answered with something unexpected.');
  }
  const answer = readQuotaAnswer(body);
  if (!answer) throw new Error('The local service answered with something unexpected.');
  return answer;
};

/**
 * Settings, polling and the session the user works in, shared by the settings
 * panel and the Work Status section. Both read settings from extension storage
 * every few seconds, so a change made in one shows up in the other.
 */
export const createUsage = (host: HostClient, onChange: (state: UsageState) => void) => {
  let state: UsageState = { settings: DEFAULT_SETTINGS, answer: null, failure: null, loading: false, session: null };
  let generation = 0;
  let started = false;
  let lastPhase: string | null = null;

  const update = (patch: Partial<UsageState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const loadSettings = async (): Promise<Settings> => {
    try {
      return readSettings(await host.storage.get(SETTINGS_KEY), state.settings);
    } catch {
      return state.settings;
    }
  };

  /** `force` skips the service's short cache; `quiet` keeps the Refresh button still for background reads. */
  const refresh = async ({ force = false, quiet = false }: { force?: boolean; quiet?: boolean } = {}): Promise<void> => {
    const current = ++generation;
    if (!quiet) update({ loading: true });
    const settings = await loadSettings();
    if (current !== generation) return;
    try {
      const answer = await askService(host, settings.port, force);
      if (current !== generation) return;
      update({ settings, answer, failure: null, loading: false });
    } catch (error) {
      if (current !== generation) return;
      update({ settings, failure: toFailure(error), loading: false });
    }
  };

  const syncSettings = async () => {
    const settings = await loadSettings();
    if (settings.port !== state.settings.port) {
      void refresh({ force: true, quiet: true });
      return;
    }
    if (!sameSettings(settings, state.settings)) update({ settings });
  };

  const saveSettings = async (next: Settings): Promise<void> => {
    const portChanged = next.port !== state.settings.port;
    update({ settings: next });
    await host.storage.set(SETTINGS_KEY, next);
    if (portChanged) void refresh({ force: true });
  };

  const start = () => {
    if (started) return;
    started = true;
    host.onSession((session) => update({ session }));
    host.onSessionLifecycle((event) => {
      const finished = lastPhase === 'started' && event.phase === 'completed';
      lastPhase = event.phase;
      if (finished) setTimeout(() => void refresh({ force: true, quiet: true }), AFTER_TURN_MS);
    });
    setInterval(() => void refresh({ quiet: true }), POLL_MS);
    setInterval(() => void syncSettings(), SETTINGS_MS);
    setInterval(() => update({}), REPAINT_MS);
    void refresh();
  };

  return {
    get state() {
      return state;
    },
    start,
    refresh,
    saveSettings,
  };
};

/** Names an account across readings: magpie sends no id, but a provider and its signed-in user stay put. */
export const accountKey = (account: QuotaAccount): string => `account\u0000${account.provider}\u0000${account.user ?? ''}`;

export const windowKey = (account: QuotaAccount, window: QuotaWindow): string => (
  `window\u0000${account.provider}\u0000${account.user ?? ''}\u0000${window.name}`
);

/** "magpie/claude/claude-opus-5-5" → "claude": the magpie provider behind the session's model. */
export const sessionProvider = (session: SessionSnapshot | null): string | null => {
  const parts = session?.model?.split('/') ?? [];
  if (parts.length < 3 || parts[0]?.toLowerCase() !== 'magpie') return null;
  return parts[1] || null;
};

/**
 * Puts the items in the user's saved order. Anything the user has not dragged
 * yet keeps its natural place, after the ones that are placed, so a new account
 * or window shows up at the end instead of jumping to the front.
 */
const applyOrder = <T,>(items: T[], order: string[], keyOf: (item: T) => string): T[] => {
  if (order.length === 0) return items;
  const rank = new Map(order.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
};

/**
 * The accounts in the order the user dragged them into. Until they drag one, the
 * account behind the session's model leads and the rest keep magpie's order.
 */
export const orderAccounts = (accounts: QuotaAccount[], provider: string | null, order: string[] = []): QuotaAccount[] => {
  const natural = provider
    ? [...accounts.filter((account) => account.provider === provider), ...accounts.filter((account) => account.provider !== provider)]
    : accounts;
  return applyOrder(natural, order, accountKey);
};

const MINUTES: Record<string, number> = { minute: 1, hour: 60, day: 1440, week: 10_080, month: 43_200 };
const NAMED_MINUTES: Record<string, number> = { hourly: 60, daily: 1440, weekly: 10_080, monthly: 43_200 };

/** "Gemini · 5 hours" → 300; `null` for a window that is not a span of time ("Credits"). */
const windowMinutes = (name: string): number | null => {
  const last = (name.split(' · ').pop() ?? '').trim().toLowerCase();
  const span = /^(\d+)\s*(minute|hour|day|week|month)s?$/.exec(last);
  if (span?.[1] && span[2]) return Number(span[1]) * (MINUTES[span[2]] ?? 0);
  return NAMED_MINUTES[last] ?? null;
};

/**
 * The windows of one account in the order the user dragged them into. Until they
 * drag one, the shortest comes first, since it runs out first ("5 hours" before
 * "7 days"); windows sharing a pool stay together in magpie's order, and ones
 * that are not a span of time keep their place after the timed ones.
 */
export const orderWindows = (account: QuotaAccount, windows: QuotaWindow[], order: string[] = []): QuotaWindow[] => {
  const pools: Array<string | null> = [];
  for (const window of windows) if (!pools.includes(window.pool)) pools.push(window.pool);
  const natural = windows
    .map((window, index) => ({ window, index, pool: pools.indexOf(window.pool), minutes: windowMinutes(window.name) ?? Infinity }))
    .sort((a, b) => a.pool - b.pool || a.minutes - b.minutes || a.index - b.index)
    .map(({ window }) => window);
  return applyOrder(natural, order, (window) => windowKey(account, window));
};

export type Tone = 'default' | 'warning' | 'error';

/** The built-in Usage section's colours: half used turns amber, four fifths red, whichever number is shown. */
export const toneOf = (window: QuotaWindow): Tone => {
  if (window.unlimited || window.used === null) return 'default';
  if (window.used >= 80) return 'error';
  if (window.used >= 50) return 'warning';
  return 'default';
};

/** The number the display mode asks for, 0–100, or `null` when the window has none. */
export const shownPercent = (window: QuotaWindow, mode: DisplayMode): number | null => (
  mode === 'used' ? window.used : window.remaining
);

import { connectHost, type GuestStatusControl } from '@openchamber/sdk';
import { applyHostReady, mountButton, mountTextField } from '@openchamber/sdk/ui';

import { stringsFor } from '../shared/i18n.ts';
import type { QuotaAccount } from '../shared/types.ts';
import {
  accountKey,
  createUsage,
  isValidPort,
  orderAccounts,
  orderWindows,
  sessionProvider,
  windowKey,
  type Settings,
  type UsageState,
} from '../shared/usage.ts';
import { answerNotice, describeWindow, el, failureNotice, windowCount } from '../shared/view.ts';

// Rows follow the built-in Usage section: a provider sub-heading, then one line per
// window with its reset time and a right-aligned number. Plain text, no bars.
const STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  /* The host stops growing the frame at its maximum; past that the page scrolls. */
  html, body { margin: 0; height: 100%; overflow-x: hidden; overflow-y: auto; background: transparent; }
  body { color: var(--oc-muted); font: 13px/1.4 var(--oc-font); }
  [hidden] { display: none !important; }
  .mu-row { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 4px; }
  .mu-label { display: inline-flex; align-items: baseline; gap: 6px; flex: 1; min-width: 0; }
  .mu-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mu-heading .mu-text { color: var(--oc-fg); font-weight: 600; }
  .mu-small { flex-shrink: 0; font-size: 11px; white-space: nowrap; }
  .mu-value { flex-shrink: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mu-value[data-tone="warning"] { color: var(--oc-warning); }
  .mu-value[data-tone="error"] { color: var(--oc-error); }
  .mu-note { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
  .mu-note-title { font-weight: 600; }
  .mu-note[data-tone="error"] .mu-note-title { color: var(--oc-error-text); }
  .mu-note[data-tone="warning"] .mu-note-title { color: var(--oc-warning-text); }
  .mu-note[data-tone="info"] .mu-note-title { color: var(--oc-fg); }
  .mu-note-body { font-size: 12px; }
  .mu-note-actions { display: flex; align-items: flex-start; gap: 4px; padding-top: 4px; }
  .mu-port { width: 9em; }
  .mu-foot { display: flex; justify-content: flex-end; gap: 2px; padding-top: 2px; }
`;

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing #root');
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

let locale = 'en';
let strings = stringsFor(locale);
let controlsSupported = false;
let controlsActive = false;
let publishedControls: string | null = null;

const usage = createUsage(host, (state) => render(state));
const refresh = () => void usage.refresh({ force: true });
const setMode = (mode: Settings['mode']) => {
  if (mode === usage.state.settings.mode) return;
  void usage.saveSettings({ ...usage.state.settings, mode }).catch(() => undefined);
};

// The notice is built once: re-rendering it on every poll would steal the port field's focus.
const notice = el('div', 'mu-note');
const noticeTitle = el('div', 'mu-note-title');
const noticeBody = el('div', 'mu-note-body');
const noticeActions = el('div', 'mu-note-actions');
notice.append(noticeTitle, noticeBody, noticeActions);
const retryButton = mountButton(noticeActions, { label: strings.retry, variant: 'outline', size: 'xs', onClick: refresh });
// Only while the gateway does not answer: the one setting this section has.
const portSlot = el('div', 'mu-port');
noticeActions.append(portSlot);
let portDraft = String(usage.state.settings.port);
const portField = mountTextField(portSlot, {
  value: portDraft,
  placeholder: '3425',
  mono: true,
  onChange: (value) => {
    portDraft = value;
    portField.update({ value, error: undefined });
  },
});
const saveButton = mountButton(noticeActions, {
  label: strings.save,
  variant: 'secondary',
  size: 'xs',
  onClick: () => {
    const port = Number(portDraft.trim());
    if (!/^\d+$/.test(portDraft.trim()) || !isValidPort(port)) {
      portField.update({ error: strings.portInvalid });
      return;
    }
    void usage.saveSettings({ ...usage.state.settings, port }).catch((error: unknown) => {
      portField.update({ error: error instanceof Error ? error.message : String(error) });
    });
  },
});

const rows = el('div');
// Older hosts draw no header controls; the section keeps its own for them.
const foot = el('div', 'mu-foot');
const footMode = mountButton(foot, {
  label: strings.modeRemaining,
  variant: 'ghost',
  size: 'xs',
  onClick: () => setMode(usage.state.settings.mode === 'used' ? 'remaining' : 'used'),
});
const footRefresh = mountButton(foot, { label: strings.refresh, variant: 'ghost', size: 'xs', onClick: refresh });
root.append(notice, rows, foot);

// Registered right after connectHost: the host only routes control events to a listener that exists.
host.onStatusControl((event) => {
  if (event.id === 'refresh') refresh();
  else if (event.id === 'mode') setMode(event.value === 'used' ? 'used' : 'remaining');
});

const publishControls = () => {
  if (!controlsSupported) return;
  const controls: GuestStatusControl[] = [
    {
      kind: 'select',
      id: 'mode',
      label: strings.showLabel,
      value: usage.state.settings.mode,
      options: [{ value: 'remaining', label: strings.modeRemaining }, { value: 'used', label: strings.modeUsed }],
    },
    { kind: 'button', id: 'refresh', label: strings.refresh },
  ];
  const signature = JSON.stringify(controls);
  if (signature === publishedControls) return;
  publishedControls = signature;
  void host.setStatusControls(controls).then(() => {
    if (!controlsActive) {
      controlsActive = true;
      render(usage.state);
    }
  }).catch(() => {
    publishedControls = null;
    controlsActive = false;
    render(usage.state);
  });
};

const row = (label: string, options: { heading?: boolean; small?: string | null; value?: string | null; tone?: string; title?: string }) => {
  const line = el('div', options.heading ? 'mu-row mu-heading' : 'mu-row');
  const text = el('span', 'mu-label');
  text.append(el('span', 'mu-text', label));
  if (options.small) text.append(el('span', 'mu-small', options.small));
  line.append(text);
  if (options.value) {
    const value = el('span', 'mu-value', options.value);
    if (options.tone && options.tone !== 'default') value.dataset.tone = options.tone;
    line.append(value);
  }
  if (options.title) line.title = options.title;
  return line;
};

const accountRows = (account: QuotaAccount, state: UsageState, shared: boolean, hidden: Set<string>, now: Date): HTMLElement[] => {
  if (hidden.has(accountKey(account))) return [];
  // The account only matters when one provider has several in magpie.
  const lines = [row(account.name, {
    heading: true,
    small: shared ? account.user : null,
    value: account.balance ?? (account.error ? strings.readFailed : null),
    title: account.error ?? [account.name, account.plan, account.user].filter(Boolean).join(' · '),
  })];
  for (const window of orderWindows(account, account.windows, state.settings.windowOrder)) {
    if (hidden.has(windowKey(account, window))) continue;
    const view = describeWindow(window, state.settings.mode, strings, locale, now);
    lines.push(row(view.label, {
      small: view.resets,
      value: view.value,
      tone: view.tone,
      title: [view.detail, view.resetsAt, windowCount(window)].filter(Boolean).join(' · ') || undefined,
    }));
  }
  return lines;
};

const renderNotice = (state: UsageState) => {
  const next = state.failure
    ? failureNotice(state.failure, strings)
    : state.answer ? answerNotice(state.answer, strings, locale) : null;
  notice.hidden = !next;
  if (!next) return;
  notice.dataset.tone = next.tone;
  notice.setAttribute('role', next.tone === 'info' ? 'status' : 'alert');
  noticeTitle.textContent = next.title;
  noticeBody.textContent = next.body;
  const unreachable = !state.failure && state.answer?.error?.code === 'unreachable';
  retryButton.update({ label: strings.retry, loading: state.loading });
  noticeActions.hidden = !next.retry;
  portSlot.hidden = !unreachable;
  saveButton.update({ label: strings.save });
  if (!unreachable) portDraft = String(state.settings.port);
  if (!unreachable || document.activeElement?.tagName !== 'INPUT') portField.update({ value: portDraft });
};

const render = (state: UsageState) => {
  renderNotice(state);
  const accounts = state.answer?.accounts ?? null;
  const now = new Date();
  if (accounts && accounts.length === 0) {
    rows.replaceChildren(row(strings.empty, {}));
  } else if (accounts) {
    const counts = new Map<string, number>();
    for (const account of accounts) counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
    const hidden = new Set(state.settings.hidden);
    const lines = orderAccounts(accounts, sessionProvider(state.session), state.settings.accountOrder)
      .flatMap((account) => accountRows(account, state, (counts.get(account.provider) ?? 0) > 1, hidden, now));
    rows.replaceChildren(...(lines.length > 0 ? lines : [row(strings.allHidden, {})]));
  } else {
    rows.replaceChildren(...(!state.failure && !state.answer ? [row(strings.loading, {})] : []));
  }
  footMode.update({ label: state.settings.mode === 'used' ? strings.modeUsed : strings.modeRemaining });
  footRefresh.update({ label: strings.refresh, loading: state.loading });
  foot.hidden = controlsActive;
  publishControls();
};

// The host sizes the frame to this, up to its maximum; beyond that the page scrolls.
let reportedHeight = -1;
new ResizeObserver(() => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (height === reportedHeight) return;
  reportedHeight = height;
  void host.setHeight(height).catch(() => undefined);
}).observe(root);

let mounted = false;
host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  const localeChanged = context.locale !== locale;
  locale = context.locale;
  strings = stringsFor(locale);
  document.documentElement.lang = locale;
  const supported = context.features?.statusControls === true;
  if (supported !== controlsSupported || localeChanged) {
    controlsSupported = supported;
    controlsActive = false;
    publishedControls = null;
  }
  if (!mounted) {
    mounted = true;
    usage.start();
  }
  render(usage.state);
});

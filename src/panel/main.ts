import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountBanner, mountButton, mountCheckbox, mountTabs, mountTextField } from '@openchamber/sdk/ui';

import { localizeWindowName, stringsFor } from '../shared/i18n.ts';
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
import { answerNotice, el, failureNotice } from '../shared/view.ts';

// The rail panel holds the settings; the usage itself lives in the Work Status section.
const STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--oc-bg); }
  body { color: var(--oc-fg); font: 13px/1.45 var(--oc-font); }
  [hidden] { display: none !important; }
  .mu-panel { display: flex; flex-direction: column; gap: 18px; padding: 12px; }
  .mu-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .mu-title { font-size: 14px; font-weight: 600; }
  .mu-section { display: flex; flex-direction: column; gap: 8px; }
  .mu-heading { font-size: 12px; font-weight: 600; color: var(--oc-muted); }
  .mu-help { margin: 0; color: var(--oc-muted); font-size: 12px; }
  .mu-port { display: flex; align-items: flex-start; gap: 8px; }
  .mu-port > :first-child { flex: 1; min-width: 0; max-width: 12em; }
  .mu-accounts { display: flex; flex-direction: column; gap: 6px; }
  .mu-account { display: flex; flex-direction: column; gap: 4px; }
  .mu-windows { display: flex; flex-direction: column; gap: 4px; padding-left: 20px; }
  /* A row is the grip plus the kit's checkbox; only the grip drags, so a click
     anywhere else still toggles the checkbox. */
  .mu-item { display: flex; align-items: flex-start; gap: 4px; border-radius: 6px; }
  .mu-item > .oc-sdk-check { flex: 1; min-width: 0; }
  .mu-grip { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 24px;
    margin-top: 2px; border-radius: 4px; color: var(--oc-muted); cursor: grab; background: none; border: 0; padding: 0; }
  .mu-grip:hover { background: var(--oc-hover); color: var(--oc-fg); }
  .mu-grip:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
  .mu-grip:active { cursor: grabbing; }
  .mu-item[data-dragging="true"] { opacity: .45; }
  .mu-item[data-over="true"] { box-shadow: inset 0 2px 0 var(--oc-primary); }
  .mu-account[data-dragging="true"] { opacity: .45; }
  .mu-account[data-over="true"] { box-shadow: inset 0 2px 0 var(--oc-primary); }
`;

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing #root');
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

let locale = 'en';
let strings = stringsFor(locale);

const usage = createUsage(host, (state) => render(state));

const section = (parent: HTMLElement) => {
  const node = el('section', 'mu-section');
  const heading = el('div', 'mu-heading');
  node.append(heading);
  parent.append(node);
  return { node, heading };
};

const panel = el('div', 'mu-panel');
const head = el('header', 'mu-head');
const title = el('div', 'mu-title');
const refreshSlot = el('div');
head.append(title, refreshSlot);
const noticeSlot = el('div');
panel.append(head, noticeSlot);
const display = section(panel);
const gateway = section(panel);
const visible = section(panel);
const visibleHelp = el('p', 'mu-help');
const accountsList = el('div', 'mu-accounts');
visible.node.append(visibleHelp, accountsList);
root.append(panel);

const refreshButton = mountButton(refreshSlot, {
  label: strings.refresh,
  variant: 'ghost',
  size: 'xs',
  onClick: () => void usage.refresh({ force: true }),
});

const banner = mountBanner(noticeSlot, { tone: 'info', title: '' });
noticeSlot.hidden = true;

const modeItems = () => [{ id: 'remaining', label: strings.modeRemaining }, { id: 'used', label: strings.modeUsed }];
// Tabs repaint their buttons on every update, so only touch them when something changed.
let shownMode: Settings['mode'] = usage.state.settings.mode;
const modeTabs = mountTabs(display.node, {
  items: modeItems(),
  activeId: shownMode,
  onChange: (id) => {
    shownMode = id === 'used' ? 'used' : 'remaining';
    modeTabs.update({ activeId: shownMode });
    void usage.saveSettings({ ...usage.state.settings, mode: shownMode }).catch(() => undefined);
  },
});

const portRow = el('div', 'mu-port');
gateway.node.append(portRow);
// The draft follows the saved port until the user types a different one.
let savedPort = usage.state.settings.port;
let portDraft = String(savedPort);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const portField = mountTextField(portRow, {
  value: portDraft,
  placeholder: '3425',
  helper: strings.gatewayHelp,
  mono: true,
  onChange: (value) => {
    portDraft = value;
    portField.update({ value, error: undefined });
  },
});
const saveButton = mountButton(portRow, {
  label: strings.save,
  variant: 'secondary',
  size: 'sm',
  onClick: () => {
    const port = Number(portDraft.trim());
    if (!/^\d+$/.test(portDraft.trim()) || !isValidPort(port)) {
      portField.update({ error: strings.portInvalid });
      return;
    }
    savedPort = port;
    void usage.saveSettings({ ...usage.state.settings, port }).then(() => {
      portField.update({ error: undefined, helper: strings.saved });
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => portField.update({ helper: strings.gatewayHelp }), 2000);
    }).catch((error: unknown) => {
      portField.update({ error: error instanceof Error ? error.message : String(error) });
    });
  },
});

const setHidden = (key: string, hide: boolean) => {
  const hidden = new Set(usage.state.settings.hidden);
  if (hide) hidden.add(key); else hidden.delete(key);
  void usage.saveSettings({ ...usage.state.settings, hidden: [...hidden] }).catch(() => undefined);
};

const GRIP = 'M8 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm5-10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z';

/** The grip that starts a drag; the row itself stays a plain checkbox row. */
const grip = (label: string): HTMLButtonElement => {
  const button = el('button', 'mu-grip');
  button.type = 'button';
  button.tabIndex = -1;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-roledescription', 'draggable');
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GRIP);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  button.append(svg);
  return button;
};

type DragRow = { element: HTMLElement; key: string };

/**
 * Drag-to-reorder over one group of rows. The rows move in the DOM while the
 * pointer is down, so the change is visible before anything is saved; on drop
 * the group's new order is handed to `onDrop`. Only the grip starts a drag.
 */
const draggable = (container: HTMLElement, onDrop: (keys: string[]) => void) => {
  let dragging: DragRow | null = null;

  const rowsNow = (): DragRow[] => [...container.children]
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.key !== undefined)
    .map((element) => ({ element, key: element.dataset.key ?? '' }));

  const clearOver = () => {
    for (const row of rowsNow()) delete row.element.dataset.over;
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-key]');
    if (!(target instanceof HTMLElement) || target.parentElement !== container || target === dragging.element) return;
    const box = target.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    clearOver();
    target.dataset.over = 'true';
    container.insertBefore(dragging.element, after ? target.nextSibling : target);
  };

  const onUp = () => {
    const moved = dragging;
    clearOver();
    dragging = null;
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    if (!moved) return;
    delete moved.element.dataset.dragging;
    onDrop(rowsNow().map((row) => row.key));
  };

  container.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const gripTarget = (event.target as HTMLElement | null)?.closest('.mu-grip');
    // The row is the nearest keyed ancestor: an account row wraps its own head
    // row, a window row is the keyed element itself.
    const row = gripTarget?.closest('[data-key]');
    if (!gripTarget || !(row instanceof HTMLElement) || row.parentElement !== container) return;
    // The grip would otherwise select the row's label text while dragging.
    event.preventDefault();
    dragging = { element: row, key: row.dataset.key ?? '' };
    row.dataset.dragging = 'true';
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
  });
};

/**
 * A drag ends with that group's new order. `windowOrder` is shared by every
 * account, so the group's keys are placed back where the group already sat,
 * under the position of its first key in the saved order.
 */
const saveGroupOrder = (kind: 'account' | 'window', keys: string[]) => {
  const settings = usage.state.settings;
  const saved = kind === 'account' ? settings.accountOrder : settings.windowOrder;
  const group = new Set(keys);
  const kept = saved.filter((key) => !group.has(key));
  const anchor = saved.findIndex((key) => group.has(key));
  const at = anchor < 0 ? kept.length : Math.min(anchor, kept.length);
  const merged = [...kept.slice(0, at), ...keys, ...kept.slice(at)];
  void usage.saveSettings(kind === 'account' ? { ...settings, accountOrder: merged } : { ...settings, windowOrder: merged })
    .catch(() => undefined);
};

let listSignature = '';
const renderAccounts = (state: UsageState) => {
  const accounts = state.answer?.accounts ?? null;
  const hidden = new Set(state.settings.hidden);
  const ordered = accounts ? orderAccounts(accounts, sessionProvider(state.session), state.settings.accountOrder) : null;
  const signature = JSON.stringify([
    locale,
    state.settings.accountOrder,
    state.settings.windowOrder,
    state.settings.hidden,
    ordered?.map((account) => [accountKey(account), account.name, account.windows.map((window) => window.name)]) ?? null,
  ]);
  if (signature === listSignature) return;
  listSignature = signature;
  accountsList.replaceChildren();
  if (!ordered || ordered.length === 0) {
    accountsList.append(el('p', 'mu-help', accounts ? strings.empty : strings.windowsUnavailable));
    return;
  }
  const counts = new Map<string, number>();
  for (const account of accounts ?? []) counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
  for (const account of ordered) {
    const key = accountKey(account);
    const block = el('div', 'mu-account');
    block.dataset.key = key;
    const shown = !hidden.has(key);

    const head = el('div', 'mu-item');
    mountCheckbox(head, {
      label: account.name,
      description: [account.plan, account.user].filter(Boolean).join(' · ') || undefined,
      checked: shown,
      onChange: (checked) => setHidden(key, !checked),
    });
    head.prepend(grip(strings.dragAccount));
    block.append(head);

    if (account.windows.length > 0) {
      const windows = el('div', 'mu-windows');
      const orderedWindows = orderWindows(account, account.windows, state.settings.windowOrder);
      for (const window of orderedWindows) {
        const wKey = windowKey(account, window);
        const item = el('div', 'mu-item');
        item.dataset.key = wKey;
        mountCheckbox(item, {
          label: localizeWindowName(window.name, locale),
          checked: !hidden.has(wKey),
          disabled: !shown,
          onChange: (checked) => setHidden(wKey, !checked),
        });
        item.prepend(grip(strings.dragWindow));
        windows.append(item);
      }
      draggable(windows, (keys) => saveGroupOrder('window', keys));
      block.append(windows);
    }
    accountsList.append(block);
  }

  draggable(accountsList, (keys) => saveGroupOrder('account', keys));
};

const renderNotice = (state: UsageState) => {
  const notice = state.failure
    ? failureNotice(state.failure, strings)
    : state.answer ? answerNotice(state.answer, strings, locale) : null;
  noticeSlot.hidden = !notice;
  if (!notice) return;
  banner.update({
    tone: notice.tone,
    title: notice.title,
    body: notice.body,
    action: notice.retry ? { label: strings.retry, onClick: () => void usage.refresh({ force: true }) } : undefined,
  });
};

const relabel = () => {
  document.documentElement.lang = locale;
  title.textContent = strings.panelTitle;
  display.heading.textContent = strings.displayHeading;
  gateway.heading.textContent = strings.gatewayPort;
  visible.heading.textContent = strings.visibleHeading;
  visibleHelp.textContent = strings.visibleHelp;
  refreshButton.update({ label: strings.refresh });
  modeTabs.update({ items: modeItems() });
  portField.update({ helper: strings.gatewayHelp });
  saveButton.update({ label: strings.save });
};

const render = (state: UsageState) => {
  refreshButton.update({ loading: state.loading });
  if (state.settings.mode !== shownMode) {
    shownMode = state.settings.mode;
    modeTabs.update({ activeId: shownMode });
  }
  if (state.settings.port !== savedPort) {
    if (portDraft === String(savedPort)) {
      portDraft = String(state.settings.port);
      portField.update({ value: portDraft, error: undefined });
    }
    savedPort = state.settings.port;
  }
  renderNotice(state);
  renderAccounts(state);
};

let mounted = false;
host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  const localeChanged = context.locale !== locale;
  locale = context.locale;
  strings = stringsFor(locale);
  if (localeChanged || !mounted) {
    relabel();
    listSignature = '';
  }
  if (mounted) {
    if (localeChanged) render(usage.state);
    return;
  }
  mounted = true;
  render(usage.state);
  usage.start();
});

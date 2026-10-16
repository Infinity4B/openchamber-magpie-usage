import { formatCompactDuration, formatMoment, formatPercent, localizeWindowName, parseTime, type Strings } from './i18n.ts';
import type { QuotaAnswer, QuotaWindow } from './types.ts';
import { shownPercent, toneOf, type DisplayMode, type Failure, type Tone } from './usage.ts';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

type WindowView = {
  label: string;
  /** "28%" in the chosen mode; "3,058.66 / 3,069" for a counted window; "Unlimited". */
  value: string;
  /** What the value leaves out, for the tooltip: the percentage of a counted window. */
  detail: string | null;
  tone: Tone;
  /** "7h7m" while the reset is near, then "6d23h"; the wall clock in the tooltip. */
  resets: string | null;
  /** "10月23日周五 17:12" / "Fri, Oct 23, 5:12 PM", or `null` once the time has passed. */
  resetsAt: string | null;
};

const formatCount = (value: number, locale: string): string => (
  value.toLocaleString(locale, { maximumFractionDigits: 2 })
);

export const describeWindow = (window: QuotaWindow, mode: DisplayMode, strings: Strings, locale: string, now = new Date()): WindowView => {
  const percent = window.unlimited ? null : shownPercent(window, mode);
  const shownPercentText = percent === null ? null : formatPercent(percent);
  let value: string;
  let detail: string | null = null;
  if (window.unlimited) {
    value = strings.unlimited;
  } else if (window.limit !== null && window.amount !== null) {
    // Credits and the like read as numbers: what is left, or what is spent, of the limit.
    const shown = mode === 'used' ? window.amount : Math.max(0, window.limit - window.amount);
    value = `${formatCount(shown, locale)} / ${formatCount(window.limit, locale)}`;
    detail = shownPercentText && (mode === 'used' ? strings.modeUsed : strings.modeRemaining) + ` ${shownPercentText}`;
  } else {
    value = shownPercentText ?? window.display ?? '—';
  }
  const reset = parseTime(window.resetsAt);
  const future = reset && reset.getTime() > now.getTime() ? reset : null;
  return {
    label: localizeWindowName(window.name, locale),
    value,
    detail,
    tone: toneOf(window),
    resets: future ? formatCompactDuration(future.getTime() - now.getTime()) : null,
    resetsAt: future ? formatMoment(future, locale, now) : null,
  };
};

/** "10.34 / 3069 credits" when the vendor counts the window itself. */
export const windowCount = (window: QuotaWindow): string | null => {
  if (!window.display) return null;
  return window.unit && !window.display.includes(window.unit) ? `${window.display} ${window.unit}` : window.display;
};

type Notice = { tone: 'info' | 'warning' | 'error'; title: string; body: string; retry: boolean };

/** Why the service could not be asked at all. */
export const failureNotice = (failure: Failure, strings: Strings): Notice => {
  switch (failure.code) {
    case 'no-service':
      return { tone: 'info', title: strings.noServiceTitle, body: strings.noServiceBody, retry: true };
    case 'disabled':
      return { tone: 'info', title: strings.disabledTitle, body: strings.disabledBody, retry: false };
    case 'service-failed':
      return { tone: 'error', title: strings.serviceFailedTitle, body: strings.serviceFailedBody, retry: true };
    default:
      return { tone: 'error', title: strings.failedTitle, body: failure.message, retry: true };
  }
};

/** Why the service could not read magpie, and whether what is shown is an older reading. */
export const answerNotice = (answer: QuotaAnswer, strings: Strings, locale: string): Notice | null => {
  const error = answer.error;
  if (!error) return null;
  let body: string;
  if (error.code === 'unreachable') body = strings.unreachableBody(answer.port);
  else if (error.code === 'timeout') body = strings.timeoutBody;
  else if (error.code === 'http') body = strings.httpBody(error.message);
  else body = strings.badResponseBody;
  const fetchedAt = parseTime(answer.fetchedAt);
  if (answer.accounts && fetchedAt) body = `${body} ${strings.staleNote(formatMoment(fetchedAt, locale))}`;
  const title = error.code === 'unreachable' ? strings.unreachableTitle : strings.failedTitle;
  return { tone: answer.accounts ? 'warning' : 'error', title, body, retry: true };
};

// The frame cannot use the host's i18n, so the extension picks its own strings from
// `HostReadyContext.locale`: Chinese for any zh tag, English otherwise.

export type Strings = {
  refresh: string;
  retry: string;
  showLabel: string;
  modeRemaining: string;
  modeUsed: string;
  unlimited: string;
  readFailed: string;
  loading: string;
  empty: string;
  unreachableTitle: string;
  unreachableBody: (port: number) => string;
  timeoutBody: string;
  httpBody: (message: string) => string;
  badResponseBody: string;
  staleNote: (time: string) => string;
  noServiceTitle: string;
  noServiceBody: string;
  disabledTitle: string;
  disabledBody: string;
  serviceFailedTitle: string;
  serviceFailedBody: string;
  failedTitle: string;
  gatewayPort: string;
  portInvalid: string;
  save: string;
  saved: string;
  allHidden: string;
  panelTitle: string;
  displayHeading: string;
  dragAccount: string;
  dragWindow: string;
  gatewayHelp: string;
  visibleHeading: string;
  visibleHelp: string;
  windowsUnavailable: string;
};

const zh: Strings = {
  refresh: '刷新',
  retry: '重试',
  showLabel: '显示',
  modeRemaining: '剩余',
  modeUsed: '已用',
  unlimited: '无限制',
  readFailed: '读取失败',
  loading: '正在读取 magpie…',
  empty: 'magpie 里还没有账户',
  unreachableTitle: '连不上 magpie',
  unreachableBody: (port) => `127.0.0.1:${port} 没有响应。请确认 magpie 正在运行，端口与 magpie 设置 → Gateway 中的一致。`,
  timeoutBody: 'magpie 在 15 秒内没有返回用量，稍后再试。',
  httpBody: (message) => `magpie 网关返回了 ${message}。`,
  badResponseBody: 'magpie 返回的数据无法识别，可能需要更新这个扩展。',
  staleNote: (time) => `下面是 ${time} 读取的数据。`,
  noServiceTitle: '需要允许本地服务',
  noServiceBody: '这个扩展通过一个本地服务读取 magpie 网关。请在 设置 → 扩展 中允许它。',
  disabledTitle: '扩展已暂停',
  disabledBody: '在 设置 → 扩展 中恢复后即可读取用量。',
  serviceFailedTitle: '本地服务没有启动',
  serviceFailedBody: '可以重试一次；如果仍然失败，在 设置 → 扩展 中重新加载这个扩展。',
  failedTitle: '读取用量失败',
  gatewayPort: '网关端口',
  portInvalid: '请输入 1–65535 之间的端口。',
  save: '保存',
  saved: '已保存',
  allHidden: '所有账户都已隐藏，可在 Magpie 用量面板中设置。',
  panelTitle: 'Magpie 用量设置',
  displayHeading: '显示方式',
  dragAccount: '拖动以调整账户顺序',
  dragWindow: '拖动以调整窗口顺序',
  gatewayHelp: '与 magpie 设置 → Gateway 中的端口一致，默认 3425。',
  visibleHeading: '在 Work Status 中显示',
  visibleHelp: 'OpenChamber 把扩展区块的高度限制在 320px，内容更多时区块内会出现滚动条。取消勾选用不到的账户或窗口，就能不用滚动。',
  windowsUnavailable: '读到 magpie 的数据后，这里会列出账户和窗口。',
};

const en: Strings = {
  refresh: 'Refresh',
  retry: 'Retry',
  showLabel: 'Show',
  modeRemaining: 'Left',
  modeUsed: 'Used',
  unlimited: 'Unlimited',
  readFailed: 'Could not read',
  loading: 'Reading magpie…',
  empty: 'No accounts in magpie',
  unreachableTitle: 'Can’t reach magpie',
  unreachableBody: (port) => `Nothing answered on 127.0.0.1:${port}. Make sure magpie is running and the port matches magpie Settings → Gateway.`,
  timeoutBody: 'magpie did not answer within 15 seconds. Try again in a moment.',
  httpBody: (message) => `The magpie gateway answered ${message}.`,
  badResponseBody: 'magpie answered with something this extension does not understand. It may need an update.',
  staleNote: (time) => `Showing the reading from ${time}.`,
  noServiceTitle: 'Allow the local service',
  noServiceBody: 'This extension reads the magpie gateway through a local service. Allow it in Settings → Extensions.',
  disabledTitle: 'The extension is paused',
  disabledBody: 'Resume it in Settings → Extensions to read usage.',
  serviceFailedTitle: 'The local service did not start',
  serviceFailedBody: 'Try again. If it keeps failing, reload the extension in Settings → Extensions.',
  failedTitle: 'Could not load usage',
  gatewayPort: 'Gateway port',
  portInvalid: 'Enter a port from 1 to 65535.',
  save: 'Save',
  saved: 'Saved',
  allHidden: 'Every account is hidden. Choose what to show in the Magpie usage panel.',
  panelTitle: 'Magpie usage settings',
  displayHeading: 'Show',
  dragAccount: 'Drag to reorder accounts',
  dragWindow: 'Drag to reorder windows',
  gatewayHelp: 'The port in magpie Settings → Gateway. Default 3425.',
  visibleHeading: 'Show in Work Status',
  visibleHelp: 'OpenChamber caps an extension section at 320px; past that it scrolls. Untick the accounts or windows you do not need to keep it from scrolling.',
  windowsUnavailable: 'Accounts and windows show up here once magpie has been read.',
};

const isChinese = (locale: string): boolean => locale.toLowerCase().startsWith('zh');

export const stringsFor = (locale: string): Strings => (isChinese(locale) ? zh : en);

// magpie names windows in English ("5 hours", "Gemini · 7 days"); Chinese gets the common ones translated.
const ZH_WINDOW_WORDS: Array<[RegExp, (match: RegExpExecArray) => string]> = [
  [/^(\d+)\s*minutes?$/i, (match) => `${match[1]} 分钟`],
  [/^(\d+)\s*hours?$/i, (match) => `${match[1]} 小时`],
  [/^(\d+)\s*days?$/i, (match) => `${match[1]} 天`],
  [/^(\d+)\s*weeks?$/i, (match) => `${match[1]} 周`],
  [/^(\d+)\s*months?$/i, (match) => `${match[1]} 个月`],
  [/^hourly$/i, () => '每小时'],
  [/^daily$/i, () => '每日'],
  [/^weekly$/i, () => '每周'],
  [/^monthly$/i, () => '每月'],
  [/^credits$/i, () => '积分'],
  [/^requests$/i, () => '请求数'],
  [/^tokens$/i, () => 'Token'],
];

export const localizeWindowName = (name: string, locale: string): string => {
  if (!isChinese(locale)) return name;
  return name.split(' · ').map((part) => {
    for (const [pattern, replace] of ZH_WINDOW_WORDS) {
      const match = pattern.exec(part.trim());
      if (match) return replace(match);
    }
    return part;
  }).join(' · ');
};

/** 87 → "87%", 99.66 → "99.7%", 0.34 → "0.3%": rounding must not claim a window is full or empty when it is not. */
export const formatPercent = (value: number): string => {
  if ((value > 0 && value < 1) || (value > 99 && value < 100)) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
};

const sameDay = (a: Date, b: Date): boolean => (
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
);

/** Compact spans, the way the app's own clock reads: "3h58m", "5d6h", "45m". */
export const formatCompactDuration = (ms: number): string => {
  const minutes = Math.max(1, Math.ceil(Math.abs(ms) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h${rest}m` : `${hours}h`;
  return `${rest}m`;
};

/** As the built-in Usage section writes it: "19:59" today, "10月18日周日 11:59" on another day. */
export const formatMoment = (date: Date, locale: string, now: Date = new Date()): string => {
  if (sameDay(date, now)) return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleString(locale, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

export const parseTime = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

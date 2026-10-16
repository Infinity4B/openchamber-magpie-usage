/** One usage window of an account, as magpie reports it. Percentages run 0–100. */
export type QuotaWindow = {
  name: string;
  used: number | null;
  remaining: number | null;
  /** RFC 3339 time the window starts again. */
  resetsAt: string | null;
  unlimited: boolean;
  /** The vendor's own count, like "10.34 / 3069". */
  display: string | null;
  /** How much of `limit` is spent, when the vendor counts the window itself (credits, requests). */
  amount: number | null;
  limit: number | null;
  unit: string | null;
  /** Models that share the window, like "Gemini". */
  pool: string | null;
};

/** One subscription, coding plan or API key. */
export type QuotaAccount = {
  provider: string;
  name: string;
  /** `subscription`, `plan` or `balance`; anything newer magpie adds is kept as is. */
  kind: string;
  user: string | null;
  plan: string | null;
  windows: QuotaWindow[];
  /** What a key or account holds, in its own currency: "$12.40". */
  balance: string | null;
  /** Why magpie could not read the account. */
  error: string | null;
  /** When the reading was taken. */
  readAt: string | null;
  lastServedAt: string | null;
  /** This account answered the latest request through magpie's gateway. */
  last: boolean;
};

export const QUOTA_ERROR_CODES = ['unreachable', 'timeout', 'http', 'bad-response'] as const;
export type QuotaErrorCode = (typeof QUOTA_ERROR_CODES)[number];

/** The local service's answer on `GET /quotas`. */
export type QuotaAnswer = {
  port: number;
  /** When `accounts` were read from the gateway; `null` when there is no reading at all. */
  fetchedAt: string | null;
  /** The last good reading. Kept when a later read fails, so the section can show it as stale. */
  accounts: QuotaAccount[] | null;
  error: { code: QuotaErrorCode; message: string } | null;
};

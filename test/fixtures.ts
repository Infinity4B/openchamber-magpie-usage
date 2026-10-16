// The shape magpie's gateway answers on GET /v1/magpie/quotas, with made-up accounts.
export const gatewayAnswer = {
  object: 'list',
  data: [
    {
      provider: 'claude',
      name: 'Claude Code',
      kind: 'subscription',
      user: 'someone@example.com',
      windows: [
        { name: '5 hours', used: 13, remaining: 87, resetsAt: '2026-10-16T20:00:00+08:00' },
        { name: '7 days', used: 46, remaining: 54, resetsAt: '2026-10-18T12:00:00+08:00' },
      ],
      readAt: '2026-10-16T16:25:38.949198+08:00',
      lastServedAt: '2026-10-16T08:29:41.403185Z',
      last: true,
    },
    {
      provider: 'workbuddy',
      name: 'WorkBuddy',
      kind: 'subscription',
      plan: 'Free',
      user: 'someone',
      windows: [
        { name: 'Credits', used: 0.33691756272401435, remaining: 99.66308243727599, display: '10.34 / 3069', amount: 10.34, limit: 3069, unit: 'credits' },
      ],
      readAt: '2026-10-16T16:27:34.042496+08:00',
    },
    {
      provider: 'antigravity',
      name: 'Antigravity',
      kind: 'subscription',
      plan: 'Google AI Pro',
      user: 'other@example.com',
      windows: [
        { name: 'Gemini · 7 days', used: 0, remaining: 100, resetsAt: '2026-10-23T08:28:30Z', pool: 'Gemini' },
        { name: 'Gemini · 5 hours', used: 92, remaining: 8, resetsAt: '2026-10-16T13:28:30Z', pool: 'Gemini' },
      ],
      readAt: '2026-10-16T16:28:30.350118+08:00',
    },
    {
      provider: 'deepseek',
      name: 'DeepSeek',
      kind: 'balance',
      balance: '¥37.22',
    },
    {
      provider: 'codex',
      name: 'Codex',
      kind: 'subscription',
      user: 'third@example.com',
      error: 'token expired; sign in again in magpie',
    },
  ],
};

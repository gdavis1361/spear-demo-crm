# SLIs / SLOs

## The contract

Three user-facing SLIs, each with a target and an error budget. Burn-rate
alerts should fire when the budget is being consumed faster than sustainable
(e.g. 2% of a 28-day budget in 1 hour → page).

| SLI                          | Definition                                                                                                          | Target    | Budget (28d)              | Data source           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- | --------------------- |
| **Load success**             | `app.mounted` / (`app.mounted` + `app.boot_failed`)                                                                 | 99.9%     | 40 min                    | `track()` sink        |
| **Event-write success**      | successful IDB appends / (successful + `quota_exceeded` + `storage_error`)                                          | 99.95%    | 20 min                    | `track()` sink        |
| **Mutation-delivery health** | `outbox.queue_status` samples where `status != 'degraded'` AND `permanent == 0` / all `outbox.queue_status` samples | 99.5%     | 3 h 21 min                | `outbox.queue_status` |
| **Time-to-interactive p75**  | 75th percentile of `app.ready.totalMs` across all sessions                                                          | < 1500 ms | — (threshold, not budget) | `app.ready` events    |
| **LCP p75**                  | 75th percentile LCP across all sessions                                                                             | < 2.5 s   | — (threshold, not budget) | `web_vital` events    |

### Not-yet-budgeted signals (watch but don't alert)

- `storage.quota_near` — count per 24 h (target: zero beyond ~5% of MAU)
- `storage.quota_exhausted` — count per 24 h (target: zero; any non-zero is a page)
- `error.boundary` — rate per session (target: < 0.1%)
- CLS p75 < 0.1, INP p75 < 200 ms (align with Core Web Vitals "good")
- `schedule.dead_lettered` — count per 24h per schedule name (target: zero; any non-zero pages oncall)
- `workflow.completed{status=failed}` rate (target: < 1% per workflowId per 24h)

### Mutation-delivery SLI rationale

An optimistic local mutation that the outbox never delivers leaks the
"local-first" promise: the UI shows the change, the server doesn't, and
the rep's next session finds the record "reverted" with no explanation.
Before H4 this could persist for hours with zero signal; the
`outbox.queue_status` event is emitted on every status transition plus a
30s keepalive whenever the queue is not idle, so Honeycomb always has a
ground-truth reading of queue health when degraded.

### Time-to-interactive rationale

`app.mounted` fires after React's first render but before runtime hydration
(IDB, projections, scenario). The rep can _see_ UI but can't _use_ it
until `app.ready` lands. TTI p75 captures the full path and is the better
proxy for perceived responsiveness than LCP in this app.

## How to operate the budget

- **Budget burning normally** (< 1× sustainable rate): no action.
- **Budget burning fast** (≥ 2× over any 1h window): dispatch [`synthetics.yml`](../../.github/workflows/synthetics.yml)
  to get a ground-truth read, triage via Sentry, file a postmortem.
- **Budget exhausted** (0 minutes remaining in the rolling window): freeze
  `feat:` merges until burn rate drops below 1× for 48 h. Only `fix:` and
  `perf:` PRs merge during a freeze. Document the freeze in the next
  postmortem.

## Tying CI to the SLO

The bundle-budget gate in `.size-limit.json` enforces ≤80 KB gzip on the
initial chunk — the same number used as the LCP-proxy ceiling. When you
tighten the LCP SLO, tighten the bundle budget first so it catches
regressions before they hit users.

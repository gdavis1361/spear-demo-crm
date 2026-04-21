# Runbook: `storage.quota_exhausted`

**Symptom this represents.** A user's IndexedDB quota filled and an event
append failed with `quota_exceeded`. The user has permanently lost that
write unless they retry after reclaiming space.

**Impact.** Very high for the affected session — the durable layer stops
accepting writes. Scope is per-browser-origin, so each event represents one
user at one point in time.

## First actions

1. **Count and distribution.** Query the telemetry sink:
   - events per hour for the last 24 h (spike or steady?)
   - distinct `sessionId` count (one bad actor, or many users?)
2. **Usage vs quota.** Each event carries `usage` and `quota` in its props
   when available. If `quota < 1 GB`, the browser is under pressure —
   the user is running out of disk, not of our slice.
3. **Fire the vacuum.** If the session is still active, open DevTools and
   run `window.__spear?.vacuumRunner?.runNow()` to reclaim archived
   events. If the count drops after vacuum, the issue is archive
   retention, not live data.

## Mitigation

| Cause                                              | Action                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Retention policy too loose                         | Tune `vacuum-runner.ts` cadence / thresholds               |
| Legacy blobs lingering                             | Run a one-off `snapshot.ts` export + clear cycle           |
| Browser quota shrunk (Firefox private, Safari ITP) | Document as known limitation; surface banner when detected |

## Escalation

- If events exceed 0.1% of daily sessions: page the on-call and freeze
  `feat:` merges.
- If events exceed 1% of daily sessions: this is a design bug, not an
  operational issue — file a postmortem with an action item to add
  cloud-synced snapshots (SRE audit item #13).

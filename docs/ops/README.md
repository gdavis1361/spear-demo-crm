# Ops

Production operator surface for Spear CRM. Google-SRE-shaped, scaled to a
local-first SPA with IndexedDB as the system of record.

## What lives here

- [`slo.md`](./slo.md) — SLIs / SLOs / error budgets (the contract with users)
- [`secrets.md`](./secrets.md) — required GitHub secrets and repo variables
- [`runbooks/`](./runbooks) — one page per alert name (first actions, queries, escalation)
- [`../postmortems/`](../postmortems) — blameless postmortems for every real incident

## Deploy + rollback (at-a-glance)

Production is deployed by [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
on every push to `main`, gated by a post-deploy health probe. If the probe
fails, Vercel retains the previous alias and the workflow reports failure.

Synthetics ([`.github/workflows/synthetics.yml`](../../.github/workflows/synthetics.yml))
probe the public URL every 5 minutes, exercising the same three golden-path
flows as `tests/smoke.spec.ts`. Three consecutive failures triggers an
automated rollback to the most recent green deploy.

## On-call expectations (draft)

Single-maintainer: the owner-of-record is whoever merged the most recent
commit. In-hours response SLO: 30 minutes to ack, 4 hours to mitigation.
Out-of-hours: 2 hours to ack. "Page" today = email from Sentry + repo
alerts; upgrade to PagerDuty once the team crosses two people.

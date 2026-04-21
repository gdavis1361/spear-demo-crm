# Required secrets and variables

Configure at **Settings → Secrets and variables → Actions**.

## Repository secrets

| Name                | Purpose                                                    | How to get it                                                                                       |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `VERCEL_TOKEN`      | Authenticates the deploy workflow                          | [vercel.com/account/tokens](https://vercel.com/account/tokens) — create a token scoped to your user |
| `VERCEL_ORG_ID`     | Vercel team/user ID                                        | `cat .vercel/project.json` after running `vercel link` locally                                      |
| `VERCEL_PROJECT_ID` | Vercel project ID                                          | Same file as above                                                                                  |
| `VITE_SENTRY_DSN`   | Client-side error reporting DSN (optional but recommended) | [sentry.io](https://sentry.io) → Project → Settings → Client Keys (DSN)                             |

## Repository variables

| Name       | Purpose                                                           | Example                    |
| ---------- | ----------------------------------------------------------------- | -------------------------- |
| `PROD_URL` | Canonical production URL used by deploy health probe + synthetics | `https://spear.vercel.app` |

## Setup flow

1. `npm i -g vercel && vercel link` in a local clone to create `.vercel/project.json`.
2. Copy `orgId` and `projectId` from that file into the corresponding secrets.
3. Create the Vercel token and add as `VERCEL_TOKEN`.
4. Create a Sentry project (browser/JavaScript) and copy its DSN into `VITE_SENTRY_DSN`.
5. Set `PROD_URL` to whatever Vercel surfaces as the production alias.

After the first successful deploy, the synthetics workflow begins probing
on its cron cadence. The rollback path requires at least one prior green
deploy run; the first prod deploy is therefore non-rollbackable by design.

## Local dev

`VITE_SENTRY_DSN` is deliberately optional. With no DSN set, Sentry
initialization is a no-op and only Web Vitals + custom telemetry events
flow — exactly what you want during local development and in tests.

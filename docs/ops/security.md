# Security — Threat Model + Trade-offs

Status: current. Last reviewed: 2026-04-21 (TB-audit execution PR).

This document is the record of what Spear protects, what it doesn't,
and why. It exists so that the next reviewer doesn't have to re-derive
the trade-offs from code — and so that decisions like "why isn't
IndexedDB encrypted?" land on a written rationale instead of a shrug.

## Trust model

Spear is local-first. Most durable state lives on the user's device:

- **Event log** (IndexedDB `events` store) — the system of record for
  every user action. Carries PII fields inside event payloads:
  - `account.message_sent.body` / `account.message_received.body` —
    full message text.
  - `deal.quote_sent.quoteText` — quote body.
  - `promise.created.text` — promise text (free-form user input).
- **Promise store** (IndexedDB `promises`) — row-level mirror of
  promise state, carries `text`.
- **Outbox** (IndexedDB `outbox`) — mutation intents waiting to reach
  the server; carries IDs + stage transitions, not free-text PII.
- **Telemetry buffer** (IndexedDB `telemetry_buffer`) — wide-event
  batches that failed to POST; held until retry. Redacted before the
  buffer is written (see "Telemetry redaction" below).

**In transit.** Server-bound traffic goes to `/api/telemetry`,
`/api/csp-report`, and (when configured) Sentry ingest. All carry
redacted payloads. HSTS, `connect-src` allowlist, `frame-ancestors
'none'` block the usual exfil primitives.

**Never persisted.** Session state, feature-flag overrides, and
scenario reset markers live in `sessionStorage` / `localStorage`
under the `spear:*` namespace. None of these carry PII.

## Threats in scope

1. **Accidental PII leakage via telemetry or crash reports.** Covered
   by TB2 — allowlist PII redaction in `src/app/telemetry.ts`.
   Anything that isn't an enum/ID/charset-validated string gets
   `[redacted]` before the buffer accepts it. See also the Sentry
   `beforeSend` hook in `src/app/observability.ts` which uses the
   same allowlist.
2. **Cross-tab message tampering.** BroadcastChannel messages are
   Zod-validated on arrival (see `applyBroadcast` in
   `src/domain/promises.ts` and the outbox + events equivalents). A
   compromised sibling-tab extension can't inject a malformed row.
3. **URL-based injection.** The `?seed=` param is charset-gated
   (`^[a-z0-9][a-z0-9-]*$`, see `src/seeds/activation.ts`). The
   `?spec=` param on ObjectSet URLs is Zod-validated via
   `validateObjectSetSpec` (TB9).
4. **CSP drift.** Locked down via `src/app/csp.test.ts` — a unit
   test asserts directives haven't loosened. `report-uri` +
   `report-to` give a signal when a future directive change produces
   a real-world violation. See TB5/TB10.
5. **User-requested data deletion (GDPR Art. 17 / CCPA §1798.105).**
   Covered by `eraseAllLocalState()` in `src/app/erase.ts`, surfaced
   through the DevPalette. See TB3.
6. **Source-map exposure in production.** Covered by TB8 — the
   `deploy.yml` + `preview.yml` workflows strip `*.js.map` from the
   deploy artifact after `vercel build`. Maps exist in local dev
   and in the Sentry upload pipeline; they never reach the public
   CDN.

## Threats accepted

### IndexedDB is plaintext at rest (TB7)

IndexedDB does not encrypt at rest. Browsers rely on the OS's
filesystem encryption (FileVault, BitLocker, dm-crypt) for data-at-
rest protection of the whole profile directory. Spear inherits that
posture and does not add an application-layer crypto wrapper.

**Why the acceptance.** An app-level crypto wrapper has real costs:

- **Key management.** A key derived from a user password requires a
  per-tab login flow (we don't have auth yet); a key bound to
  WebAuthn requires hardware the user may not have; a key stored in
  IndexedDB alongside the data protects nothing.
- **Recovery.** A lost key means lost data. Local-first apps that
  encrypt at rest generally offer server-side backup, which we
  don't have.
- **Performance.** Every projection read pays a decrypt cost. Writes
  pay an encrypt cost. Measured impact is usually <10ms but
  multiplies across the ~50 projection reads during boot.
- **Threat model fit.** The threat this defends against is "attacker
  has local filesystem access without OS-level credentials." Against
  that attacker, encryption without a key isn't helpful — they'll
  scrape the key from IndexedDB too. Against the narrower threat of
  "malicious browser extension reads the database cross-origin," the
  browser's same-origin policy + extension permission model is the
  enforcement layer; encryption doesn't help because an extension
  with permission can replay the same read path a legitimate tab
  does.

**Compensating controls.**

1. **TB3 erase affordance.** User-initiated deletion is fast and
   complete; no keys to forget.
2. **Per-kind message-body retention (this commit).** Account
   message bodies (`account.message_sent.body`,
   `account.message_received.body`) are eligible for vacuum after 90
   days. The body disappears; projections degrade gracefully
   (rendered as absent). A rep who opens a 6-month-old account
   history sees IDs + metadata + stage history but not individual
   message text.
3. **Telemetry redaction.** Even if an extension reads the telemetry
   buffer, the values are `[redacted]`-sanitized — the body never
   enters the wide-event channel.

**When to revisit.** If Spear adds auth (so a per-user key is
meaningful), or if customer compliance requires at-rest crypto (SOC
2 Type II for regulated verticals), this ADR flips. The
session-timeout vacuum above is a temporary measure; a login flow
would add an idle-lock that purges the whole event log.

### Dev-server CVEs — vite/esbuild moderate advisories (TB6)

The CVEs affect the dev server only; production deploys bundle
through `vite build` and don't expose the dev-server attack surface.
CI audits block high-severity vulns in prod deps (`--audit-level=
high --omit=dev`); dev-dep moderates are accepted until the next
scheduled dependency-major bump. See
[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
(esbuild dev-server SSRF, CVSS 5.3) and
[GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)
(vite path traversal on `.map` files).

The open upgrade plan: bundle vite 5 → 8 with React 19 and
`@vitejs/plugin-react` 6 in one coordinated PR. Dependabot is
pinned at v5 for the plugin ecosystem; reversing the pin is a
deliberate, scoped task.

## Decision log

- **TB2 allowlist for telemetry PII** — shipped. Denylist replaced
  by `SAFE_STRING_KEYS`. Every new `TrackEvent` variant must add its
  string-typed props to the safe set explicitly.
- **TB3 local-erase affordance** — shipped via DevPalette.
  Relocation to Settings → Privacy deferred until a Settings screen
  exists.
- **TB5 CSP connect-src for Sentry** — shipped. `*.ingest.sentry.io`
  allowlisted. Tunnel-through-same-origin deferred; revisit if egress
  hiding becomes a customer requirement.
- **TB7 at-rest crypto** — accepted. See this document.
- **TB8 source-map strip at deploy** — shipped via `deploy.yml` +
  `preview.yml`. Maps retained in local dev and for Sentry upload.
- **TB1 ontology wiring** — lint-rule half shipped. Full
  projection-threading deferred to a multi-day follow-up.
- **TB6 vite upgrade** — deferred. See "Dev-server CVEs" above.

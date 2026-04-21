# Security policy

## Supported versions

| Version  | Supported          |
| -------- | ------------------ |
| `0.x`    | :white_check_mark: |

Spear is pre-1.0. Once `1.0.0` ships we'll support the current and previous minor.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Email **security@spear.example** with:

- A description of the vulnerability
- Steps to reproduce
- The affected commit (or version)
- Your assessment of impact + suggested severity

We acknowledge within **72 hours** and aim to ship a fix within **14 days** for high-severity findings (CVSS ≥ 7) and **30 days** for medium. We coordinate disclosure timing with the reporter.

If you'd prefer GitHub's private vulnerability reporting, open a private advisory at the repo's *Security → Advisories → New draft security advisory*.

## What we treat as a vulnerability

- Cross-tab / cross-origin data exposure
- IndexedDB / localStorage write that bypasses the marking layer ([`src/ontology/marking.ts`](src/ontology/marking.ts))
- Event log injection that bypasses Zod validation ([`src/domain/event-schema.ts`](src/domain/event-schema.ts))
- Workflow runner determinism violations
- Any path that allows reading PII (`Person.email`, `Person.phone`, `Deal.bafoDraft`) without the appropriate clearance

## What we don't (yet) treat as in-scope

- Self-XSS via clipboard paste into the dev console
- Rate-limit avoidance against the mock API
- Issues in `node_modules` already covered by Dependabot — please file those upstream

## Disclosure credit

Reporters are credited in `CHANGELOG.md` under the release that ships the fix, unless they request anonymity.

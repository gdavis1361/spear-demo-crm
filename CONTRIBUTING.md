# Contributing to Spear CRM

Thanks for your interest. This file explains how the repo is laid out, what the contribution loop looks like, and which gates must pass before a PR is mergeable.

## Setup

```bash
nvm use                # pins to the version in .nvmrc
npm ci                 # uses the lockfile, never `npm install` for first setup
npm run dev            # http://localhost:5173
```

If you'd rather not configure Node locally, the repo ships a Codespaces / Dev Container at [`.devcontainer/`](.devcontainer/devcontainer.json) — open the repo in a Codespace and you're ready to run.

## The development loop

1. Create a branch off `main`. Branch naming: `feat/short-summary`, `fix/short-summary`, `chore/…`, `docs/…`.
2. Make your change. Keep commits small and focused.
3. **Use [Conventional Commits](https://www.conventionalcommits.org/)** in commit messages. Examples:
   - `feat(ontology): add Lane object type`
   - `fix(promises): retry tick when missed-event idempotency conflicts`
   - `docs(readme): add architecture diagram`
4. Run the local gates:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run test:e2e
   npm run test:visual
   ```
5. Open a PR. The PR template will prompt you for the relevant context.

## Gates that must pass

CI runs on every PR ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Required:

| Gate                | Threshold                                                |
| ------------------- | -------------------------------------------------------- |
| `typecheck`         | 0 errors (strict TS)                                     |
| `lint`              | 0 errors                                                 |
| `unit`              | All tests pass; coverage at or above thresholds in `vitest.config.ts` |
| `build`             | `tsc --noEmit && vite build` succeeds                    |
| `e2e`               | Playwright smoke + axe a11y, no `serious`/`critical` violations |
| `visual`            | Pixel-diff baselines reproduce within `0.2%` ratio       |
| `bundle-budget`     | Initial JS chunk ≤ 80 KB gzipped                         |
| `audit`             | `npm audit --audit-level=high` clean                     |

## Releases

Releases are automated via [`release-please`](.github/workflows/release-please.yml). Conventional commit prefixes drive the version bump:

- `feat:` → minor
- `fix:` / `perf:` → patch
- `feat!:` or `BREAKING CHANGE:` footer → major

Merging a `release-please` PR cuts a tag, publishes a GitHub Release with auto-generated notes, attaches the bundle as an artifact, and emits SLSA build provenance.

## Code organization

- `src/components/` — shared UI (Topbar, Rail, Tweaks, Noun, Peek, …)
- `src/screens/` — one file per route, lazy-loaded
- `src/lib/` — typed primitives (Money, Time, IDs, ULID, contact, schemas)
- `src/api/` — typed client + mock server + error catalogue
- `src/app/` — runtime singletons (state, telemetry, runtime, flags, context)
- `src/domain/` — durable layer (event log, promises, schedules, workflows, projections, vacuum, snapshot, stats)
- `src/ontology/` — Foundry-style ontology (define, marking, lineage, ObjectSet, action runner, audit, projects)
- `src/styles/` — CSS (spear, crm, nouns)
- `tests/` — Playwright smoke + a11y + visual

See [docs/architecture.md](docs/architecture.md) for the layered diagram.

## Code style

- **Strict TypeScript** — `strict: true` in `tsconfig.json`. No `any` without justification.
- **Conventional Commits** in commit messages (enforced by `commitlint`).
- **Prettier** (`npm run format`) + **ESLint flat config** with `jsx-a11y`. Run `npm run lint -- --fix` before pushing.
- No emojis in code, comments, or commit messages unless requested.

## Reviewers

CODEOWNERS routes review by area — see [`.github/CODEOWNERS`](.github/CODEOWNERS). At least one CODEOWNER must approve before merge.

## Reporting bugs / requesting features

Use the issue templates: [bug report](.github/ISSUE_TEMPLATE/bug_report.yml), [feature request](.github/ISSUE_TEMPLATE/feature_request.yml).

Security issues go through [`SECURITY.md`](SECURITY.md), not the public issue tracker.

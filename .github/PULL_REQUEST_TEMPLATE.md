## Summary

<!-- One paragraph: what changed and why. Skip the "what" — the diff already shows that. Focus on the why and any tradeoffs. -->

## Linked issues

Closes #
Refs #

## Type of change

<!-- Check all that apply. -->

- [ ] `feat` — new functionality
- [ ] `fix` — bug fix
- [ ] `perf` — performance improvement
- [ ] `refactor` — internal change, no behavior delta
- [ ] `docs` — documentation only
- [ ] `test` — tests only
- [ ] `chore` — build / repo plumbing
- [ ] **Breaking change** (also add `!` to commit prefix or `BREAKING CHANGE:` footer)

## How to verify

<!-- Steps a reviewer can run locally. Be specific. -->

```bash
npm ci
npm run typecheck && npm run lint && npm test && npm run build
npm run test:e2e && npm run test:visual
```

## CI checks that must pass

<!--
The local command above covers typecheck / lint / unit / build. Branch
protection additionally requires these CI jobs (they don't all have a
local one-liner). See docs/architecture.md § Gates for the full gate
matrix.
-->

<details>
<summary>7 required status checks</summary>

| Check                             | What it gates                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `typecheck · lint · unit · build` | `tsc --noEmit`, `eslint src`, vitest + coverage thresholds, `vite build`, `npm run size` |
| `e2e (chromium-smoke)`            | Playwright smoke + `axe` a11y on Chromium                                                |
| `e2e (firefox-smoke)`             | Same smoke suite on Firefox                                                              |
| `e2e (webkit-smoke)`              | Same smoke suite on WebKit                                                               |
| `visual regression (chromium)`    | Pixel-diff against committed baselines (`tests/visual/**/*-snapshots/*-linux.png`)       |
| `supply chain`                    | `npm audit signatures` + `npm audit --audit-level=high`                                  |
| `analyze (javascript-typescript)` | CodeQL `security-extended` queries                                                       |

</details>

## Screenshots / videos

<!-- For UI changes. Drag and drop into the PR; include before + after if applicable. -->

## Checklist

- [ ] My commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] I added tests for new behavior (unit + axe + visual where applicable)
- [ ] I updated docs (`README.md`, `docs/`, JSDoc) where the change touches public surface
- [ ] I considered marking + lineage implications for any new data path
- [ ] I confirmed the bundle-budget gate passes (`npm run size`)
- [ ] I confirmed there are no `any` casts without an inline justification

## Risk + rollback

<!-- What could go wrong? How would we revert? Reference the relevant compensating actions or feature flag. -->

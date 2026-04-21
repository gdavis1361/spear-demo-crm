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

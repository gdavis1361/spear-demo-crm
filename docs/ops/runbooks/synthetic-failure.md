# Runbook: synthetic probe failure

**Symptom this represents.** The `synthetics` GitHub workflow failed. It
exercises landing → keyboard nav → Cmd+K against the public URL every 5
minutes.

**Impact.** Three consecutive failures will auto-dispatch a rollback to the
last green deploy (see [deploy.yml](../../../.github/workflows/deploy.yml)).
A single failure may be transient (Vercel cold-start, CDN edge issue).

## First actions

1. **Check the attached trace.** `playwright-report/` artifact on the
   workflow run shows the exact point of failure.
2. **Try the real URL.** Open `PROD_URL` in a private window. Does the
   app paint? If no: production is down; confirm by checking Vercel
   dashboard. If yes: flake is likely; check if next run passes.
3. **Check recent deploys.** `gh run list --workflow=deploy.yml --limit 5`.
   Correlate the synthetic failure window with a recent deploy.

## Mitigation

| Cause                                    | Action                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Recent deploy broke something            | Let the 3-failure rollback fire, or dispatch `deploy.yml` with a known-good SHA manually                       |
| Vercel edge issue                        | Wait one cycle; if next run passes, file a noise entry, no postmortem                                          |
| Bot detection blocking headless Chromium | Configure Vercel firewall allow-list for GitHub Actions IPs                                                    |
| Test expectation drifted from reality    | Fix `tests/synthetic.spec.ts` — _but_ file a postmortem explaining why the drift wasn't caught by pre-merge CI |

## Escalation

If rollback doesn't restore the probe to green within 10 minutes, the
issue is not in the code — it's in infra. Escalate to whoever owns the
Vercel account and the domain.

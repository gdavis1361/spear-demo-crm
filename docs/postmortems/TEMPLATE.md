# Postmortem: &lt;short descriptor&gt;

**Date:** YYYY-MM-DD  
**Authors:** @handle  
**Status:** draft | published  
**Severity:** SEV-1 | SEV-2 | SEV-3

---

## Summary

One paragraph. What happened, who was affected, when it started, when it
was mitigated, root cause in one line.

## Impact

- Users affected: N (% of MAU)
- Duration: HH:MM UTC → HH:MM UTC (M minutes)
- Error budget consumed: N minutes (of 40 / 20 per SLO)
- Revenue / business impact if applicable

## Timeline

All times UTC. Include sources — alert IDs, run URLs, Sentry issue links.

| Time  | Event                                     |
| ----- | ----------------------------------------- |
| HH:MM | Deploy of `abc1234` lands on main         |
| HH:MM | First synthetic failure: `<workflow URL>` |
| HH:MM | On-call paged                             |
| HH:MM | Mitigation start: rollback dispatched     |
| HH:MM | Mitigation complete: synthetic green      |

## Root cause

What actually caused the outage. Name the specific commit, config value,
or environmental change. Include the queries/logs that support this
conclusion. **No blame on individuals** — describe the system failure.

## Contributing factors

Everything that made this worse or took longer to detect. Missing alerts,
gaps in monitoring, runbook wasn't linked from the alert, etc.

## What went well

List three things the system, tooling, or team did right. This is not
filler — patterns that worked here are patterns to double down on.

## What went wrong

Specifics. "CI should have caught this" → _why_ didn't it? "Alert fired
late" → by how much, and what's the threshold adjustment?

## Action items

Concrete follow-ups with owners and target dates. Each one is a ticket.

| #   | Action | Owner   | Due        | Ticket |
| --- | ------ | ------- | ---------- | ------ |
| 1   | ...    | @handle | YYYY-MM-DD | #...   |

## Lessons

What to remember six months from now when someone asks "why did we do it
this way?" A tight paragraph is better than a long list.

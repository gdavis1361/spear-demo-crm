import { describe, it, expect } from 'vitest';
import { scanArmedWaits } from './runtime';

// The `scanArmedWaits` helper is the heart of the wait ticker (T1): it
// decides which runs need a resume. Testing it directly avoids waiting
// for `setInterval` and lets us pin behavior on the event-shape — we
// don't want the ticker to miss a wait that expired, fire twice on the
// same wait, or attempt to re-drive a completed run.

const FIRED = '2026-04-21T12:00:00Z';
const NOT_FIRED = '2027-04-21T12:00:00Z';

function row(stream: string, payload: unknown) {
  return { stream, payload };
}

describe('scanArmedWaits', () => {
  it('returns candidates with un-resumed wait_armed whose fireAt is set', () => {
    const rows = [
      row('workflow:wf-1:run:r1', { kind: 'workflow.run_started' }),
      row('workflow:wf-1:run:r1', {
        kind: 'workflow.wait_armed',
        stepIdx: 1,
        fireAt: { iso: FIRED },
      }),
    ];
    const out = scanArmedWaits(rows);
    expect(out).toHaveLength(1);
    expect(out[0].workflowId).toBe('wf-1');
    expect(out[0].runId).toBe('r1');
    expect(out[0].stepIdx).toBe(1);
  });

  it('ignores waits that already have a matching wait_resumed', () => {
    const rows = [
      row('workflow:wf-1:run:r1', { kind: 'workflow.run_started' }),
      row('workflow:wf-1:run:r1', {
        kind: 'workflow.wait_armed',
        stepIdx: 1,
        fireAt: { iso: FIRED },
      }),
      row('workflow:wf-1:run:r1', { kind: 'workflow.wait_resumed', stepIdx: 1 }),
    ];
    expect(scanArmedWaits(rows)).toHaveLength(0);
  });

  it('ignores streams whose run is already completed', () => {
    const rows = [
      row('workflow:wf-1:run:r1', { kind: 'workflow.run_started' }),
      row('workflow:wf-1:run:r1', {
        kind: 'workflow.wait_armed',
        stepIdx: 1,
        fireAt: { iso: FIRED },
      }),
      row('workflow:wf-1:run:r1', { kind: 'workflow.run_completed', disposition: 'queued' }),
    ];
    expect(scanArmedWaits(rows)).toHaveLength(0);
  });

  it('keeps un-fired waits as candidates too; the tick loop is responsible for gating on fireAt', () => {
    // The scanner returns every un-resumed armed wait; the outer tick
    // loop decides whether `fireAt <= now`. Documenting this contract
    // via a test so a future refactor doesn't silently push the gating
    // into the scanner and hide which piece is responsible.
    const rows = [
      row('workflow:wf-1:run:r_late', {
        kind: 'workflow.wait_armed',
        stepIdx: 1,
        fireAt: { iso: NOT_FIRED },
      }),
    ];
    expect(scanArmedWaits(rows)).toHaveLength(1);
  });

  it('picks up multiple independent streams in one scan', () => {
    const rows = [
      row('workflow:wf-1:run:ra', {
        kind: 'workflow.wait_armed',
        stepIdx: 1,
        fireAt: { iso: FIRED },
      }),
      row('workflow:wf-2:run:rb', {
        kind: 'workflow.wait_armed',
        stepIdx: 2,
        fireAt: { iso: FIRED },
      }),
    ];
    const out = scanArmedWaits(rows);
    expect(out.map((c) => `${c.workflowId}:${c.runId}:${c.stepIdx}`)).toEqual([
      'wf-1:ra:1',
      'wf-2:rb:2',
    ]);
  });
});

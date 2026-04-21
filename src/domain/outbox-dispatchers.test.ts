// Integration test for outbox-dispatchers.ts. The unit tests in
// outbox.test.ts use a scripted dispatcher that bypasses the real code
// path binding mutations to the API client and the event log — so
// without this file we'd have zero coverage on the line that actually
// writes the compensating revert event.
//
// Real wiring: buildDispatcherRegistry(log) + real IndexedDbEventLog +
// stubbed window.fetch returning a non-retryable error. Assert the
// permanent-failure path for `advance_deal` appends a `deal.reverted`
// event to the stream.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  IndexedDbEventLog,
  dealStream,
  signalStream,
  openSpearDb,
  STORE_OUTBOX,
  _resetDbConnectionForTests,
} from './events';
import { Outbox } from './outbox';
import { buildDispatcherRegistry } from './outbox-dispatchers';
import { runTransition } from './deal-machine';
import { repId, leadId } from '../lib/ids';
import { MOCK_API } from '../api/client';

async function clearOutboxAndEvents(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', 'events_dlq', STORE_OUTBOX], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('events_dlq').clear();
    tx.objectStore(STORE_OUTBOX).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stubFetch(responder: (url: string) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return responder(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe('outbox-dispatchers.buildDispatcherRegistry', () => {
  let log: IndexedDbEventLog;
  let outbox: Outbox;
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearOutboxAndEvents();
    log = new IndexedDbEventLog();
  });

  afterEach(() => {
    outbox?.dispose();
    if (restoreFetch) restoreFetch();
    restoreFetch = null;
  });

  it('advance_deal permanent failure appends a deal.reverted event to the stream', async () => {
    // Seed the event log so the deal is known at stage 'qualify'.
    // `runTransition` is the same API the pipeline uses; writing via it
    // keeps the stream in a state the revert edge validates against.
    const dealId = leadId('ld_99_integration');
    await log.append(dealStream(dealId), [
      {
        opKey: `seed:${dealId}`,
        payload: {
          kind: 'deal.created',
          at: { iso: '2026-04-20T00:00:00.000Z' },
          by: repId('rep_mhall'),
          stage: 'qualify',
          displayId: 'LD-99',
          title: 'Integration test deal',
          meta: 'integration',
          branch: 'Army',
          value: { amountMinor: BigInt(0), currency: 'USD' },
          tags: [],
        },
      },
    ]);
    // Advance to scoping so the revert edge [scoping → qualify] is legal.
    const adv = await runTransition(log, {
      id: dealId,
      from: 'qualify',
      to: 'scoping',
      by: repId('rep_mhall'),
      role: 'rep',
    });
    expect(adv.ok).toBe(true);

    // Stub fetch to return a non-retryable 404 so the outbox promotes
    // to permanent_failure after exactly one attempt.
    restoreFetch = stubFetch((url) => {
      if (url.startsWith(MOCK_API)) {
        return new Response(
          JSON.stringify({ code: 'resource_not_found', message: 'deal not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const registry = buildDispatcherRegistry(log);
    outbox = new Outbox(registry);

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: String(dealId), toStage: 'scoping', fromStage: 'qualify' },
      'op_integration_1'
    );
    const report = await outbox.drain();

    expect(report.permanentFailures).toBe(1);

    // The compensator should have appended a deal.reverted event. Read
    // the stream back and verify the latest event is the revert.
    const events = await log.read(dealStream(dealId));
    const kinds = events.map((e) => e.payload.kind);
    expect(kinds).toContain('deal.reverted');

    const reverted = events.filter((e) => e.payload.kind === 'deal.reverted');
    expect(reverted).toHaveLength(1);
    const p = reverted[0].payload as {
      kind: 'deal.reverted';
      from: string;
      to: string;
      reason: string;
    };
    expect(p.from).toBe('scoping');
    expect(p.to).toBe('qualify');
    expect(p.reason).toContain('outbox permanent failure');
  });

  it('advance_deal compensator on won-stage now appends a deal.reverted successfully (VX6)', async () => {
    // Pre-VX6, `won` was terminal so the compensator had to refuse and
    // leave the UI stating "the server refused but we couldn't undo".
    // Post-VX6, `[won → verbal]` is a legal revert edge, so the
    // compensator writes the revert cleanly and the projection snaps
    // back honestly.
    const dealId = leadId('ld_terminal_compensate');
    await log.append(dealStream(dealId), [
      {
        opKey: `seed:${dealId}`,
        payload: {
          kind: 'deal.created',
          at: { iso: '2026-04-20T00:00:00.000Z' },
          by: repId('rep_mhall'),
          stage: 'verbal',
          displayId: 'LD-99T',
          title: 'Terminal compensate deal',
          meta: 'terminal',
          branch: 'Army',
          value: { amountMinor: BigInt(0), currency: 'USD' },
          tags: [],
        },
      },
    ]);
    await runTransition(log, {
      id: dealId,
      from: 'verbal',
      to: 'won',
      by: repId('rep_mhall'),
      role: 'rep',
    });

    restoreFetch = stubFetch(
      () =>
        new Response(JSON.stringify({ code: 'resource_not_found', message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const registry = buildDispatcherRegistry(log);
    outbox = new Outbox(registry);

    const failures: Array<{ kind: string; compStatus: string; reason?: string }> = [];
    outbox.onFailure((m, _err, comp) => {
      failures.push({
        kind: m.kind,
        compStatus: comp.status,
        reason: comp.status === 'refused' ? comp.reason : undefined,
      });
    });

    await outbox.enqueue(
      { kind: 'advance_deal', dealId: String(dealId), toStage: 'won', fromStage: 'verbal' },
      'op_terminal_revert'
    );
    await outbox.drain();

    // VX6: the compensator appended a legal revert. Stream now carries
    // created → advanced (verbal→won) → reverted (won→verbal).
    const events = await log.read(dealStream(dealId));
    const reverts = events.filter((e) => e.payload.kind === 'deal.reverted');
    expect(reverts).toHaveLength(1);
    const p = reverts[0].payload as { from: string; to: string };
    expect(p.from).toBe('won');
    expect(p.to).toBe('verbal');

    // Subscriber sees a clean compensated result — the UX message is
    // the truthful "returned to verbal", not the fallback "could not
    // revert".
    expect(failures).toHaveLength(1);
    expect(failures[0].compStatus).toBe('compensated');
  });

  it('dismiss_signal permanent failure appends a signal.dismiss_reverted event (VX1)', async () => {
    // Post-VX1: signals are event-sourced. The compensator appends a
    // durable revert event so SignalProjection un-dismisses the row
    // across every subscribed tab — the UI state survives navigation
    // and reload unlike the pre-VX1 React.useState approach.
    restoreFetch = stubFetch(
      () =>
        new Response(JSON.stringify({ code: 'resource_not_found', message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const registry = buildDispatcherRegistry(log);
    outbox = new Outbox(registry);

    const failures: Array<{ compStatus: string }> = [];
    outbox.onFailure((_m, _err, comp) => failures.push({ compStatus: comp.status }));

    // Lay a local `signal.dismissed` event first (what signals.tsx does
    // at click time) so the compensator has something meaningful to
    // revert against — even though our revert is unconditional, this
    // mirrors the real runtime sequence.
    await log.append(signalStream('SIG-ghost'), [
      {
        opKey: 'seed:dismiss',
        payload: {
          kind: 'signal.dismissed',
          at: { iso: '2026-04-21T13:00:00.000Z' },
          by: repId('rep_mhall'),
        },
      },
    ]);

    await outbox.enqueue({ kind: 'dismiss_signal', signalId: 'SIG-ghost' }, 'op_signal_gone');
    await outbox.drain();

    expect(failures).toHaveLength(1);
    expect(failures[0].compStatus).toBe('compensated');

    const events = await log.read(signalStream('SIG-ghost'));
    const kinds = events.map((e) => e.payload.kind);
    expect(kinds).toContain('signal.dismiss_reverted');
  });

  it('action_signal permanent failure appends a signal.action_reverted event (VX1)', async () => {
    restoreFetch = stubFetch(
      () =>
        new Response(JSON.stringify({ code: 'resource_not_found', message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const registry = buildDispatcherRegistry(log);
    outbox = new Outbox(registry);

    const failures: Array<{ compStatus: string }> = [];
    outbox.onFailure((_m, _err, comp) => failures.push({ compStatus: comp.status }));

    await log.append(signalStream('SIG-action'), [
      {
        opKey: 'seed:action',
        payload: {
          kind: 'signal.actioned',
          at: { iso: '2026-04-21T13:00:00.000Z' },
          by: repId('rep_mhall'),
        },
      },
    ]);

    await outbox.enqueue({ kind: 'action_signal', signalId: 'SIG-action' }, 'op_action_gone');
    await outbox.drain();

    expect(failures).toHaveLength(1);
    expect(failures[0].compStatus).toBe('compensated');

    const events = await log.read(signalStream('SIG-action'));
    const kinds = events.map((e) => e.payload.kind);
    expect(kinds).toContain('signal.action_reverted');
  });
});

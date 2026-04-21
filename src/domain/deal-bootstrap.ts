// One-time bootstrap: emit `deal.created` events for each static DEAL
// fixture when the event log has none. After this runs once per
// IndexedDB, Deals live in the event stream and the `DEALS` static array
// is purely historical.
//
// Idempotent: if any `deal:*` events already exist, this is a no-op.
// The opKey for each seeded deal is `bootstrap-deal-<displayId>` so
// re-running would dedupe via the UNIQUE (stream, opKey) index anyway.

import type { EventLog } from './events';
import { dealStream } from './events';
import { DEALS } from '../lib/data';
import { repId } from '../lib/ids';
import { now as nowInstant } from '../lib/time';

export async function bootstrapDealsIfEmpty(log: EventLog): Promise<void> {
  const existing = await log.readPrefix('deal:');
  if (existing.length > 0) return;

  // Fixed rep so the bootstrap is deterministic. Real mutations carry
  // the actual rep id from the UI.
  const by = repId('rep_mhall');
  const at = nowInstant();

  for (const d of DEALS) {
    await log.append(dealStream(d.dealId), [
      {
        opKey: `bootstrap-deal-${d.displayId}`,
        payload: {
          kind: 'deal.created',
          at,
          by,
          stage: d.stage,
          value: d.value,
          displayId: d.displayId,
          title: d.title,
          meta: d.meta,
          branch: d.branch,
          tags: [...d.tags],
          ...(d.hot !== undefined ? { hot: d.hot } : {}),
          ...(d.warm !== undefined ? { warm: d.warm } : {}),
        },
      },
    ]);
  }
}

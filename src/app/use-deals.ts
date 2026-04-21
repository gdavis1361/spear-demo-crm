// React hook for the live Deal projection snapshot.
//
// Subscribes on mount, unsubscribes on unmount. Emits fresh snapshots
// whenever the projection picks up new `deal:*` events via the EventLog's
// BroadcastChannel — which happens after every `log.append()` in this
// tab and (cross-tab) after every append in sibling tabs.

import React from 'react';
import type { Deal } from '../lib/types';
import { dealProjection } from './runtime';

export function useDeals(): readonly Deal[] {
  const [deals, setDeals] = React.useState<readonly Deal[]>(() => dealProjection.list());
  React.useEffect(() => dealProjection.subscribe(setDeals), []);
  return deals;
}

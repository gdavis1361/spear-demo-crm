// Ambient — module-level mutable state for non-React telemetry callers.
//
// Honeycomb's "wide events" ask every emission to carry a common base
// context (who, where, session state). Most `track()` calls happen from
// React components that have `useApp()` in scope, so they could read
// role/screen directly from context. But `track()` is also called from:
//
//   - main.tsx (before React mounts)
//   - observability.ts (web-vitals callbacks)
//   - schedules.ts (timer-driven poll runs)
//   - workflow-runner.ts (step-dispatch)
//   - seed runner (boot-time scenario execution)
//   - outbox internals (drain / compensator)
//   - promise store (cross-tab hydration)
//
// None of those have React context available. Rather than threading a
// 6-argument context through every call site, we mirror the React state
// into this module via setters the provider calls on change, and let
// `baseContext()` in telemetry.ts read from it.
//
// Telemetry is the only reader; no domain code should import from here.

import type { Role, Screen } from '../lib/types';

interface AmbientState {
  role: Role;
  screen: Screen;
  seed: string | null;
  lastOutboxDepth: number;
}

const state: AmbientState = {
  role: 'rep',
  screen: 'today',
  seed: null,
  lastOutboxDepth: 0,
};

export function setRole(role: Role): void {
  state.role = role;
}

export function setScreen(screen: Screen): void {
  state.screen = screen;
}

export function setSeed(seed: string | null): void {
  state.seed = seed;
}

export function setLastOutboxDepth(n: number): void {
  state.lastOutboxDepth = n;
}

export function getAmbient(): Readonly<AmbientState> {
  return state;
}

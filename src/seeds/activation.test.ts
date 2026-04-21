// Gate 2 (Phase 3 PR 1): `detectSeedParam` applies charset-only
// validation. This is the input-validation layer in front of
// `setDbName()` — every name that passes must produce a DB name
// that's a safe sibling of the real one, with no path traversal or
// shell-meta reach into sensitive stores.
//
// Registry-existence is checked later at boot time (see main.tsx) so
// this module can stay out of the initial JS chunk.

import { describe, it, expect, afterEach } from 'vitest';
import { detectSeedParam, activateSeedFromUrl, SEED_DB_PREFIX } from './activation';
import { _setDbNameForTests, getDbName, _resetDbConnectionForTests } from '../domain/events';

describe('detectSeedParam (Phase 3 PR 1 — Gate 2)', () => {
  it('returns null when no search string is provided', () => {
    expect(detectSeedParam('')).toBeNull();
  });

  it('returns null when the `seed` param is absent', () => {
    expect(detectSeedParam('?something=else')).toBeNull();
  });

  it('returns null when the `seed` value is empty', () => {
    expect(detectSeedParam('?seed=')).toBeNull();
  });

  it('rejects path-traversal shapes', () => {
    expect(detectSeedParam('?seed=../evil')).toBeNull();
    expect(detectSeedParam('?seed=..%2Fevil')).toBeNull();
    expect(detectSeedParam('?seed=/etc/passwd')).toBeNull();
  });

  it('rejects shell-meta / control characters', () => {
    expect(detectSeedParam('?seed=busy rep')).toBeNull();
    expect(detectSeedParam('?seed=busy;rep')).toBeNull();
    expect(detectSeedParam('?seed=busy%00rep')).toBeNull();
  });

  it('rejects uppercase (canonical form is lowercase)', () => {
    expect(detectSeedParam('?seed=Busy-Rep')).toBeNull();
  });

  it('rejects leading hyphens (to stay below CLI-flag ambiguity)', () => {
    expect(detectSeedParam('?seed=-canonical')).toBeNull();
  });

  it('accepts charset-valid names (registry-existence checked at boot)', () => {
    expect(detectSeedParam('?seed=empty')).toBe('empty');
    expect(detectSeedParam('?seed=canonical')).toBe('canonical');
    expect(detectSeedParam('?seed=busy-rep')).toBe('busy-rep');
    // Not a registered scenario, but passes charset — semantic check
    // happens at boot, where an unknown scenario throws and ErrorBoundary
    // renders the standard error screen.
    expect(detectSeedParam('?seed=future-scenario-not-yet-built')).toBe(
      'future-scenario-not-yet-built'
    );
  });
});

describe('activateSeedFromUrl (Phase 3 PR 1 — Gate 2 integration)', () => {
  afterEach(() => {
    _setDbNameForTests('spear-events');
    _resetDbConnectionForTests();
  });

  it('no-ops when ?seed is absent — DB name stays as default', () => {
    const r = activateSeedFromUrl('');
    expect(r.mode).toBe('default');
    expect(r.scenario).toBeNull();
    expect(r.dbName).toBe('spear-events');
    expect(getDbName()).toBe('spear-events');
  });

  it('calls setDbName with the prefixed name on a charset-valid seed', () => {
    _resetDbConnectionForTests();
    const r = activateSeedFromUrl('?seed=busy-rep');
    expect(r.mode).toBe('seed');
    expect(r.scenario).toBe('busy-rep');
    expect(r.dbName).toBe(`${SEED_DB_PREFIX}busy-rep`);
    expect(getDbName()).toBe(`${SEED_DB_PREFIX}busy-rep`);
  });

  it('no-ops on a charset-invalid seed — DB name stays default', () => {
    _resetDbConnectionForTests();
    const r = activateSeedFromUrl('?seed=../evil');
    expect(r.mode).toBe('default');
    expect(r.scenario).toBeNull();
    expect(getDbName()).toBe('spear-events');
  });
});

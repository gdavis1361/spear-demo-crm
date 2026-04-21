import { describe, it, expect } from 'vitest';
import { canRead, maybeRedact, isRedacted, REDACTED, type Marking } from './marking';

describe('canRead', () => {
  const cases: Array<[Marking, Marking, boolean]> = [
    ['low', 'low', true],
    ['low', 'medium', false],
    ['low', 'high', false],
    ['medium', 'low', true],
    ['medium', 'medium', true],
    ['medium', 'high', false],
    ['high', 'low', true],
    ['high', 'medium', true],
    ['high', 'high', true],
    ['high', 'restricted', false],
    ['restricted', 'restricted', true],
    ['restricted', 'high', true],
  ];
  it.each(cases)('viewer %s vs target %s → %s', (viewer, target, expected) => {
    expect(canRead(viewer, target)).toBe(expected);
  });
});

describe('maybeRedact', () => {
  it('returns the value when cleared', () => {
    expect(maybeRedact({ clearance: 'high', projects: [] }, 'medium', 'secret')).toBe('secret');
  });

  it('returns REDACTED when under-cleared', () => {
    expect(maybeRedact({ clearance: 'low', projects: [] }, 'high', 'secret')).toBe(REDACTED);
  });
});

describe('isRedacted', () => {
  it('detects the sentinel', () => {
    expect(isRedacted(REDACTED)).toBe(true);
    expect(isRedacted('something')).toBe(false);
    expect(isRedacted(undefined)).toBe(false);
  });
});

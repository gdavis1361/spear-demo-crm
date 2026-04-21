import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';

// TB1 (lint-rule half) — lock in the ontology import guard. A future
// PR that lands a raw `AccountEvent` / `DealEvent` / `PromiseEvent` /
// `SignalEvent` import inside `src/screens/` or `src/components/`
// must produce a lint warning. If this test passes when the rule is
// missing, a silent disable slipped through.

const REPO_ROOT = process.cwd();

async function lintSource(source: string, virtualFilename: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    overrideConfigFile: join(REPO_ROOT, 'eslint.config.js'),
  });
  const [result] = await eslint.lintText(source, { filePath: virtualFilename });
  return result;
}

describe('ontology import guard (TB1)', () => {
  it('flags direct AccountEvent import in a screen', async () => {
    const result = await lintSource(
      `import type { AccountEvent } from '../domain/events';\nexport const x = 1;\nvoid (null as AccountEvent | null);\n`,
      'src/screens/account.tsx'
    );
    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('projection');
  });

  it('flags direct DealEvent import in a component', async () => {
    const result = await lintSource(
      `import type { DealEvent } from '../domain/events';\nexport const x = 1;\nvoid (null as DealEvent | null);\n`,
      'src/components/card.tsx'
    );
    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('allows the same import from a projection file', async () => {
    // src/domain/* is outside the restricted glob — the rule must not
    // fire there, because projections ARE the layer that's allowed to
    // work with raw event types.
    const result = await lintSource(
      `import type { AccountEvent } from './events';\nexport const x: AccountEvent | null = null;\n`,
      'src/domain/my-projection.ts'
    );
    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(violations).toHaveLength(0);
  });

  it('does not fire on other types from the same module', async () => {
    // StoredEvent is a generic envelope, not a PII-bearing payload.
    // The rule targets the specific payload types only.
    const result = await lintSource(
      `import type { StoredEvent } from '../domain/events';\nexport const x: StoredEvent | null = null;\n`,
      'src/screens/pipeline.tsx'
    );
    const violations = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(violations).toHaveLength(0);
  });
});

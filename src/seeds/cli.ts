#!/usr/bin/env node
/// <reference types="node" />
// Seed CLI — list, describe, and dry-run scenarios against an in-memory
// event log. Used for scenario development + CI gating; does not touch
// the user's real IndexedDB. A future PR will add browser-loadable runs
// via URL params + namespaced DB.
//
// Commands:
//   npm run seed list                 — print every registered scenario
//   npm run seed describe <name>      — print a scenario's descriptor
//   npm run seed run <name>           — run in-memory, print result + invariant outcome
//
// Flags (run only):
//   --rng=<n>                          — override default rngSeed
//   --no-invariants                    — skip invariant checks
//
// Exit codes: 0 success, 2 user error (bad args / unknown scenario), 1 scenario error.

import { InMemoryEventLog } from '../domain/events';
import { PromiseStore } from '../domain/promises';
import { registry } from './registry';
import { runScenario } from './runner';
import { scenarioName } from './types';
import { registerAllScenarios } from './scenarios';

type ParsedArgs = {
  readonly cmd: string | null;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
};

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) flags[a.slice(2)] = true;
      else flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] ?? null, positional: positional.slice(1), flags };
}

function printHelp(): void {
  console.log(`seed — scenario CLI

USAGE
  npm run seed list
  npm run seed describe <name>
  npm run seed run <name> [--rng=<n>] [--no-invariants]

All runs are in-memory; the user's IndexedDB is not touched.
`);
}

async function cmdList(): Promise<number> {
  const all = registry.describeAll();
  const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length));
  console.log(
    pad('NAME', 18) + pad('SCHEMA', 10) + pad('SEED', 8) + pad('TAGS', 28) + 'DESCRIPTION'
  );
  for (const d of all) {
    console.log(
      pad(d.name, 18) +
        pad(String(d.schemaVersion), 10) +
        pad(String(d.defaultRngSeed), 8) +
        pad((d.tags ?? []).slice(0, 3).join(','), 28) +
        d.description
    );
  }
  return 0;
}

async function cmdDescribe(name: string | undefined): Promise<number> {
  if (!name) {
    console.error('error: missing scenario name');
    return 2;
  }
  if (!registry.has(scenarioName(name))) {
    console.error(`error: unknown scenario "${name}"`);
    console.error(`known: ${registry.list().join(', ')}`);
    return 2;
  }
  const d = registry.describe(scenarioName(name));
  console.log(JSON.stringify(d, null, 2));
  return 0;
}

async function cmdRun(name: string | undefined, flags: ParsedArgs['flags']): Promise<number> {
  if (!name) {
    console.error('error: missing scenario name');
    return 2;
  }
  if (!registry.has(scenarioName(name))) {
    console.error(`error: unknown scenario "${name}"`);
    console.error(`known: ${registry.list().join(', ')}`);
    return 2;
  }

  const rngSeedFlag = flags['rng'];
  const rngSeed = typeof rngSeedFlag === 'string' ? parseInt(rngSeedFlag, 10) : undefined;
  if (rngSeed !== undefined && !Number.isFinite(rngSeed)) {
    console.error(`error: invalid --rng value "${rngSeedFlag}"`);
    return 2;
  }
  const runInvariants = !flags['no-invariants'];

  const log = new InMemoryEventLog();
  const promiseStore = new PromiseStore(log);
  await promiseStore.ready;

  try {
    const result = await runScenario(log, { promiseStore }, scenarioName(name), {
      ...(rngSeed !== undefined ? { rngSeed } : {}),
      runInvariants,
    });
    const deals = (await log.readPrefix('deal:')).filter(
      (e) => e.payload.kind === 'deal.created'
    ).length;
    const promises = promiseStore.list().length;
    console.log(JSON.stringify({ ...result, entities: { deals, promises } }, null, 2));
    return 0;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 1;
  }
}

async function main(): Promise<number> {
  registerAllScenarios();
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags['help'] === true || flags['h'] === true || cmd === 'help' || cmd === null) {
    printHelp();
    return 0;
  }

  switch (cmd) {
    case 'list':
      return cmdList();
    case 'describe':
      return cmdDescribe(positional[0]);
    case 'run':
      return cmdRun(positional[0], flags);
    default:
      console.error(`error: unknown command "${cmd}"`);
      printHelp();
      return 2;
  }
}

// Executed directly via `npm run seed`.
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('fatal:', err);
    process.exit(1);
  }
);

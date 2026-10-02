/**
 * Two imports of one directory, run together, record each decision once.
 *
 * Both read the record to plan — which files are already derived — before either wrote, so
 * both found every file new and the record came out holding each decision twice, with two
 * `derived-from` edges to one file. Not a race, for the reason
 * `core/src/workflow/the-second-move-sees-the-first.test.ts` gives: the case runs the other
 * import whole right after this one's plan was read, which is the stale reading the
 * concurrency produces. The plan is read through `withScopedCaches`, so that is where the
 * other import is let in.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import {
  DERIVED_FROM_RELATION,
  type DiscoveryEnv,
  orderedEvents,
  projectDecisions,
  projectLinks,
  resolveTrees,
} from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDecisionImport } from './decision-import.js';
import { runInit } from './init.js';

const race = vi.hoisted(() => ({
  other: undefined as (() => void) | undefined,
  inOther: false,
}));

vi.mock('../tree-sources.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tree-sources.js')>();
  return {
    ...real,
    withScopedCaches: ((...args: Parameters<typeof real.withScopedCaches>) => {
      const reading = real.withScopedCaches(...args);
      const other = race.other;
      if (other !== undefined && !race.inOther) {
        race.other = undefined;
        race.inOther = true;
        try {
          other();
        } finally {
          race.inOther = false;
        }
      }
      return reading;
    }) as typeof real.withScopedCaches,
  };
});

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-import-twice-'));
  race.other = undefined;
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  const adr = join(repo, 'docs', 'adr');
  mkdirSync(adr, { recursive: true });
  writeFileSync(
    join(adr, '0001-utc.md'),
    '# Use UTC everywhere\n\n## Context\n\nthe zone drifts\n',
  );
  writeFileSync(join(adr, '0002-ledger.md'), '# Credits are a ledger\n\n## Context\n\naudits\n');
  const env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

describe('two imports of one directory at once', () => {
  it('the second finds every file the first imported, and records nothing twice', () => {
    const { repo, env } = setup();
    let first: ReturnType<typeof runDecisionImport> | undefined;
    race.other = () => {
      first = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });
    };
    const second = runDecisionImport({ cwd: repo, env }, { from: 'docs/adr', write: true });

    expect(first).toMatchObject({ ok: true, wrote: true });
    expect(first?.ok === true ? first.proposals.length : -1).toBe(2);
    expect(second).toMatchObject({ ok: true, wrote: true, proposals: [] });
    expect(second.ok === true ? second.already.map((a) => a.path).sort() : []).toEqual([
      'docs/adr/0001-utc.md',
      'docs/adr/0002-ledger.md',
    ]);

    const root = resolveTrees(repo, env).projectPublic as string;
    const events = [...orderedEvents({ root }, catalogUpcasters())];
    expect(projectDecisions(events).size).toBe(2);
    expect(projectLinks(events).filter((l) => l.rel === DERIVED_FROM_RELATION)).toHaveLength(2);
    expect(verify(root, catalogUpcasters()).ok).toBe(true);
  });
});

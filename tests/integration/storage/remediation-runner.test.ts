import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import {
  type CloneConditionRemediation,
  RemediationRunner,
  type RemediationStep,
} from '@/storage/sqlite/remediation-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('RemediationRunner', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-remediation-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    // The runner reads/writes `applied_remediations`, created by migration 036.
    new MigrationRunner().run(adapter, migrationsDir);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Counts how many times a step's run() fired across a sequence of runs. */
  function countingStep(step: Omit<RemediationStep, 'run'>): {
    descriptor: RemediationStep;
    calls: () => number;
  } {
    let calls = 0;
    const descriptor = {
      ...step,
      run: () => {
        calls += 1;
        return `ran (${calls})`;
      },
    } as RemediationStep;
    return { descriptor, calls: () => calls };
  }

  it('runs a step once, records its row, and skips it (no-op) next run', () => {
    const runner = new RemediationRunner();
    const { descriptor, calls } = countingStep({
      name: 'demo-version-jump',
      kind: 'version-jump',
      introducedIn: '0.13.0',
      retiresAfter: '0.13.0',
    });

    const first = runner.run(adapter, [descriptor], '0.13.0');
    expect(calls()).toBe(1);
    expect(first[0]?.recorded).toBe(true);
    expect(runner.loadApplied(adapter)).toContain('demo-version-jump');

    const second = runner.run(adapter, [descriptor], '0.13.0');
    expect(calls()).toBe(1); // NOT re-run
    expect(second[0]?.skipped).toBe('already-applied');
  });

  it('skips a version-jump step once the project version is past its retiresAfter', () => {
    const runner = new RemediationRunner();
    const { descriptor, calls } = countingStep({
      name: 'retired-step',
      kind: 'version-jump',
      introducedIn: '0.10.0',
      retiresAfter: '0.10.0',
    });

    // The project is already at 0.14.0 — well past the 0.10.0 window.
    const outcomes = runner.run(adapter, [descriptor], '0.14.0');
    expect(calls()).toBe(0);
    expect(outcomes[0]?.skipped).toBe('expired');
    // Expired ≠ applied: it left no row (it may still matter to an older clone).
    expect(runner.loadApplied(adapter)).not.toContain('retired-step');
  });

  it('runs a version-jump step at exactly its retiresAfter (boundary is inclusive-run)', () => {
    const runner = new RemediationRunner();
    const { descriptor, calls } = countingStep({
      name: 'boundary-step',
      kind: 'version-jump',
      introducedIn: '0.13.0',
      retiresAfter: '0.13.0',
    });

    // gt(0.13.0, 0.13.0) is false → not retired → runs.
    runner.run(adapter, [descriptor], '0.13.0');
    expect(calls()).toBe(1);
  });

  describe('clone-condition permanence', () => {
    it('RUNS a clone-condition step on a fresh DB even at an absurd future version', () => {
      const runner = new RemediationRunner();
      const { descriptor, calls } = countingStep({
        name: 'permanent-step',
        kind: 'clone-condition',
        introducedIn: '0.13.0',
      });

      // Far past ANY notional window — a clone-condition step must still run,
      // because the git-ignored DB is rebuilt empty on every clone.
      const outcomes = runner.run(adapter, [descriptor], '999.0.0');
      expect(calls()).toBe(1);
      expect(outcomes[0]?.skipped).toBeUndefined(); // NOT expired
      expect(outcomes[0]?.recorded).toBe(true);
    });

    it('a fresh clone (empty applied_remediations) re-runs a clone-condition step at a far-future version', () => {
      const { descriptor, calls } = countingStep({
        name: 'clone-again',
        kind: 'clone-condition',
        introducedIn: '0.13.0',
      });

      // First DB lifetime: runs and records.
      new RemediationRunner().run(adapter, [descriptor], '999.0.0');
      expect(calls()).toBe(1);

      // Simulate a fresh clone: git-ignored state/ is gone, so the DB (and its
      // applied_remediations) is rebuilt empty. New adapter, new migrated DB.
      adapter.close();
      const cloneRoot = mkdtempSync(path.join(tmpdir(), 'mnema-remediation-clone-'));
      const cloneAdapter = new SqliteAdapter(path.join(cloneRoot, 'state.db'));
      new MigrationRunner().run(cloneAdapter, migrationsDir);
      try {
        const outcomes = new RemediationRunner().run(cloneAdapter, [descriptor], '999.0.0');
        // Ran AGAIN on the fresh clone despite the sky-high version — permanence.
        expect(calls()).toBe(2);
        expect(outcomes[0]?.recorded).toBe(true);
      } finally {
        cloneAdapter.close();
        rmSync(cloneRoot, { recursive: true, force: true });
      }
      // Reopen the original so afterEach's close() is valid.
      adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    });

    it('a clone-condition step cannot be declared with retiresAfter (type/runtime rejection)', () => {
      // TYPE ERROR: `retiresAfter` on a clone-condition step is typed `never`,
      // so the illegal "clone-condition that expires" cannot even be written —
      // the directive sits on the offending property itself.
      const illegal: CloneConditionRemediation = {
        name: 'illegal',
        kind: 'clone-condition',
        introducedIn: '0.13.0',
        // @ts-expect-error clone-condition steps may not carry retiresAfter
        retiresAfter: '0.13.0',
        run: () => 'x',
      };

      // Even if a caller casts past the type system (`as`), the runner never
      // consults retiresAfter for a clone-condition step, so such a step still
      // runs regardless of how high the version is — expiry is impossible.
      const runner = new RemediationRunner();
      const outcomes = runner.run(adapter, [illegal as RemediationStep], '999.0.0');
      expect(outcomes[0]?.skipped).toBeUndefined();
      expect(outcomes[0]?.recorded).toBe(true);
    });
  });

  it('mirror-ingest: as a clone-condition step it still runs on a far-future clone', () => {
    // The upgrade path wires `mirror-ingest` as clone-condition. Model that
    // exact descriptor and prove a simulated far-future clone (empty registry,
    // sky-high version) still runs it — the fresh-clone rebuild is never
    // expired away.
    const runner = new RemediationRunner();
    const { descriptor, calls } = countingStep({
      name: 'mirror-ingest',
      kind: 'clone-condition',
      introducedIn: '0.13.0',
    });

    const outcomes = runner.run(adapter, [descriptor], '999.0.0');
    expect(calls()).toBe(1);
    expect(outcomes[0]?.skipped).toBeUndefined();
    expect(outcomes[0]?.recorded).toBe(true);
  });

  it('does NOT record a step that reports it could not complete (applied: false)', () => {
    const runner = new RemediationRunner();
    let calls = 0;
    const step: RemediationStep = {
      name: 'refused-step',
      kind: 'clone-condition',
      introducedIn: '0.13.0',
      run: () => {
        calls += 1;
        return { applied: false, message: 'could not complete' };
      },
    };

    const first = runner.run(adapter, [step], '0.13.0');
    expect(first[0]?.recorded).toBe(false);
    expect(first[0]?.message).toBe('could not complete');
    expect(runner.loadApplied(adapter)).not.toContain('refused-step');

    // Still eligible: it is offered (and runs) again next time.
    runner.run(adapter, [step], '0.13.0');
    expect(calls).toBe(2);
  });

  describe('upgrade wiring pins the right kind per step', () => {
    // Pin the kind each upgrade remediation is declared with, so the
    // clone-condition permanence and version-jump expiry cannot silently flip.
    // Read the source and assert each name is followed by its kind within its
    // descriptor block (kind appears on the line after name in each block).
    const source = readFileSync(path.resolve('src/cli/commands/upgrade-command.ts'), 'utf-8');

    const kindOf = (name: string): string | null => {
      const idx = source.indexOf(`name: '${name}'`);
      if (idx === -1) return null;
      const after = source.slice(idx, idx + 700);
      const match = after.match(/kind: '(version-jump|clone-condition)'/);
      return match?.[1] ?? null;
    };

    it('mirror-ingest and mirror-reconcile are clone-condition (permanent)', () => {
      expect(kindOf('mirror-ingest')).toBe('clone-condition');
      expect(kindOf('mirror-reconcile')).toBe('clone-condition');
    });

    it('backfill-scope and gitattributes-retrofit are version-jump (expiry-eligible)', () => {
      expect(kindOf('backfill-scope')).toBe('version-jump');
      expect(kindOf('gitattributes-retrofit')).toBe('version-jump');
    });
  });

  it('loadApplied is empty before any step runs and reflects only recorded steps', () => {
    const runner = new RemediationRunner();
    expect(runner.loadApplied(adapter)).toEqual([]);

    runner.run(
      adapter,
      [{ name: 'a', kind: 'clone-condition', introducedIn: '0.13.0', run: () => 'ok' }],
      '0.13.0',
    );
    expect(runner.loadApplied(adapter)).toEqual(['a']);
  });
});

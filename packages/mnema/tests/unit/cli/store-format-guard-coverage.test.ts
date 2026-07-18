import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The store-format guard must gate EVERY mutating CLI path. Most mutations go
 * through `withMutatingCliContext` (which runs the guard). But a handful of
 * commands open a READ context (`withCliContext`) and still write — those must
 * call `enforceStoreFormat(ctx)` on their write branch by hand. History shows
 * this is easy to forget one command at a time (adopt/archive/agent/watch were
 * missed once, then `audit prune` was missed again), each a silent bypass of a
 * fail-closed guard. This source-scan fails if a known write-through-read
 * command loses its `enforceStoreFormat` call, catching the whole class.
 */
const COMMANDS_DIR = path.resolve('packages/mnema/src/cli/commands');

/** Commands that open a read context but mutate — each MUST enforce the guard. */
const WRITE_THROUGH_READ = [
  'audit-command.ts', // reattest --write, reconcile --force, accept-truncation --force, prune --force
  'adopt-command.ts',
  'archive-command.ts',
  'agent-command.ts', // close-orphans --apply, resume
  'watch-command.ts',
  'upgrade-command.ts', // reconcile path: writes the marker instead of enforcing
];

describe('store-format guard covers every write-through-read command', () => {
  for (const file of WRITE_THROUGH_READ) {
    it(`${file} enforces or reconciles the store-format marker`, () => {
      const src = readFileSync(path.join(COMMANDS_DIR, file), 'utf-8');
      // Either it gates a mutation (enforceStoreFormat) or, for the reconcile
      // paths, it rewrites the marker (writeStoreFormatMarker) — both are the
      // sanctioned ways a write-through-read command respects the guard.
      const guarded =
        src.includes('enforceStoreFormat(') || src.includes('writeStoreFormatMarker(');
      expect(guarded, `${file} mutates through a read context but never touches the guard`).toBe(
        true,
      );
    });
  }

  it('audit prune specifically gates its --force apply branch', () => {
    // The regression that motivated this test: prune was the one mutating audit
    // subcommand without the guard. Pin it — the LAST enforceStoreFormat before
    // applyPrune must sit between the prune dry-run return and the apply.
    const src = readFileSync(path.join(COMMANDS_DIR, 'audit-command.ts'), 'utf-8');
    const applyAt = src.indexOf('applyPrune({');
    expect(applyAt).toBeGreaterThan(-1);
    // The guard call immediately governing the prune apply is the last
    // enforceStoreFormat at or before applyPrune.
    const guardBeforeApply = src.lastIndexOf('enforceStoreFormat(ctx)', applyAt);
    expect(guardBeforeApply).toBeGreaterThan(-1);
    // And it is inside the prune action (after the prune dry-run early return),
    // not an earlier command's guard leaking in.
    const pruneDryRunReturn = src.indexOf(
      '(dry run — re-run with --force to apply)',
      src.indexOf('nothing to prune'),
    );
    expect(guardBeforeApply).toBeGreaterThan(pruneDryRunReturn);
  });
});

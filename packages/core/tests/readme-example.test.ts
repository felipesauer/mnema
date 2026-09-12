/**
 * The README's usage example, RUN — and run as the very bytes the page publishes.
 *
 * WHAT THIS FILE IS HALF OF. The region between the two markers below is compared, line
 * for line, against the ```ts block of `../README.md` by
 * `packages/code/tests/the-example-is-read-from-the-page.test.ts`. That comparison is
 * what makes this case a guard over the PUBLISHED example rather than over a private
 * translation of it: a name changed on the page and left alone here turns the suite red,
 * and so does the reverse.
 *
 * WHAT IT CAUGHT THE DAY IT WAS WRITTEN, AND WHAT NOW KEEPS CATCHING IT. The published
 * example did not compile, and it was wrong about the design in three separate ways. That
 * was measured once, by hand, on 11/09/2026 by type-checking the extracted block against
 * the built `.d.ts`; it is a case now — `code/tests/the-example-is-type-checked.test.ts`
 * does that reading on every run. Both errors below were put back, on the page and here
 * together, to check that it does. What it found: `createTask` and
 * `transitionTask` were imported from `@mnema/core`, where neither is exported — they
 * live on `@mnema/core/write`, and the split is the structural boundary that lets a
 * read-only consumer depend on this package without being able to name a writer. The
 * example then passed `id` and `who` to `createTask`, which takes neither: the id is
 * MINTED inside (two offline clones must never mint the same one) and `who` is derived
 * from the writing key (an anchor cannot be forged by typing a name). And it called
 * `openChainForWriting` with one argument where the signature takes two.
 *
 * WHY THE ROOTS ARE ELIDED AND NOTHING ELSE IS. The two `const` lines that name the
 * directories are declared as elisions in the comparison, with their reason, because a
 * case that ran the page's literal `.mnema/chain` would found an identity and write
 * events inside this repository. Every other line is compared verbatim.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import { ProjectionCache } from '../src/index.js';
import { createTask, transitionTask } from '../src/write.js';

describe('README example', () => {
  it('runs exactly as documented', () => {
    // (The page names two directories; this case points them at sandboxes of its own so
    // that running the documentation never founds an identity in the working tree.)
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-core-readme-'));
    const root = join(sandbox, 'chain');
    const keyRoot = join(sandbox, 'keys');
    let opened: ProjectionCache | undefined;

    try {
      // ---- README example begins ----
      // A write reads state from the chain and appends to it; the context names both.
      const writer = openChainForWriting(root, { keyRoot });
      const ctx = { writer, layout: { root }, upcasters: catalogUpcasters() };

      // Create a task and move it — each write runs the gate first. The caller supplies
      // neither the id nor the author. The id is MINTED here, from randomness, so two
      // offline clones never mint the same one; `who` is derived from the writing key,
      // so authorship cannot be forged by typing a name. `which` — the agent that
      // carried the work out — IS the caller's, because an agent has no key.
      const created = createTask(ctx, { title: 'Ship the parser', which: 'claude' });
      if (created.ok) {
        // DRAFT → READY: `submit` requires no proof fields, so none are needed. The id
        // to move with is the one the create handed back.
        transitionTask(ctx, { id: created.id, action: 'submit', which: 'claude' });
        // An action that carries proof supplies it — e.g. cancelling requires a reason:
        // transitionTask(ctx, { id: created.id, action: 'cancel', which: 'claude',
        //   fields: { reason: 'superseded by a new approach' } });
      }

      // Read state from the cache — rebuilt from the chain, never authored directly.
      const cache = ProjectionCache.open(root);
      cache.rebuild();
      const task = created.ok ? cache.getTask(created.id) : null;
      // task is { id, title, state: 'READY', … }, or null for an id nothing created.
      // ---- README example ends ----

      opened = cache;
      expect(created.ok).toBe(true);
      expect(task).toMatchObject({ title: 'Ship the parser', state: 'READY' });
    } finally {
      opened?.close();
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

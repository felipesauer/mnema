/**
 * `mnema show` of a record two machines moved apart says so, beside the state it prints.
 *
 * The two machines are made the way two clones make them: the project's tree is copied while
 * the task is `IN_PROGRESS`, each copy moves it with its own key, and the copy's tail and key
 * arrive in the first tree as a pull would bring them. Every event in it is one the product's
 * own operations appended.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { createTask, openTreeForWriting, transitionTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { divergenceNotice } from '../wiring/integrity.js';
import { runInit } from './init.js';
import { runShow } from './show.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-show-apart-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * A clock that moves one second per reading, from `start` seconds into 2030 — after the
 * `init` that founded the tree on the real clock, so the merged order across the two tails is
 * the order the moves were made in.
 */
function ticking(start: number): () => string {
  let t = start;
  return () => {
    t += 1;
    return new Date(Date.UTC(2030, 0, 1, 0, 0, t)).toISOString();
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function project(): { repo: string; env: DiscoveryEnv; root: string } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env, root: resolveTrees(repo, env).projectPublic as string };
}

describe('show of a record moved apart', () => {
  it('says the task left IN_PROGRESS twice, and both moves, while printing the last', () => {
    const { repo, env, root } = project();
    const upcasters = catalogUpcasters();
    const here = {
      writer: openTreeForWriting(resolveTrees(repo, env), 'public'),
      layout: { root },
      upcasters,
      clock: ticking(0),
    };
    const { id } = ok(createTask(here, { title: 'Ship it' }));
    ok(transitionTask(here, { id, action: 'submit' }));
    ok(transitionTask(here, { id, action: 'start' }));
    here.writer.checkpoint();

    const cloneRoot = join(sandbox, 'clone-tree');
    cpSync(root, cloneRoot, { recursive: true });
    const clone = {
      writer: openChainForWriting(cloneRoot, { keyRoot: join(sandbox, 'clone-key') }),
      layout: { root: cloneRoot },
      upcasters,
      clock: ticking(100),
    };
    ok(transitionTask(here, { id, action: 'complete', fields: { note: 'shipped' } }));
    ok(transitionTask(clone, { id, action: 'block', fields: { reason: 'waiting on review' } }));
    here.writer.checkpoint();
    clone.writer.checkpoint();
    cpSync(join(cloneRoot, 'tails', clone.writer.tail), join(root, 'tails', clone.writer.tail), {
      recursive: true,
    });
    cpSync(join(cloneRoot, 'keys'), join(root, 'keys'), { recursive: true });

    const shown = runShow({ cwd: repo, env }, { id });
    if (!shown.ok) throw new Error(`show refused: ${shown.reason}`);
    expect(shown.record.kind).toBe('task');
    expect(shown.record.kind === 'task' && shown.record.record.state).toBe('BLOCKED');
    expect(shown.divergent).toHaveLength(1);
    expect(shown.divergent[0]).toMatchObject({ kind: 'task', entityId: id, from: 'IN_PROGRESS' });

    const said = divergenceNotice(shown.divergent).map((line) =>
      line.parts.map((part) => part.text).join(''),
    );
    expect(said).toEqual([
      'this task left IN_PROGRESS more than once, by moves that did not see each other: to DONE, then BLOCKED. Each is a signed fact of the record; the state shown is the last of them in its order.',
    ]);
  });

  it('says nothing of a record moved in one line', () => {
    const { repo, env, root } = project();
    const here = {
      writer: openTreeForWriting(resolveTrees(repo, env), 'public'),
      layout: { root },
      upcasters: catalogUpcasters(),
      clock: ticking(0),
    };
    const { id } = ok(createTask(here, { title: 'Ship it' }));
    ok(transitionTask(here, { id, action: 'submit' }));
    here.writer.checkpoint();
    const shown = runShow({ cwd: repo, env }, { id });
    expect(shown.ok && shown.divergent).toEqual([]);
    expect(divergenceNotice([])).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, taskBirth, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectTasks, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTask } from './task.js';
import { runTaskTransition } from './task-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-move-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Creates a project and one task, returning the task's id for a move. */
function projectWithTask(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const created = runTask({ cwd: repo, env }, { title: 'a task' });
  if (!created.ok) throw new Error('setup: task create refused');
  return { repo, env, id: created.id };
}

/** Reads a task's current state from the public chain. */
function stateOf(repo: string, env: DiscoveryEnv, id: string): string | undefined {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectTasks(orderedEvents({ root }, catalogUpcasters())).get(id)?.state;
}

describe('mnema task move', () => {
  it('moves a DRAFT task through submit → start and reports each new state', () => {
    const { repo, env, id } = projectWithTask();

    const submitted = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    expect(submitted).toMatchObject({ ok: true, to: 'READY' });
    expect(stateOf(repo, env, id)).toBe('READY');

    const started = runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    expect(started).toMatchObject({ ok: true, to: 'IN_PROGRESS' });
    if (started.ok) expect(started.alias).toMatch(/^t-[0-9a-f]{4}$/);
    expect(stateOf(repo, env, id)).toBe('IN_PROGRESS');
  });

  it('carries a required proof field through to the gate (complete needs a note)', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    runTaskTransition({ cwd: repo, env }, { id, action: 'start' });

    const completed = runTaskTransition(
      { cwd: repo, env },
      { id, action: 'complete', proof: { note: 'shipped in v1' } },
    );
    expect(completed).toMatchObject({ ok: true, to: 'DONE' });
    expect(stateOf(repo, env, id)).toBe('DONE');
  });

  it('leaves the tree fully signed after a move', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('reports the gate refusal for an illegal move (start from DRAFT)', () => {
    const { repo, env, id } = projectWithTask();
    // DRAFT → start is not a legal move (must submit to READY first).
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ILLEGAL_TRANSITION' });
    // Nothing was written: the task is still DRAFT.
    expect(stateOf(repo, env, id)).toBe('DRAFT');
  });

  it('reports the gate refusal when a required proof field is missing', () => {
    const { repo, env, id } = projectWithTask();
    runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    runTaskTransition({ cwd: repo, env }, { id, action: 'start' });
    // complete requires a note; none given.
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'complete' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
    expect(stateOf(repo, env, id)).toBe('IN_PROGRESS');
  });

  it('reports the gate refusal for an unknown action (the surface does not validate it)', () => {
    const { repo, env, id } = projectWithTask();
    const result = runTaskTransition({ cwd: repo, env }, { id, action: 'frobnicate' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ACTION' });
  });

  it('refuses UNKNOWN_TASK for an id no visible tree holds (located, not reached)', () => {
    // The task does not exist, so the move is refused BEFORE the operation runs:
    // the surface located no home tree, so it never opens a writer. This is the
    // routing refusal, distinct from the gate's own UNKNOWN_TASK on a reached op.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runTaskTransition(
      { cwd: repo, env },
      { id: '00000000-0000-7000-8000-000000000000', action: 'submit' },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_TASK' });
  });

  it('refuses with NO_PROJECT when there is no project and no global home', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runTaskTransition({ cwd: orphan, env }, { id: 'anything', action: 'submit' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});

describe('mnema task move — the transition follows the entity (coherence, S2)', () => {
  it('moves a task born in PUBLIC in the PUBLIC tree, leaving PRIVATE empty', () => {
    // The CLI create is born public; the move must follow it there. The private
    // tree must never receive the transition (that would split the history).
    const { repo, env, id } = projectWithTask();
    const moved = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    const trees = resolveTrees(repo, env);
    const publicEvents = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    // Birth pair (created + birth transition) + the submit transition = 3 events,
    // ALL in public: created and transitioned share one tree — history is whole.
    expect(publicEvents.map((e) => e.kind)).toEqual([
      'task.created',
      'task.transitioned',
      'task.transitioned',
    ]);

    // Neutralization: without the routing read the move could land in a different
    // tree; here the private tree has NO event for this task.
    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateEvents).toEqual([]);
  });

  it('moves a task born in PRIVATE in the PRIVATE tree, never touching PUBLIC', () => {
    // A task born in the private tree (as an agent's write would be) must be
    // moved in private — routing to public would split its history and leak a
    // private task's move to the team. The CLI create only writes public today,
    // so the private birth is written directly, then the CLI move is exercised.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    // Write a real DRAFT task birth into the PRIVATE tree. A canonical v7 id
    // stands in for a minted one (the create operation mints; a reference is
    // supplied verbatim).
    const w = openTreeForWriting(trees, 'private');
    const id = '01920000-0000-7000-8000-00000000abcd';
    const at = '2026-07-23T00:00:00.000Z';
    w.appendAll(
      taskBirth(
        { at, who: w.anchor, signerFp: w.signerFingerprint, subject: id },
        { title: 'a private task', initial: 'DRAFT' },
      ),
    );
    w.checkpoint();

    // The CLI move — with the old hardcoded 'public', this would refuse
    // UNKNOWN_TASK (the task is not in public). Following the entity, it moves it
    // in private.
    const moved = runTaskTransition({ cwd: repo, env }, { id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    // created + birth transition + submit — all in private.
    expect(privateEvents.map((e) => e.kind)).toEqual([
      'task.created',
      'task.transitioned',
      'task.transitioned',
    ]);

    // Public never received the transition — history not split.
    const publicEvents = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(publicEvents).toEqual([]);
  });
});

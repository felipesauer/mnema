/**
 * The CLI end to end: the real `run` entry (the same path the binary takes)
 * drives init → task → verify in a sandbox, proving the full loop
 * adapter → gate → chain → verify walks.
 *
 * It exercises `run` with an injected io and a sandboxed working directory and
 * environment, so no process is spawned and nothing touches the real streams or
 * the real app data directory.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { listProjects, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** Captures the CLI's output and whether it signalled failure. */
function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cli-e2e-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema CLI — init → task → verify, end to end', () => {
  it('walks the full loop: init creates a tree, task adds an event, verify is ok', async () => {
    // 1. init establishes the project.
    const i = capture();
    await run(['init'], i.io);
    expect(i.failed()).toBe(false);
    expect(i.out.join('\n')).toContain('Initialized mnema project');
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
    // The project is in the machine index.
    expect(
      listProjects({ xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') }).length,
    ).toBe(1);

    // 2. task adds an event through the gate.
    const t = capture();
    await run(['task', 'ship the CLI'], t.io);
    expect(t.failed()).toBe(false);
    expect(t.out.join('\n')).toMatch(/Created task t-[0-9a-f]{4}/);

    // The event really landed: founding + birth pair + the task's checkpoints.
    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    const events = orderedEvents({ root }, catalogUpcasters());
    expect(events.some((e) => e.kind === 'task.created')).toBe(true);

    // 3. verify proves it, ok and fully signed.
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    expect(v.out.join('\n')).toContain('local integrity verified');
    expect(verify(root).fullySigned).toBe(true);
  });

  it('walks a task through its states: init → create → submit → start → complete → verify', async () => {
    await run(['init'], capture().io);

    // Create, and read the id back out of the CLI's own output.
    const c = capture();
    await run(['task', 'ship the feature'], c.io);
    const match = c.out.join('\n').match(/Created task t-[0-9a-f]{4} \(([0-9a-f-]{36})\)/);
    expect(match).not.toBeNull();
    const id = (match as RegExpMatchArray)[1] as string;

    // Move it forward through the workflow via the generic `task move`.
    const submit = capture();
    await run(['task', 'move', 'submit', id], submit.io);
    expect(submit.failed()).toBe(false);
    expect(submit.out.join('\n')).toMatch(/→ READY$/);

    const start = capture();
    await run(['task', 'move', 'start', id], start.io);
    expect(start.failed()).toBe(false);
    expect(start.out.join('\n')).toMatch(/→ IN_PROGRESS$/);

    const complete = capture();
    await run(['task', 'move', 'complete', id, '--note', 'done and shipped'], complete.io);
    expect(complete.failed()).toBe(false);
    expect(complete.out.join('\n')).toMatch(/→ DONE$/);

    // The chain that recorded the whole journey still verifies, fully signed.
    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    expect(verify(root).ok).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('keeps a task WHOLE in one tree: create + every move land together, private stays empty', async () => {
    // The study's probe, inverted: prove the history is NOT split. A CLI task is
    // born public and every move follows it there; the private tree — which the
    // agent would have written to under the old fixed scope — receives nothing,
    // so the team (who reads only public) sees the whole history.
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
    await run(['task', 'move', 'submit', id], capture().io);
    await run(['task', 'move', 'start', id], capture().io);

    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const publicForTask = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    // created + birth transition + submit + start — the full journey, all public.
    expect(publicForTask.map((e) => e.kind)).toEqual([
      'task.created',
      'task.transitioned',
      'task.transitioned',
      'task.transitioned',
    ]);

    // The private tree has no event for this task at all — nothing was split off.
    const privateRoot = trees.projectPrivate as string;
    const privateForTask = existsSync(privateRoot)
      ? orderedEvents({ root: privateRoot }, catalogUpcasters()).filter((e) => e.subject === id)
      : [];
    expect(privateForTask).toEqual([]);
  });

  it('--scope private on create routes the birth to the private tree', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'a private draft', '--scope', 'private'], c.io);
    expect(c.failed()).toBe(false);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    // The task is in PRIVATE, not in the team's public tree.
    const privateForTask = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateForTask.map((e) => e.kind)).toContain('task.created');
    // The public tree has no event for this task — the override truly routed it.
    const publicRoot = trees.projectPublic as string;
    const publicForTask = existsSync(publicRoot)
      ? orderedEvents({ root: publicRoot }, catalogUpcasters()).filter((e) => e.subject === id)
      : [];
    expect(publicForTask).toEqual([]);
  });

  it('--scope global on create works with no project', async () => {
    // No init — an orphan directory. Global needs no project.
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const c = capture();
    await run(['task', 'a cross-project lesson', '--scope', 'global'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toMatch(/Created task t-[0-9a-f]{4}/);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    const trees = resolveTrees(orphan, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const globalForTask = orderedEvents({ root: trees.global }, catalogUpcasters()).filter(
      (e) => e.subject === id,
    );
    expect(globalForTask.map((e) => e.kind)).toContain('task.created');
  });

  it('--scope public with no project refuses (the guard is on the resolved scope)', async () => {
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const c = capture();
    await run(['task', 'homeless public', '--scope', 'public'], c.io);
    expect(c.failed()).toBe(true);
    expect(c.err.join('\n')).toContain('Run `mnema init`');
  });

  it('an unknown --scope value is a usage error the CLI reports itself', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'a task', '--scope', 'team'], c.io);
    expect(c.failed()).toBe(true);
    expect(c.err.join('\n')).toContain('Invalid --scope "team"');
    // Nothing was born: no task event in any tree.
    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const publicEvents = existsSync(trees.projectPublic as string)
      ? orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters())
      : [];
    expect(publicEvents.some((e) => e.kind === 'task.created')).toBe(false);
  });

  it('`task move` takes no scope: a move follows the entity, not a flag', async () => {
    // The invariant: the override is a NASCIMENTO-only knob. `move` never accepts
    // --scope; passing one is a usage error, so a caller cannot re-home a move.
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    const m = capture();
    await run(['task', 'move', 'submit', id, '--scope', 'private'], m.io);
    expect(m.failed()).toBe(true);
  });

  it('an illegal move prints the gate refusal and signals failure', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'a task'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    // start from DRAFT is illegal — the gate refuses, the CLI prints it and fails.
    const bad = capture();
    await run(['task', 'move', 'start', id], bad.io);
    expect(bad.failed()).toBe(true);
    expect(bad.err.join('\n')).toContain('Refused (ILLEGAL_TRANSITION)');
  });

  it('task before init refuses and signals failure', async () => {
    const t = capture();
    await run(['task', 'homeless'], t.io);
    expect(t.failed()).toBe(true);
    expect(t.err.join('\n')).toContain('Run `mnema init`');
  });

  it('verify before init refuses and signals failure', async () => {
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(true);
    expect(v.err.join('\n')).toContain('Run `mnema init`');
  });

  it('a second init does not re-found, and says so', async () => {
    await run(['init'], capture().io);
    const again = capture();
    await run(['init'], again.io);
    expect(again.failed()).toBe(false);
    expect(again.out.join('\n')).toContain('Already a mnema project');
  });

  it('--help prints usage without signalling failure', async () => {
    const h = capture();
    await run(['--help'], h.io);
    expect(h.failed()).toBe(false);
    expect(h.out.join('\n')).toContain('init');
    expect(h.out.join('\n')).toContain('task');
    expect(h.out.join('\n')).toContain('verify');
  });

  it('an unknown command signals failure', async () => {
    const u = capture();
    await run(['frobnicate'], u.io);
    expect(u.failed()).toBe(true);
  });
});

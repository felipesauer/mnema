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
import {
  listProjects,
  orderedEvents,
  projectDecisions,
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
  projectSkills,
  resolveTrees,
} from '@mnema/core';
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
    expect(h.out.join('\n')).toContain('decision');
    expect(h.out.join('\n')).toContain('skill');
    expect(h.out.join('\n')).toContain('memory');
    expect(h.out.join('\n')).toContain('observe');
    expect(h.out.join('\n')).toContain('handoff');
    expect(h.out.join('\n')).toContain('link');
    expect(h.out.join('\n')).toContain('verify');
  });

  it('an unknown command signals failure', async () => {
    const u = capture();
    await run(['frobnicate'], u.io);
    expect(u.failed()).toBe(true);
  });
});

describe('mnema CLI — decision, end to end', () => {
  /** Reads the id out of a `Recorded decision ADR-n (<id>)` line. */
  function idOf(out: string): string {
    return (out.match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
  }

  it('records a decision, prints its ADR (not an alias), and verifies', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['decision', 'adopt the ledger', 'it is the audit surface'], c.io);
    expect(c.failed()).toBe(false);
    // The human name is the ADR — never a `t-xxxx`-style alias, which a decision
    // does not have. The output is `ADR-<n> (<uuid>)`: the label and the id, and
    // no alias in between.
    expect(c.out.join('\n')).toMatch(/^Recorded decision ADR-1 \([0-9a-f-]{36}\)$/);

    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    expect(
      orderedEvents({ root }, catalogUpcasters()).some((e) => e.kind === 'decision.recorded'),
    ).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('records both a title AND a rationale — a missing rationale is a parser error', async () => {
    await run(['init'], capture().io);
    const c = capture();
    // Only the title given; the rationale positional is missing.
    await run(['decision', 'only a title'], c.io);
    expect(c.failed()).toBe(true);
  });

  it('accepts a decision with a note and prints ADR → accepted', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['decision', 'a call', 'because'], c.io);
    const id = idOf(c.out.join('\n'));

    const a = capture();
    await run(['decision', 'move', 'accept', id, '--note', 'we adopt it'], a.io);
    expect(a.failed()).toBe(false);
    expect(a.out.join('\n')).toMatch(/^Decision ADR-1 → accepted$/);
  });

  it('accept without a note prints the gate refusal and fails', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['decision', 'a call', 'because'], c.io);
    const id = idOf(c.out.join('\n'));

    const a = capture();
    await run(['decision', 'move', 'accept', id], a.io);
    expect(a.failed()).toBe(true);
    expect(a.err.join('\n')).toContain('Refused (MISSING_PROOF)');
  });

  it('supersede <old> <new> --reason links supersededBy, and verifies', async () => {
    await run(['init'], capture().io);
    const o = capture();
    await run(['decision', 'old approach', 'r1'], o.io);
    const oldId = idOf(o.out.join('\n'));
    const n = capture();
    await run(['decision', 'new approach', 'r2'], n.io);
    const newId = idOf(n.out.join('\n'));

    const s = capture();
    await run(['decision', 'supersede', oldId, newId, '--reason', 'a better way'], s.io);
    expect(s.failed()).toBe(false);
    expect(s.out.join('\n')).toMatch(/^Decision ADR-1 → superseded$/);

    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    const d = projectDecisions(orderedEvents({ root }, catalogUpcasters())).get(oldId);
    expect(d?.state).toBe('superseded');
    expect(d?.supersededBy).toBe(newId);
    expect(verify(root).ok).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('supersede without a reason prints the gate refusal and fails', async () => {
    await run(['init'], capture().io);
    const o = capture();
    await run(['decision', 'old', 'r1'], o.io);
    const oldId = idOf(o.out.join('\n'));
    const n = capture();
    await run(['decision', 'new', 'r2'], n.io);
    const newId = idOf(n.out.join('\n'));

    const s = capture();
    await run(['decision', 'supersede', oldId, newId], s.io);
    expect(s.failed()).toBe(true);
    expect(s.err.join('\n')).toContain('Refused (MISSING_PROOF)');
  });

  it('supersede of a decision that does not exist reports UNKNOWN_DECISION', async () => {
    await run(['init'], capture().io);
    const n = capture();
    await run(['decision', 'new', 'r'], n.io);
    const newId = idOf(n.out.join('\n'));

    const s = capture();
    await run(
      ['decision', 'supersede', '00000000-0000-7000-8000-000000000000', newId, '--reason', 'x'],
      s.io,
    );
    expect(s.failed()).toBe(true);
    expect(s.err.join('\n')).toContain('No decision');
  });

  it('`decision move` takes no --scope: a move follows the entity', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['decision', 'a call', 'because'], c.io);
    const id = idOf(c.out.join('\n'));

    const m = capture();
    await run(['decision', 'move', 'accept', id, '--note', 'x', '--scope', 'private'], m.io);
    expect(m.failed()).toBe(true);
  });

  it('--scope private on record routes the birth to the private tree', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['decision', 'a private call', 'this machine', '--scope', 'private'], c.io);
    expect(c.failed()).toBe(false);
    const id = idOf(c.out.join('\n'));

    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const privateForDecision = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateForDecision.map((e) => e.kind)).toContain('decision.recorded');
    const publicRoot = trees.projectPublic as string;
    const publicForDecision = existsSync(publicRoot)
      ? orderedEvents({ root: publicRoot }, catalogUpcasters()).filter((e) => e.subject === id)
      : [];
    expect(publicForDecision).toEqual([]);
  });

  it('decision before init refuses and signals failure', async () => {
    const d = capture();
    await run(['decision', 'homeless', 'no project'], d.io);
    expect(d.failed()).toBe(true);
    expect(d.err.join('\n')).toContain('Run `mnema init`');
  });
});

describe('mnema CLI — skill, end to end', () => {
  /** Reads the id out of a `Proposed skill "<name>" (<id>)` line. */
  function idOf(out: string): string {
    return (out.match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
  }

  it('proposes a skill, prints its name and id (no alias), and verifies', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'stacked-prs', '--body', 'One slice per PR; merge before the next.'], c.io);
    expect(c.failed()).toBe(false);
    // The output is `"<name>" (<uuid>)`: the display name and the key, no alias.
    expect(c.out.join('\n')).toMatch(/^Proposed skill "stacked-prs" \([0-9a-f-]{36}\)$/);

    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    expect(
      orderedEvents({ root }, catalogUpcasters()).some((e) => e.kind === 'skill.created'),
    ).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('--body is required — a missing --body is a usage error, nothing is born', async () => {
    await run(['init'], capture().io);
    const c = capture();
    // Only the name given; the body flag is missing.
    await run(['skill', 'no-body'], c.io);
    expect(c.failed()).toBe(true);
    // Nothing was born: no skill event in the public tree.
    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const publicEvents = existsSync(trees.projectPublic as string)
      ? orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters())
      : [];
    expect(publicEvents.some((e) => e.kind === 'skill.created')).toBe(false);
  });

  it('walks a skill through its cycle: propose → review → adopt → deprecate → verify', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'a-habit', '--body', 'do the thing'], c.io);
    const id = idOf(c.out.join('\n'));

    const review = capture();
    await run(['skill', 'move', 'review', id, '--note', 'looks sound'], review.io);
    expect(review.failed()).toBe(false);
    expect(review.out.join('\n')).toMatch(/^Skill "a-habit" → reviewed$/);

    const adopt = capture();
    await run(['skill', 'move', 'adopt', id, '--note', 'we use it'], adopt.io);
    expect(adopt.failed()).toBe(false);
    expect(adopt.out.join('\n')).toMatch(/→ adopted$/);

    const deprecate = capture();
    await run(['skill', 'move', 'deprecate', id, '--reason', 'replaced'], deprecate.io);
    expect(deprecate.failed()).toBe(false);
    expect(deprecate.out.join('\n')).toMatch(/→ deprecated$/);

    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    expect(verify(root).ok).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('review without a note prints the gate refusal and fails', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'a-habit', '--body', 'x'], c.io);
    const id = idOf(c.out.join('\n'));

    const r = capture();
    await run(['skill', 'move', 'review', id], r.io);
    expect(r.failed()).toBe(true);
    expect(r.err.join('\n')).toContain('Refused (MISSING_PROOF)');
  });

  it('an unknown action is UNKNOWN_ACTION — never a silent transition', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'a-habit', '--body', 'x'], c.io);
    const id = idOf(c.out.join('\n'));

    const bad = capture();
    await run(['skill', 'move', 'frobnicate', id], bad.io);
    expect(bad.failed()).toBe(true);
    expect(bad.err.join('\n')).toContain('Refused (UNKNOWN_ACTION)');
  });

  it('move of a skill that does not exist reports UNKNOWN_SKILL', async () => {
    await run(['init'], capture().io);
    const m = capture();
    await run(
      ['skill', 'move', 'review', '00000000-0000-7000-8000-000000000000', '--note', 'x'],
      m.io,
    );
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('No skill');
  });

  it('`skill move` takes no --scope: a move follows the entity', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'a-habit', '--body', 'x'], c.io);
    const id = idOf(c.out.join('\n'));

    const m = capture();
    await run(['skill', 'move', 'review', id, '--note', 'x', '--scope', 'private'], m.io);
    expect(m.failed()).toBe(true);
  });

  it('--scope private on propose routes the birth to the private tree', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['skill', 'a-private-habit', '--body', 'this machine', '--scope', 'private'], c.io);
    expect(c.failed()).toBe(false);
    const id = idOf(c.out.join('\n'));

    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const privateForSkill = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateForSkill.map((e) => e.kind)).toContain('skill.created');
    const publicRoot = trees.projectPublic as string;
    const publicForSkill = existsSync(publicRoot)
      ? orderedEvents({ root: publicRoot }, catalogUpcasters()).filter((e) => e.subject === id)
      : [];
    expect(publicForSkill).toEqual([]);
    // The projection reads it back by id, name as display.
    expect(projectSkills(privateForSkill).get(id)?.name).toBe('a-private-habit');
  });

  it('skill before init refuses and signals failure', async () => {
    const s = capture();
    await run(['skill', 'homeless', '--body', 'no project'], s.io);
    expect(s.failed()).toBe(true);
    expect(s.err.join('\n')).toContain('Run `mnema init`');
  });
});

describe('mnema CLI — knowledge (memory, observe, handoff, link), end to end', () => {
  function treesOf() {
    return resolveTrees(repo, { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') });
  }

  it('memory captures a fact, prints its id, lands in public, and verifies', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['memory', 'the auth flow uses PKCE'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toMatch(/^Captured memory [0-9a-f-]{36}$/);
    const id = (c.out.join('\n').match(/([0-9a-f-]{36})/) as RegExpMatchArray)[1] as string;

    const root = treesOf().projectPublic as string;
    expect(projectKnowledge(orderedEvents({ root }, catalogUpcasters())).get(id)?.content).toBe(
      'the auth flow uses PKCE',
    );
    expect(verify(root).fullySigned).toBe(true);
  });

  it('memory --scope private lands in private, not public (parity with the MCP tool)', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['memory', 'this machine only', '--scope', 'private'], c.io);
    expect(c.failed()).toBe(false);
    const id = (c.out.join('\n').match(/([0-9a-f-]{36})/) as RegExpMatchArray)[1] as string;
    const trees = treesOf();
    expect(
      projectKnowledge(
        orderedEvents({ root: trees.projectPrivate as string }, catalogUpcasters()),
      ).has(id),
    ).toBe(true);
    const publicRoot = trees.projectPublic as string;
    const publicMems = existsSync(publicRoot)
      ? projectKnowledge(orderedEvents({ root: publicRoot }, catalogUpcasters()))
      : new Map();
    expect(publicMems.has(id)).toBe(false);
  });

  it('observe records an observation about an entity (dangling `about` accepted), and verifies', async () => {
    await run(['init'], capture().io);
    const c = capture();
    // `about` names an entity that does not exist — accepted, not refused.
    await run(
      ['observe', '00000000-0000-7000-8000-000000000000', '--topic', 'perf', '--text', 'O(n^2)'],
      c.io,
    );
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toMatch(/^Recorded observation [0-9a-f-]{36} about /);
    const id = (
      c.out.join('\n').match(/observation ([0-9a-f-]{36})/) as RegExpMatchArray
    )[1] as string;

    const root = treesOf().projectPublic as string;
    const o = projectObservations(orderedEvents({ root }, catalogUpcasters())).get(id);
    expect(o?.about).toBe('00000000-0000-7000-8000-000000000000');
    expect(o?.topic).toBe('perf');
    expect(verify(root).fullySigned).toBe(true);
  });

  it('observe requires --topic and --text (a missing one is a usage error)', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['observe', 'some-id', '--topic', 'perf'], c.io); // no --text
    expect(c.failed()).toBe(true);
  });

  it('handoff records the fact (no id), from == to accepted, and verifies', async () => {
    await run(['init'], capture().io);
    const c = capture();
    // The same agent from and to — a chat restart, legitimate.
    await run(['handoff', 'a-task-id', 'claude-code', 'claude-code'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toBe('Recorded handoff on a-task-id: claude-code → claude-code');

    const root = treesOf().projectPublic as string;
    const list = projectHandoffs(orderedEvents({ root }, catalogUpcasters())).get('a-task-id');
    expect(list?.length).toBe(1);
    expect(list?.[0]?.toAgent).toBe('claude-code');
    expect(verify(root).fullySigned).toBe(true);
  });

  it('link records a cross-tree edge with a rel OUTSIDE the recommended set, and verifies', async () => {
    await run(['init'], capture().io);
    // subject in private, pointing at a public target that need not exist — a
    // link is legitimately cross-tree; the rel is not one of the recommended set.
    const c = capture();
    await run(
      [
        'link',
        'A',
        '00000000-0000-7000-8000-000000000000',
        '--rel',
        'inspired-by',
        '--scope',
        'private',
      ],
      c.io,
    );
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toBe('Linked A —inspired-by→ 00000000-0000-7000-8000-000000000000');

    const trees = treesOf();
    const edges = projectLinks(
      orderedEvents({ root: trees.projectPrivate as string }, catalogUpcasters()),
    );
    expect(edges).toEqual([
      expect.objectContaining({
        subject: 'A',
        target: '00000000-0000-7000-8000-000000000000',
        rel: 'inspired-by',
      }),
    ]);
    expect(verify(trees.projectPrivate as string).fullySigned).toBe(true);
  });

  it('each knowledge verb refuses before init and signals failure', async () => {
    const m = capture();
    await run(['memory', 'homeless'], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('Run `mnema init`');

    const o = capture();
    await run(['observe', 'x', '--topic', 't', '--text', 'obs'], o.io);
    expect(o.failed()).toBe(true);

    const h = capture();
    await run(['handoff', 'T', 'a', 'b'], h.io);
    expect(h.failed()).toBe(true);

    const l = capture();
    await run(['link', 'A', 'B', '--rel', 'relates-to'], l.io);
    expect(l.failed()).toBe(true);
  });

  it('next-actions lists a DRAFT task’s legal moves, and --json emits the faithful list', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    // Human summary lists the moves.
    const human = capture();
    await run(['next-actions', id], human.io);
    expect(human.failed()).toBe(false);
    expect(human.out.join('\n')).toContain('submit → READY');
    expect(human.out.join('\n')).toContain('cancel → CANCELED (needs reason)');

    // --json emits the faithful array of next actions.
    const json = capture();
    await run(['next-actions', id, '--json'], json.io);
    const actions = JSON.parse(json.out.join('\n')) as { action: string; to: string }[];
    expect(actions.map((a) => a.action).sort()).toEqual(['cancel', 'submit']);
  });

  it('next-actions reports "no legal moves" for a terminal task, and refuses an unknown id', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'to abandon'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
    await run(['task', 'move', 'cancel', id, '--reason', 'abandoned'], capture().io);

    // Terminal task — an existing task with no move (not an error).
    const terminal = capture();
    await run(['next-actions', id], terminal.io);
    expect(terminal.failed()).toBe(false);
    expect(terminal.out.join('\n')).toContain('terminal — no legal moves');

    // Unknown id — an honest refusal, distinct from terminal.
    const unknown = capture();
    await run(['next-actions', 'not-a-real-id'], unknown.io);
    expect(unknown.failed()).toBe(true);
    expect(unknown.err.join('\n')).toContain('No task not-a-real-id here.');
  });

  it('focus requires --actor and reports an empty focus for an unknown actor (--json faithful)', async () => {
    await run(['init'], capture().io);

    // A fresh project has no runs (runs are opened by a session, not the CLI), so
    // any actor's focus is empty — reported honestly, not as silent output.
    const human = capture();
    await run(['focus', '--actor', 'whoever'], human.io);
    expect(human.failed()).toBe(false);
    expect(human.out.join('\n')).toContain('has no open runs');

    // --json emits the faithful object (the actor and an empty run list).
    const json = capture();
    await run(['focus', '--actor', 'whoever', '--json'], json.io);
    const focus = JSON.parse(json.out.join('\n')) as { actor: string; openRuns: unknown[] };
    expect(focus.actor).toBe('whoever');
    expect(focus.openRuns).toEqual([]);

    // Omitting --actor is a usage error the parser reports (nothing read).
    const missing = capture();
    await run(['focus'], missing.io);
    expect(missing.failed()).toBe(true);
  });

  it('resume reports no runs yet for a fresh project, and refuses outside a project', async () => {
    await run(['init'], capture().io);
    const r = capture();
    await run(['resume', '--actor', 'whoever'], r.io);
    expect(r.failed()).toBe(false);
    expect(r.out.join('\n')).toContain('has no runs yet');

    // Outside a project, a context read refuses NO_PROJECT. The orphan must be a
    // SIBLING of repo, not under it — resolveTrees walks UP and would otherwise
    // find repo's own `.mnema`.
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const out = capture();
    await run(['resume', '--actor', 'whoever'], out.io);
    expect(out.failed()).toBe(true);
    expect(out.err.join('\n')).toContain('No mnema project here');
  });

  it('a knowledge verb with --scope global works with no project', async () => {
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const c = capture();
    await run(['memory', 'a cross-project lesson', '--scope', 'global'], c.io);
    expect(c.failed()).toBe(false);
    const id = (c.out.join('\n').match(/([0-9a-f-]{36})/) as RegExpMatchArray)[1] as string;
    const trees = resolveTrees(orphan, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    expect(
      projectKnowledge(orderedEvents({ root: trees.global }, catalogUpcasters())).has(id),
    ).toBe(true);
  });
});

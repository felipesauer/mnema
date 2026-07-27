/**
 * The CLI end to end: the real `run` entry (the same path the binary takes)
 * drives init → task → verify in a sandbox, proving the full loop
 * adapter → gate → chain → verify walks.
 *
 * It exercises `run` with an injected io and a sandboxed working directory and
 * environment, so no process is spawned and nothing touches the real streams or
 * the real app data directory.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  catalogUpcasters,
  enrollmentMessage,
  generateKeyPair,
  publicKeyToPem,
  sign,
  verify,
} from '@mnema/chain';
import {
  listProjects,
  orderedEvents,
  projectDecisions,
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
  projectRuns,
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
  // No session is open unless a test opens one: MNEMA_RUN must never leak in
  // from the machine running the suite, nor out of one test into the next.
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
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

  it('init creates the cold backup key, tells the person to move it, and says it once', async () => {
    const first = capture();
    await run(['init'], first.io);
    expect(first.failed()).toBe(false);

    // The one line the person must act on: where the private half is, and that it
    // has to leave this machine — a backup on this disk is lost with the disk.
    const backupLine = first.out.find((line) => line.includes('backup key:')) as string;
    expect(backupLine).toContain('created and enrolled — private half at');
    const privateKeyPath = backupLine.slice(backupLine.indexOf('at ') + 3);
    expect(existsSync(privateKeyPath)).toBe(true);
    expect(privateKeyPath.startsWith(join(sandbox, 'data'))).toBe(true);
    expect(privateKeyPath.startsWith(repo)).toBe(false);
    expect(first.out.join('\n')).toContain('Move that file off this machine');

    // A second init in the same project repeats nothing: the warning would become
    // noise, and there is no new key to warn about.
    const again = capture();
    await run(['init'], again.io);
    expect(again.out.join('\n')).not.toContain('Move that file off this machine');
    expect(again.out.join('\n')).not.toContain('backup key:');
  });

  it('a SECOND project is born with the backup enrolled, and both verify fully signed', async () => {
    // The whole point of replaying the registration per tree: a project created
    // after the backup existed must carry it too, or it is uncovered from birth.
    await run(['init'], capture().io);
    const other = join(sandbox, 'other-repo');
    mkdirSync(other, { recursive: true });
    process.chdir(other);

    const second = capture();
    await run(['init'], second.io);
    expect(second.failed()).toBe(false);
    // The backup is enrolled here, and it is NOT created again (one per machine).
    expect(second.out.join('\n')).toContain('backup key: enrolled in this project');
    expect(second.out.join('\n')).not.toContain('created and enrolled');

    const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
    const firstRoot = resolveTrees(repo, env).projectPublic as string;
    const secondRoot = resolveTrees(other, env).projectPublic as string;

    const rosters = [firstRoot, secondRoot].map((root) => {
      const events = orderedEvents({ root }, catalogUpcasters());
      expect(events.map((e) => e.kind)).toEqual(['identity.founded', 'key.enrolled']);
      const verdict = verify(root);
      expect(verdict.ok).toBe(true);
      expect(verdict.fullySigned).toBe(true);
      return events.map((e) => `${e.who}:${JSON.stringify(e.payload)}`);
    });
    // Same anchor, same founding key, same enrolled backup — one identity, two
    // trees, each carrying the proof on its own.
    expect(rosters[0]).toEqual(rosters[1]);
  });

  it('names every key it enrolls, not only the backup', async () => {
    // Enrolling a key changes WHO may speak for the identity. The backup is the
    // one the person must act on, but it is not the only key a roster can hold —
    // and a key that joins in silence is one nobody can notice joining.
    const first = capture();
    await run(['init'], first.io);
    const identityLine = first.out.find((line) => line.includes('identity:')) as string;
    const anchor = identityLine.split('identity: ')[1] as string;

    // A second key registered at the key root, the way another machine's would
    // be: its public half plus its own signature consenting to this anchor.
    const keyRoot = join(sandbox, 'data', 'mnema', 'identity');
    const joining = generateKeyPair();
    writeFileSync(
      join(keyRoot, 'keys', `${joining.fingerprint}.pub`),
      publicKeyToPem(joining.publicKey),
    );
    const consent = Buffer.from(
      sign(enrollmentMessage(anchor, joining.fingerprint), joining.privateKey),
    ).toString('hex');
    writeFileSync(
      join(keyRoot, 'keys', `${joining.fingerprint}.enroll`),
      `${JSON.stringify({ anchor, role: 'second-machine', reverseSig: consent })}\n`,
    );

    const other = join(sandbox, 'joined-repo');
    mkdirSync(other, { recursive: true });
    process.chdir(other);
    const second = capture();
    await run(['init'], second.io);

    // Both keys are enrolled, and BOTH are said out loud.
    const said = second.out.join('\n');
    expect(said).toContain('backup key: enrolled in this project');
    expect(said).toContain(`key ${joining.fingerprint} enrolled in this project`);

    const root = resolveTrees(other, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    const enrolled = orderedEvents({ root }, catalogUpcasters()).filter(
      (e) => e.kind === 'key.enrolled',
    );
    expect(enrolled).toHaveLength(2);
    expect(verify(root).ok).toBe(true);
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
    // And it says what a run IS, so an empty answer does not read as a fault.
    expect(human.out.join('\n')).toContain("A run is an agent's working session");

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

  it('resume reports no runs for a fresh project, and refuses outside a project', async () => {
    await run(['init'], capture().io);
    const r = capture();
    await run(['resume', '--actor', 'whoever'], r.io);
    expect(r.failed()).toBe(false);
    // Not "no runs YET": for someone working the CLI directly that state never
    // changes, so the read says what a run IS instead of implying one is coming.
    expect(r.out.join('\n')).toContain('has no runs.');
    expect(r.out.join('\n')).not.toContain('yet');
    expect(r.out.join('\n')).toContain("A run is an agent's working session");
    expect(r.out.join('\n')).toContain('mnema run start --which <agent>');

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

describe('mnema CLI — guard (dry-run of the gate), end to end', () => {
  /** Creates a task and returns its id — the value shown when it was created. */
  async function taskId(): Promise<string> {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'ship it'], c.io);
    return (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
  }

  it('ALLOWS a legal move with its proof, and --json emits the faithful verdict', async () => {
    const id = await taskId();

    // cancel is legal from DRAFT with a reason → ALLOWED, reaching CANCELED.
    const human = capture();
    await run(['guard', 'cancel', id, '--actor', 'human', '--reason', 'dropped'], human.io);
    expect(human.failed()).toBe(false);
    expect(human.out.join('\n')).toContain(`ALLOWED: cancel ${id} → CANCELED`);

    // --json emits the gate's own verdict, faithful.
    const json = capture();
    await run(
      ['guard', 'cancel', id, '--actor', 'human', '--reason', 'dropped', '--json'],
      json.io,
    );
    const verdict = JSON.parse(json.out.join('\n')) as {
      ok: boolean;
      to?: string;
      action?: string;
    };
    expect(verdict).toMatchObject({ ok: true, to: 'CANCELED', action: 'cancel' });
  });

  it('REFUSES MISSING_PROOF when the required proof is absent (a useful answer, not a failure)', async () => {
    const id = await taskId();
    const c = capture();
    // cancel is legal but needs a reason; without it → REFUSED (MISSING_PROOF).
    await run(['guard', 'cancel', id, '--actor', 'human'], c.io);
    // A refused verdict is a successful dry-run — it does not signal CLI failure.
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (MISSING_PROOF)');
  });

  it('REFUSES ILLEGAL_TRANSITION for a move the current state does not allow', async () => {
    const id = await taskId();
    const c = capture();
    // approve is not legal from DRAFT → REFUSED (ILLEGAL_TRANSITION).
    await run(['guard', 'approve', id, '--actor', 'human', '--note', 'lgtm'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (ILLEGAL_TRANSITION)');
  });

  it('REFUSES WHO_IS_WHICH when --which equals --actor', async () => {
    const id = await taskId();
    const c = capture();
    await run(['guard', 'submit', id, '--actor', 'same', '--which', 'same'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (WHO_IS_WHICH)');
  });

  it('requires --actor, and refuses an unknown id / no project honestly', async () => {
    const id = await taskId();

    // Omitting --actor is a usage error the parser reports (nothing read).
    const missing = capture();
    await run(['guard', 'submit', id], missing.io);
    expect(missing.failed()).toBe(true);

    // Unknown id → an honest refusal.
    const unknown = capture();
    await run(['guard', 'submit', 'not-a-real-id', '--actor', 'human'], unknown.io);
    expect(unknown.failed()).toBe(true);
    expect(unknown.err.join('\n')).toContain('No task not-a-real-id here.');

    // Outside a project, a read refuses NO_PROJECT. The orphan must be a SIBLING
    // of repo, not under it (resolveTrees walks UP and would find repo's .mnema).
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const out = capture();
    await run(['guard', 'submit', 'anything', '--actor', 'human'], out.io);
    expect(out.failed()).toBe(true);
    expect(out.err.join('\n')).toContain('No mnema project here');
  });
});

/**
 * The recovery, end to end and in the person's own order: init, keep the cold
 * copy, lose the key, restore, keep working.
 *
 * This is the proof the backup key was worth making. The property under test is
 * not "the command succeeds" — it is that the identity AFTER the loss is the
 * identity from before it, so the record stays one person's record rather than
 * splitting into two strangers who share a name.
 */
describe('mnema CLI — key restore, end to end', () => {
  /** The key root of the sandboxed machine. */
  function keyRoot(): string {
    return join(sandbox, 'data', 'mnema', 'identity');
  }

  /** The tree of the current repo. */
  function publicTree(): string {
    return resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
  }

  /**
   * Inits, moves the cold private half to a vault outside the machine, and
   * deletes the machine's own private key. Returns the identity from before the
   * loss and the path of the vault copy.
   */
  async function initThenLoseTheKey(): Promise<{
    anchorBefore: string;
    vaultCopy: string;
  }> {
    const i = capture();
    await run(['init'], i.io);
    const output = i.out.join('\n');
    const anchorBefore = /identity: (mnid:[0-9a-f]+)/.exec(output)?.[1] as string;
    // The path init printed is the one the person is told to move off the machine.
    const coldPath = /private half at (\S+)/.exec(output)?.[1] as string;
    expect(anchorBefore).toMatch(/^mnid:[0-9a-f]{64}$/);

    const vaultCopy = join(sandbox, 'vault', 'mnema-backup.key');
    mkdirSync(join(sandbox, 'vault'), { recursive: true });
    writeFileSync(vaultCopy, readFileSync(coldPath, 'utf-8'), { mode: 0o600 });
    rmSync(join(keyRoot(), 'backup'), { recursive: true, force: true });

    // The loss: the private half of the machine's own key. Nothing else — the
    // cold path init printed is named by the backup's fingerprint, so the other
    // `.key` at the key root is the machine's own.
    const backupFp = basename(coldPath, '.key');
    const primary = readdirSync(join(keyRoot(), 'keys'))
      .filter((name) => name.endsWith('.key'))
      .find((name) => name !== `${backupFp}.key`) as string;
    rmSync(join(keyRoot(), 'keys', primary));

    return { anchorBefore, vaultCopy };
  }

  it('recovers the identity: the fact written after the loss carries the ORIGINAL who', async () => {
    const lost = await initThenLoseTheKey();

    // The restore: one file, one command, offline.
    const r = capture();
    await run(['key', 'restore', lost.vaultCopy], r.io);
    expect(r.failed()).toBe(false);
    const restored = r.out.join('\n');
    expect(restored).toContain(`identity: ${lost.anchorBefore}`);
    expect(restored).toContain('this project enrolled this key');
    // The person is told the copy is still their copy, at the moment they would
    // think it had done its job.
    expect(restored).toContain('was read, not moved');
    expect(existsSync(lost.vaultCopy)).toBe(true);

    // Keep working: a fact written after the recovery.
    const m = capture();
    await run(['memory', 'the disk survived; the key did not'], m.io);
    expect(m.failed()).toBe(false);

    // The proof: the new event speaks for the SAME identity, and the tree carries
    // exactly ONE founding — no split.
    const events = orderedEvents({ root: publicTree() }, catalogUpcasters());
    const memory = events.find((e) => e.kind === 'memory.captured');
    expect(memory?.who).toBe(lost.anchorBefore);
    expect(events.filter((e) => e.kind === 'identity.founded')).toHaveLength(1);

    // And it is all still proven: ok, and every event signature-covered.
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    expect(verify(publicTree(), catalogUpcasters())).toMatchObject({
      ok: true,
      fullySigned: true,
    });
  });

  it('WITHOUT the restore the same loss splits the identity — what the command prevents', async () => {
    const lost = await initThenLoseTheKey();

    // No restore. The machine has no private key, so it mints a fresh one and
    // founds a SECOND identity in the team's tree — appended, unappendable-back.
    const m = capture();
    await run(['memory', 'written by a machine that lost its key'], m.io);
    expect(m.failed()).toBe(false);

    const events = orderedEvents({ root: publicTree() }, catalogUpcasters());
    const memory = events.find((e) => e.kind === 'memory.captured');
    expect(memory?.who).not.toBe(lost.anchorBefore);
    expect(events.filter((e) => e.kind === 'identity.founded')).toHaveLength(2);
  });

  it('refuses to restore while the machine still holds a key, and outside a project', async () => {
    // A healthy machine: the cold copy exists, so does the machine's own key.
    const i = capture();
    await run(['init'], i.io);
    const coldPath = /private half at (\S+)/.exec(i.out.join('\n'))?.[1] as string;

    const refused = capture();
    await run(['key', 'restore', coldPath], refused.io);
    expect(refused.failed()).toBe(true);
    expect(refused.err.join('\n')).toContain('Refused (KEY_PRESENT)');
    // The ambiguity was never created: exactly one private key at the key root.
    expect(
      readdirSync(join(keyRoot(), 'keys')).filter((name) => name.endsWith('.key')),
    ).toHaveLength(1);

    // Outside a project there is no record to prove membership against.
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const out = capture();
    await run(['key', 'restore', coldPath], out.io);
    expect(out.failed()).toBe(true);
    expect(out.err.join('\n')).toContain('No mnema project here');
  });
});

/**
 * A SECOND MACHINE joining one identity, driven through the real CLI: two key
 * roots, one shared record, and the three verbs that put them together.
 *
 * The property under test is not "the commands succeed" — it is that after the
 * handshake the two machines are ONE author. A record where a person's second
 * machine appears as a stranger is the failure this whole flow exists to prevent,
 * and it is a failure that cannot be undone: the events are appended.
 *
 * Both machines share the repository directory (the state a `git pull` leaves) and
 * differ only in their key root, which is what makes them two machines.
 */
describe('mnema CLI — a second machine joins one identity, end to end', () => {
  /** Points the next commands at one machine's key root. Two roots, two machines. */
  function useMachine(name: string): void {
    process.env.XDG_DATA_HOME = join(sandbox, name, 'data');
    process.env.HOME = join(sandbox, name, 'home');
  }

  function keyRootOf(name: string): string {
    return join(sandbox, name, 'data', 'mnema', 'identity');
  }

  function publicTree(): string {
    return join(repo, '.mnema');
  }

  /** The identity `init` printed, and the cold backup path it told the person to move. */
  async function initHere(): Promise<{ anchor: string; coldPath: string }> {
    const i = capture();
    await run(['init'], i.io);
    const output = i.out.join('\n');
    return {
      anchor: /identity: (mnid:[0-9a-f]{64})/.exec(output)?.[1] as string,
      coldPath: /private half at (\S+)/.exec(output)?.[1] as string,
    };
  }

  /** Runs `key request` and returns the one line it printed for the person to carry. */
  async function requestToJoin(anchor: string, keyFile?: string): Promise<string> {
    const r = capture();
    await run(
      keyFile === undefined
        ? ['key', 'request', '--anchor', anchor]
        : ['key', 'request', '--anchor', anchor, '--key', keyFile],
      r.io,
    );
    expect(r.failed()).toBe(false);
    return r.out.find((line) => line.startsWith('mnema-key-request:')) as string;
  }

  /** The private keys a machine holds — the ambiguity that must never be created. */
  function privateKeysOf(name: string): string[] {
    const dir = join(keyRootOf(name), 'keys');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.key'));
  }

  it('after joining, `init` reports the adopted identity — not the key its own derives', async () => {
    // `init` is the command a person runs to check that joining worked, and it is
    // reached BEFORE the first write settles the anchor on disk. Reporting the
    // derived anchor there would name an identity the very next write corrects.
    useMachine('a');
    const { anchor } = await initHere();

    useMachine('b');
    const beforeJoining = await initHere();
    expect(beforeJoining.anchor).not.toBe(anchor);
    const request = await requestToJoin(anchor);

    useMachine('a');
    await run(['key', 'enroll', request], capture().io);

    // B has written nothing yet: no anchor is recorded for it in this tree, so
    // this answer can only come from the record.
    useMachine('b');
    const after = capture();
    await run(['init'], after.io);
    expect(after.out.join('\n')).toContain(`identity: ${anchor}`);

    // And it is the same identity the next write actually uses.
    const m = capture();
    await run(['memory', 'the first write from B'], m.io);
    expect(m.failed()).toBe(false);
    const captured = orderedEvents({ root: publicTree() }, catalogUpcasters()).filter(
      (event) => event.kind === 'memory.captured',
    );
    expect(captured[0]?.who).toBe(anchor);
  });

  it('request → enroll → the second machine writes as the FIRST identity', async () => {
    // A founds the project.
    useMachine('a');
    const { anchor } = await initHere();

    // B asks to join. It has no key yet, so this is also where its key is born —
    // and it records NO anchor: asking is not being accepted.
    useMachine('b');
    const request = await requestToJoin(anchor);
    expect(request).toBeDefined();

    // A vouches. This is the only step that must run on a machine already in the
    // identity: membership is granted by a member's signature.
    useMachine('a');
    const e = capture();
    await run(['key', 'enroll', request], e.io);
    expect(e.failed()).toBe(false);
    expect(e.out.join('\n')).toContain(`into ${anchor}`);
    expect(e.out.join('\n')).toContain('Commit and share the record');

    // B writes for the first time. THIS is the moment the identity is decided.
    useMachine('b');
    const m = capture();
    await run(['memory', 'written from the second machine'], m.io);
    expect(m.failed()).toBe(false);
    const t = capture();
    await run(['task', 'shipped from the second machine'], t.io);
    expect(t.failed()).toBe(false);

    // The proof: B's facts carry A's anchor, and the record holds exactly ONE
    // founding — no second identity was minted.
    const events = orderedEvents({ root: publicTree() }, catalogUpcasters());
    const fromB = events.filter((event) => event.kind === 'memory.captured');
    expect(fromB).toHaveLength(1);
    expect(fromB[0]?.who).toBe(anchor);
    expect(events.filter((event) => event.kind === 'identity.founded')).toHaveLength(1);

    // One author across the whole record, read the way a person reads it.
    const acc = capture();
    await run(['accountability'], acc.io);
    expect(acc.out[0]).toMatch(/^\d+ fact\(s\) · 1 author\(s\)$/);

    // And it is all proven: two tails, ok, every event signature-covered.
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    const verdict = verify(publicTree(), catalogUpcasters());
    expect(verdict).toMatchObject({ ok: true, fullySigned: true });
    expect(verdict.tails).toHaveLength(2);
  });

  it('WITHOUT the enrollment the same second machine becomes a stranger', async () => {
    // The neutralization: skip the handshake and let B just write. Two identities in
    // a record the team shares — the state the three verbs exist to avoid.
    useMachine('a');
    const { anchor } = await initHere();

    useMachine('b');
    const m = capture();
    await run(['memory', 'written by a machine nobody vouched for'], m.io);
    expect(m.failed()).toBe(false);

    const events = orderedEvents({ root: publicTree() }, catalogUpcasters());
    expect(events.find((event) => event.kind === 'memory.captured')?.who).not.toBe(anchor);
    expect(events.filter((event) => event.kind === 'identity.founded')).toHaveLength(2);
    const acc = capture();
    await run(['accountability'], acc.io);
    expect(acc.out[0]).toContain('2 author(s)');
  });

  it('refuses a request made for ANOTHER identity before it can become a fact', async () => {
    useMachine('a');
    await initHere();
    useMachine('b');
    const elsewhere = `mnid:${'a'.repeat(64)}`;
    const request = await requestToJoin(elsewhere);

    useMachine('a');
    const e = capture();
    await run(['key', 'enroll', request], e.io);

    expect(e.failed()).toBe(true);
    expect(e.err.join('\n')).toContain('Refused (UNPROVEN_REQUEST)');
    // Nothing was appended: the record carries no enrollment beyond the backup's.
    const enrollments = orderedEvents({ root: publicTree() }, catalogUpcasters()).filter(
      (event) => event.kind === 'key.enrolled',
    );
    expect(enrollments).toHaveLength(1);
  });

  it('refuses to retire the last key, and retires one once a second is in', async () => {
    useMachine('a');
    const { anchor } = await initHere();
    // The identity has two keys from founding (this machine's and the cold backup),
    // so retiring one is allowed — and then the other is the last.
    const own = privateKeysOf('a')[0]?.replace('.key', '') as string;
    const backup = orderedEvents({ root: publicTree() }, catalogUpcasters())
      .filter((event) => event.kind === 'key.enrolled')
      .map((event) => (event.payload as { newFp: string }).newFp)[0] as string;

    const first = capture();
    await run(['key', 'revoke', backup, '--reason', 'the vault copy leaked'], first.io);
    expect(first.failed()).toBe(false);
    expect(first.out.join('\n')).toContain('1 key(s) left');

    const last = capture();
    await run(['key', 'revoke', own, '--reason', 'no longer used'], last.io);
    expect(last.failed()).toBe(true);
    expect(last.err.join('\n')).toContain('Refused (LAST_KEY)');
    expect(last.err.join('\n')).toContain('Enroll the replacement first');

    // The identity still verifies, and still has the key it refused to take away.
    expect(verify(publicTree(), catalogUpcasters())).toMatchObject({ ok: true });
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    expect(anchor).toMatch(/^mnid:/);
  });
});

/**
 * Getting OUT of a split: a machine that lost its key, minted another, and wrote —
 * so a record the team shares now carries the same person twice.
 *
 * This is the case `key restore` could not reach (it refuses while a key is
 * installed, and rightly: two private keys would make the machine's identity
 * depend on directory order). What the handshake adds is a way to ask on behalf of
 * a key the machine does NOT sign with — the cold copy — while the wrong key still
 * occupies the key root.
 */
describe('mnema CLI — asking with the cold copy while the wrong key is installed', () => {
  function useMachine(name: string): void {
    process.env.XDG_DATA_HOME = join(sandbox, name, 'data');
    process.env.HOME = join(sandbox, name, 'home');
  }

  function keyRootOf(name: string): string {
    return join(sandbox, name, 'data', 'mnema', 'identity');
  }

  function privateKeysOf(name: string): string[] {
    const dir = join(keyRootOf(name), 'keys');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.key'));
  }

  /**
   * The state: the person's identity, their cold copy in a vault, the machine's own
   * key gone, and one fact written after the loss — which minted a fresh key and
   * founded a SECOND identity in the shared record.
   */
  async function loseTheKeyThenWrite(): Promise<{
    anchor: string;
    vaultCopy: string;
    wrongKey: string;
  }> {
    useMachine('m');
    const i = capture();
    await run(['init'], i.io);
    const output = i.out.join('\n');
    const anchor = /identity: (mnid:[0-9a-f]{64})/.exec(output)?.[1] as string;
    const coldPath = /private half at (\S+)/.exec(output)?.[1] as string;

    const vaultCopy = join(sandbox, 'vault', 'backup.key');
    mkdirSync(join(sandbox, 'vault'), { recursive: true });
    writeFileSync(vaultCopy, readFileSync(coldPath, 'utf-8'), { mode: 0o600 });
    rmSync(join(keyRootOf('m'), 'backup'), { recursive: true, force: true });
    const backupFp = basename(coldPath, '.key');
    const own = privateKeysOf('m').find((f) => f !== `${backupFp}.key`) as string;
    rmSync(join(keyRootOf('m'), 'keys', own));

    // The write that consummates the split: no key, so a fresh one is minted and
    // founds an identity of its own.
    const m = capture();
    await run(['memory', 'written after the loss'], m.io);
    expect(m.failed()).toBe(false);
    const wrongKey = (privateKeysOf('m')[0] as string).replace('.key', '');
    return { anchor, vaultCopy, wrongKey };
  }

  it('produces the request with the WRONG key installed, and installs nothing', async () => {
    const lost = await loseTheKeyThenWrite();
    // The split is real: two identities in one record.
    const acc = capture();
    await run(['accountability'], acc.io);
    expect(acc.out[0]).toContain('2 author(s)');

    // The old remedy cannot help: restoring would leave two private keys.
    const restore = capture();
    await run(['key', 'restore', lost.vaultCopy], restore.io);
    expect(restore.failed()).toBe(true);
    expect(restore.err.join('\n')).toContain('Refused (KEY_PRESENT)');

    // But the cold copy can still ASK, signing for itself without being installed.
    const asked = capture();
    await run(['key', 'request', '--anchor', lost.anchor, '--key', lost.vaultCopy], asked.io);
    expect(asked.failed()).toBe(false);
    expect(asked.out.join('\n')).toContain('read from the file you named, not installed');
    expect(asked.out.some((line) => line.startsWith('mnema-key-request:'))).toBe(true);
    // The one thing that must not have happened: a second private key.
    expect(privateKeysOf('m')).toEqual([`${lost.wrongKey}.key`]);
    expect(readFileSync(lost.vaultCopy, 'utf-8')).toContain('PRIVATE KEY');
  });

  it('a clean machine restores the cold copy and speaks for the ORIGINAL identity again', async () => {
    const lost = await loseTheKeyThenWrite();

    // The path back: a key root that does NOT hold the wrong key. The cold copy is
    // restored there, and the record proves which identity it belongs to.
    useMachine('clean');
    const restored = capture();
    await run(['key', 'restore', lost.vaultCopy], restored.io);
    expect(restored.failed()).toBe(false);
    expect(restored.out.join('\n')).toContain(`identity: ${lost.anchor}`);

    const m = capture();
    await run(['memory', 'back on the original identity'], m.io);
    expect(m.failed()).toBe(false);
    const events = orderedEvents({ root: join(repo, '.mnema') }, catalogUpcasters());
    const recovered = events.filter((event) => event.kind === 'memory.captured').at(-1);
    expect(recovered?.who).toBe(lost.anchor);
    expect(verify(join(repo, '.mnema'), catalogUpcasters())).toMatchObject({ ok: true });
  });

  it('and enrolling the wrong key makes the ambiguity REFUSE the write, never guess it', async () => {
    const lost = await loseTheKeyThenWrite();
    // The tempting move: bring the wrong-but-present key into the original identity.
    // It works — and now that key belongs to TWO identities in this record, because
    // it also founded one. A machine cannot choose between them on the person's
    // behalf, so the next write into a tree it has no recorded anchor for refuses.
    useMachine('m');
    const request = await (async (): Promise<string> => {
      const r = capture();
      await run(['key', 'request', '--anchor', lost.anchor], r.io);
      return r.out.find((line) => line.startsWith('mnema-key-request:')) as string;
    })();

    useMachine('clean');
    const restore = capture();
    await run(['key', 'restore', lost.vaultCopy], restore.io);
    expect(restore.failed()).toBe(false);
    const enrolled = capture();
    await run(['key', 'enroll', request], enrolled.io);
    expect(enrolled.failed()).toBe(false);

    // A fresh clone: git carries the record but not the LOCAL anchor files, so the
    // identity is decided from the record again.
    const clone = join(sandbox, 'clone');
    mkdirSync(clone, { recursive: true });
    cpSync(join(repo, '.mnema'), join(clone, '.mnema'), { recursive: true });
    for (const file of readdirSync(join(clone, '.mnema', 'keys'))) {
      if (file.endsWith('.anchor') || file.endsWith('.inst')) {
        rmSync(join(clone, '.mnema', 'keys', file));
      }
    }
    process.chdir(clone);
    useMachine('m');

    const refused = capture();
    await run(['memory', 'which identity is this?'], refused.io);

    expect(refused.failed()).toBe(true);
    expect(refused.err.join('\n')).toContain('Refused (AMBIGUOUS_MEMBERSHIP)');
    expect(refused.err.join('\n')).toContain(lost.anchor);
    // Nothing was written on a guess.
    expect(
      orderedEvents({ root: join(clone, '.mnema') }, catalogUpcasters()).some(
        (event) => event.kind === 'memory.captured' && /which identity/.test(String(event.payload)),
      ),
    ).toBe(false);
  });
});

/**
 * The SESSION on the command line, end to end: open a run, work inside it, close
 * it — and prove the chain of authorization the run exists to carry.
 *
 * The property under test is not "the commands succeed". It is that the facts
 * written between `run start` and `run end` all name the SAME session, that the
 * session is the one a human opened for a named agent, and that a value the
 * environment merely CLAIMS is a run cannot get anywhere near the chain.
 */
describe('mnema CLI — run (the session), end to end', () => {
  /** Inits and returns the anchor `init` printed — the actor of every read here. */
  async function initHere(): Promise<string> {
    const i = capture();
    await run(['init'], i.io);
    return /identity: (mnid:[0-9a-f]{64})/.exec(i.out.join('\n'))?.[1] as string;
  }

  /** Opens a run through the CLI and returns its id, read off the output. */
  async function startRun(agent: string, goal?: string): Promise<{ id: string; out: string }> {
    const s = capture();
    await run(
      goal === undefined
        ? ['run', 'start', '--which', agent]
        : ['run', 'start', '--which', agent, '--goal', goal],
      s.io,
    );
    expect(s.failed()).toBe(false);
    const out = s.out.join('\n');
    return {
      id: (/^Started run ([0-9a-f-]{36})$/m.exec(out) as RegExpMatchArray)[1] as string,
      out,
    };
  }

  function treesOf() {
    return resolveTrees(repo, { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') });
  }

  /** Every event of a tree, or [] when that tree was never written. */
  function eventsOf(root: string | undefined) {
    return root !== undefined && existsSync(root)
      ? orderedEvents({ root }, catalogUpcasters())
      : [];
  }

  it('start → two facts pinned to one session → focus → end → resume, and it all verifies', async () => {
    const anchor = await initHere();

    // 1. The session opens, for a NAMED agent, and hands back the line that pins
    //    a shell to it — a process cannot export into its parent shell.
    const started = await startRun('claude-code', 'wire the run into the CLI');
    expect(started.out).toContain(`export MNEMA_RUN=${started.id}`);
    expect(started.out).toContain('for claude-code — wire the run into the CLI');

    // 2. The person (or their script) evaluates that line. From here the shell is
    //    inside the session.
    process.env.MNEMA_RUN = started.id;

    const m = capture();
    await run(['memory', 'the run is the unit of authorization', '--which', 'claude-code'], m.io);
    expect(m.failed()).toBe(false);
    const t = capture();
    await run(['task', 'close the pair', '--which', 'claude-code'], t.io);
    expect(t.failed()).toBe(false);

    // 3. BOTH facts carry the SAME run on the envelope — the chain of
    //    authorization, not two unrelated events that happen to share an author.
    const trees = treesOf();
    const written = [...eventsOf(trees.projectPrivate), ...eventsOf(trees.projectPublic)].filter(
      (e) => e.kind === 'memory.captured' || e.kind === 'task.created',
    );
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.run)).toEqual([started.id, started.id]);
    // And the run they name really is a session a human opened for that agent.
    const session = projectRuns(eventsOf(trees.projectPrivate)).get(started.id);
    expect(session).toMatchObject({ agent: 'claude-code', who: anchor, open: true });

    // 4. focus ANSWERS now — the read that was empty forever for a CLI user.
    const f = capture();
    await run(['focus', '--actor', anchor], f.io);
    expect(f.failed()).toBe(false);
    expect(f.out.join('\n')).toContain('1 open run(s)');
    expect(f.out.join('\n')).toContain(started.id);
    expect(f.out.join('\n')).toContain('wire the run into the CLI');

    // 5. The session closes — by MNEMA_RUN, with no id retyped — and says how to
    //    let go of a variable that would otherwise refuse every later write.
    const e = capture();
    await run(['run', 'end', '--outcome', 'shipped'], e.io);
    expect(e.failed()).toBe(false);
    expect(e.out.join('\n')).toContain(`Ended run ${started.id}`);
    expect(e.out.join('\n')).toContain('unset MNEMA_RUN');

    // 6. resume shows the session that ended, with the goal that says what it was.
    const r = capture();
    await run(['resume', '--actor', anchor], r.io);
    expect(r.failed()).toBe(false);
    expect(r.out.join('\n')).toContain(`last run ${started.id} (ended)`);
    expect(r.out.join('\n')).toContain('0 run(s) still open');

    // 7. Everything the session touched still verifies, fully signed.
    delete process.env.MNEMA_RUN;
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    for (const root of [trees.projectPublic as string, trees.projectPrivate as string]) {
      expect(verify(root, catalogUpcasters())).toMatchObject({ ok: true, fullySigned: true });
    }
  });

  it('a MNEMA_RUN naming a run that does not exist REFUSES the write, and writes nothing', async () => {
    await initHere();
    process.env.MNEMA_RUN = '00000000-0000-7000-8000-000000000000';

    const m = capture();
    await run(['memory', 'a fact with an invented session'], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('Refused (UNKNOWN_RUN)');
    expect(m.err.join('\n')).toContain('mnema run start --which <agent>');

    // Nothing reached any tree: a fact stamped with a run nobody opened would be
    // a broken chain of authorization that no later command can retract.
    const trees = treesOf();
    for (const root of [trees.projectPublic, trees.projectPrivate, trees.global]) {
      expect(eventsOf(root).some((e) => e.kind === 'memory.captured')).toBe(false);
    }
  });

  it('a MNEMA_RUN naming a CLOSED session refuses too', async () => {
    await initHere();
    const started = await startRun('ci-runner');
    process.env.MNEMA_RUN = started.id;
    await run(['run', 'end'], capture().io);

    const m = capture();
    await run(['memory', 'written after the session ended'], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('Refused (RUN_ENDED)');
    expect(eventsOf(treesOf().projectPublic).some((e) => e.kind === 'memory.captured')).toBe(false);
  });

  it('a run opened in ANOTHER project is not accepted here', async () => {
    // A session vouches for work in the project it was opened in — never in a
    // repository it never saw.
    await initHere();
    const started = await startRun('claude-code');

    const other = join(sandbox, 'other-repo');
    mkdirSync(other, { recursive: true });
    process.chdir(other);
    await run(['init'], capture().io);
    process.env.MNEMA_RUN = started.id;

    const m = capture();
    await run(['memory', 'a session from next door'], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('Refused (UNKNOWN_RUN)');
  });

  it('with NO MNEMA_RUN nothing changed: the fact is written, with no run on it', async () => {
    // The non-regression that matters most: a person who never heard of runs must
    // see exactly what they saw before.
    await initHere();
    const m = capture();
    await run(['memory', 'a person working directly'], m.io);
    expect(m.failed()).toBe(false);

    const captured = eventsOf(treesOf().projectPublic).find((e) => e.kind === 'memory.captured');
    expect(captured?.run).toBeUndefined();
    expect(captured?.which).toBeUndefined();
  });

  it('`run start` without --which is a usage error, and no session is born', async () => {
    // A run with no agent proves no delegation — it is the correlation id the
    // design rejected, so there is no way to ask for one.
    await initHere();
    const s = capture();
    await run(['run', 'start'], s.io);
    expect(s.failed()).toBe(true);
    expect(eventsOf(treesOf().projectPrivate).some((e) => e.kind === 'run.started')).toBe(false);
  });

  it('`run end` with neither an id nor MNEMA_RUN says how to close one', async () => {
    await initHere();
    await startRun('claude-code');
    const e = capture();
    await run(['run', 'end'], e.io);
    expect(e.failed()).toBe(true);
    expect(e.err.join('\n')).toContain('needs a run');
    expect(e.err.join('\n')).toContain('MNEMA_RUN');
  });

  it('closing the same run twice is refused, never silent', async () => {
    await initHere();
    const started = await startRun('claude-code');
    const first = capture();
    await run(['run', 'end', started.id], first.io);
    expect(first.failed()).toBe(false);

    const again = capture();
    await run(['run', 'end', started.id], again.io);
    expect(again.failed()).toBe(true);
    expect(again.err.join('\n')).toContain('Refused (ALREADY_ENDED)');
    // Exactly one close is on the log.
    expect(eventsOf(treesOf().projectPrivate).filter((e) => e.kind === 'run.ended')).toHaveLength(
      1,
    );
  });

  it('the session is born PRIVATE and takes no --scope', async () => {
    await initHere();
    const started = await startRun('claude-code');
    const trees = treesOf();
    expect(eventsOf(trees.projectPrivate).some((e) => e.subject === started.id)).toBe(true);
    expect(eventsOf(trees.projectPublic).some((e) => e.subject === started.id)).toBe(false);

    const scoped = capture();
    await run(['run', 'start', '--which', 'claude-code', '--scope', 'public'], scoped.io);
    expect(scoped.failed()).toBe(true);
  });

  it('`run start` outside a project refuses (a session belongs to a project)', async () => {
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const s = capture();
    await run(['run', 'start', '--which', 'claude-code'], s.io);
    expect(s.failed()).toBe(true);
    expect(s.err.join('\n')).toContain('Run `mnema init`');
  });
});

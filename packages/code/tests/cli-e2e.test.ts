/**
 * The CLI end to end: the real `run` entry (the same path the binary takes)
 * drives init → task → verify in a sandbox, proving the full loop
 * adapter → gate → chain → verify walks.
 *
 * It exercises `run` with an injected io and a sandboxed working directory and
 * environment, so no process is spawned and nothing touches the real streams or
 * the real app data directory.
 */

import { createHash } from 'node:crypto';
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
import { pathToFileURL } from 'node:url';
import {
  catalogUpcasters,
  enrollmentMessage,
  generateKeyPair,
  memoryCaptured,
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
import { openTreeForWriting } from '@mnema/core/write';
import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { closeSession, openSession } from '../src/mcp/session.js';
import { runCreateSkill, runSkillsTool, runSkillTransition } from '../src/mcp/tools.js';
import { servedPatternsFraming } from '../src/served-patterns.js';

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

/**
 * Founds a project and returns the identity it printed — the value the reads take.
 *
 * `mnema init` is where a person first sees their own anchor, and every verb that
 * asks for one says so. A test that invented a name instead would be passing a
 * value the product cannot produce: a `who` is derived from a key, never typed.
 */
async function foundIdentity(): Promise<string> {
  const c = capture();
  await run(['init'], c.io);
  const line = c.out.find((out) => out.trim().startsWith('identity:'));
  if (line === undefined) throw new Error(`setup: init printed no identity: ${c.out.join(' / ')}`);
  return line.trim().slice('identity:'.length).trim();
}

/**
 * A content digest of every file under `dir` — what a read that must write
 * NOTHING is proven against: not an event, not a checkpoint, not a byte.
 */
function digestOf(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${full}\n`);
        walk(full);
      } else {
        hash.update(`F:${full}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
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

/**
 * What the CLI does with an argument that would have made a record no read could
 * open — and, the half that matters most, what the project can still do afterwards.
 *
 * Eighteen commands of the shipped CLI accepted an empty argument, wrote a SIGNED
 * event the parser refuses, and reported success. From that moment every read of the
 * project failed — search, show, timeline, focus, resume, verify, all of them, on the
 * whole tree rather than the one record — and a tail is append-only, so nothing could
 * take the line back out.
 *
 * So a refusal here is not a usability nicety, and the test asserts the pair: the
 * command says `Refused (UNREADABLE_EVENT)` naming the field, AND the reads that
 * would have died still answer. The second half is what the golden cannot say,
 * because its reads run before its refusals.
 */
describe('mnema CLI — a record no read could open, end to end', () => {
  beforeEach(async () => {
    await run(['init'], capture().io);
  });

  /** Runs `mnema <argv>` and returns what it said on stderr, and whether it failed. */
  async function refused(argv: readonly string[]): Promise<string> {
    const c = capture();
    await run([...argv], c.io);
    expect(c.failed(), argv.join(' ')).toBe(true);
    return c.err.join('\n');
  }

  it('refuses every empty argument that reaches a required field, naming it', async () => {
    // One row per (command, argument) the shipped CLI could corrupt a project with.
    // The list IS the finding: the report this closes named six paths; driving the
    // built binary found eighteen, and these are the ones a single command reaches.
    const paths: readonly [readonly string[], string][] = [
      [['task', ''], 'payload.title'],
      [['decision', '', 'why'], 'payload.title'],
      [['decision', 'a title', ''], 'payload.rationale'],
      [['skill', '', '--body', 'b'], 'payload.name'],
      [['skill', 'a name', '--body', ''], 'payload.body'],
      [['memory', ''], 'payload.content'],
      [['observe', '', '--topic', 'k', '--text', 't'], 'payload.about'],
      [['observe', 'x', '--topic', '', '--text', 't'], 'payload.topic'],
      [['observe', 'x', '--topic', 'k', '--text', ''], 'payload.text'],
      // The two whose empty argument becomes the envelope's SUBJECT, not a payload
      // field — the pair a payload-shaped check would have missed.
      [['handoff', '', 'a', 'b'], 'at subject'],
      [['handoff', 't', '', 'b'], 'payload.fromAgent'],
      [['handoff', 't', 'a', ''], 'payload.toAgent'],
      [['link', '', 'y', '--rel', 'r'], 'at subject'],
      [['link', 'x', '', '--rel', 'r'], 'payload.target'],
      [['link', 'x', 'y', '--rel', ''], 'payload.rel'],
      // And the optional-if-present one, which is the class an "is it required?"
      // reading of the catalog would have skipped.
      [['run', 'start', '--which', 'agent-alpha', '--goal', ''], 'payload.goal'],
    ];
    for (const [argv, field] of paths) {
      const said = await refused(argv);
      expect(said, argv.join(' ')).toContain('Refused (UNREADABLE_EVENT)');
      expect(said, argv.join(' ')).toContain(field);
    }
  });

  it('leaves every read answering, and the project writable, after all of them', async () => {
    // Drive one refusal of each shape, then ask the reads. Before this door, ONE of
    // these would have made all of them fail — so this is the assertion the whole
    // slice exists for.
    for (const argv of [
      ['task', ''],
      ['memory', ''],
      ['handoff', '', 'a', 'b'],
      ['link', 'x', 'y', '--rel', ''],
      ['run', 'start', '--which', 'agent-alpha', '--goal', ''],
    ]) {
      await refused(argv);
    }

    const task = capture();
    await run(['task', 'a task the record can hold'], task.io);
    expect(task.failed()).toBe(false);
    const id = /\(([^)]+)\)/.exec(task.out.join('\n'))?.[1] as string;

    for (const argv of [['search'], ['show', id], ['verify'], ['timeline', id]]) {
      const read = capture();
      await run(argv, read.io);
      expect(read.failed(), argv.join(' ')).toBe(false);
      expect(read.out.join('\n'), argv.join(' ')).not.toBe('');
    }
    // And the proof still closes over the tree, fully signed.
    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    expect(verify(root).ok).toBe(true);
    expect(verify(root).fullySigned).toBe(true);
  });

  it('refuses the authorizing identity offered as the agent, in its short form too', async () => {
    // The same family: a value one surface PRINTS and another accepts where it must
    // not. The short form of an anchor is a prefix of it, so it is the same identity
    // — and it only became typeable when the reads started printing it.
    const accountability = capture();
    await run(['accountability'], accountability.io);
    const short = /mnid:[0-9a-f]+/.exec(accountability.out.join('\n'))?.[0] as string;
    expect(short.length).toBeLessThan('mnid:'.length + 64);

    const said = await refused(['task', 'a task the anchor claims to have run', '--which', short]);
    expect(said).toContain('Refused (WHO_IS_WHICH)');

    // And an honest agent name still passes, so the refusal is about the identity
    // and not about the flag.
    const ok = capture();
    await run(['task', 'a task an agent really ran', '--which', 'agent-alpha'], ok.io);
    expect(ok.failed()).toBe(false);
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

  it('focus requires --actor and reports an empty focus for the founder (--json faithful)', async () => {
    const who = await foundIdentity();

    // A fresh project has no runs (runs are opened by a session, not the CLI), so
    // the actor's focus is empty — reported honestly, not as silent output.
    const human = capture();
    await run(['focus', '--actor', who], human.io);
    expect(human.failed()).toBe(false);
    expect(human.out.join('\n')).toContain('has no open runs');
    // And it says what a run IS, so an empty answer does not read as a fault.
    expect(human.out.join('\n')).toContain("A run is an agent's working session");

    // --json emits the faithful object — the WHOLE anchor, never the short form:
    // that channel is data an agent may feed back, not a line a person reads.
    const json = capture();
    await run(['focus', '--actor', who, '--json'], json.io);
    const focus = JSON.parse(json.out.join('\n')) as { actor: string; openRuns: unknown[] };
    expect(focus.actor).toBe(who);
    expect(focus.openRuns).toEqual([]);

    // An actor naming no identity here is refused, not answered about: an empty
    // focus for a stranger reads exactly like an empty focus for a real person.
    const stranger = capture();
    await run(['focus', '--actor', 'whoever'], stranger.io);
    expect(stranger.failed()).toBe(true);
    expect(stranger.err.join('\n')).toContain('UNKNOWN_ANCHOR');

    // Omitting --actor is a usage error the parser reports (nothing read).
    const missing = capture();
    await run(['focus'], missing.io);
    expect(missing.failed()).toBe(true);
  });

  it('resume reports no runs for a fresh project, and refuses outside a project', async () => {
    const who = await foundIdentity();
    const r = capture();
    await run(['resume', '--actor', who], r.io);
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
    await run(['resume', '--actor', who], out.io);
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

describe('mnema CLI — search and show (the record made readable), end to end', () => {
  /** Runs a verb and returns its stdout as one string. */
  async function output(argv: string[]): Promise<string> {
    const c = capture();
    await run(argv, c.io);
    expect(c.failed()).toBe(false);
    return c.out.join('\n');
  }

  /** The id printed by a verb that mints one. */
  function idOf(text: string): string {
    return (text.match(/([0-9a-f-]{36})/) as RegExpMatchArray)[1] as string;
  }

  it('records three kinds, finds the one a term names, reads its body, then lists the recent', async () => {
    await run(['init'], capture().io);
    const memory = idOf(await output(['memory', 'the auth flow uses PKCE with a rotating secret']));
    await output(['decision', 'Adopt trunk-based development', 'fewer merges']);
    const task = idOf(await output(['task', 'wire the callback']));
    await output(['observe', task, '--topic', 'perf', '--text', 'the callback is hot']);

    // 1. A term that appears in ONE record finds exactly it, grouped by kind.
    const found = await output(['search', 'PKCE']);
    expect(found).toContain('1 record(s) matching "PKCE"');
    expect(found).toContain('memory (1)');
    expect(found).toContain(memory);
    // The index line is an excerpt of the content, not the whole of it.
    expect(found).toContain('the auth flow uses PKCE');

    // 2. The body comes from the id the index gave.
    const body = await output(['show', memory]);
    expect(body).toContain('the auth flow uses PKCE with a rotating secret');
    expect(body).toContain('memory');

    // 3. With no term at all: the most recent records, across kinds.
    const recent = await output(['search']);
    expect(recent).toContain('4 record(s):');
    for (const kind of ['memory (1)', 'decision (1)', 'task (1)', 'observation (1)']) {
      expect(recent).toContain(kind);
    }
  });

  it('a TITLE holding a newline cannot forge a hit in the index', async () => {
    await run(['init'], capture().io);
    // The index prints one line per hit under a count per kind, so a title split
    // across two lines makes that count LIE: the second half reads as a record
    // with an id, a tree and a state of its own that nothing ever recorded.
    const forgedLine = '  019f0000-0000-7000-8000-000000000000  public  2026-07-28  forged (open)';
    await output(['task', `wire the callback\n${forgedLine}`]);
    await output(['task', `and another\n${forgedLine}`]);

    const found = await output(['search']);
    const lines = found.split('\n');
    // The header, a blank, the kind's count, and exactly one line per hit.
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe('task (2)');
    expect(found).not.toContain(`\n${forgedLine}`);

    // --json keeps each title as written — the faithful answer beside the report.
    const json = JSON.parse(await output(['search', '--json'])) as {
      hits: { title: string }[];
    };
    expect(json.hits).toHaveLength(2);
    expect(json.hits.every((hit) => hit.title.includes('\n'))).toBe(true);
  });

  it('--json emits one flat ordered list; the human summary is what groups it', async () => {
    await run(['init'], capture().io);
    await output(['memory', 'a note about caching']);
    await output(['task', 'fix the caching bug']);

    const json = JSON.parse(await output(['search', 'caching', '--json'])) as {
      hits: { kind: string; scope: string; id: string }[];
      total: number;
    };
    expect(json.total).toBe(2);
    expect(json.hits).toHaveLength(2);
    // Flat: no grouping key anywhere in the object the agent's surface serves.
    expect(json.hits.every((hit) => hit.scope === 'public')).toBe(true);
  });

  it('says how much it is showing when the limit cuts the answer', async () => {
    await run(['init'], capture().io);
    for (let i = 0; i < 4; i += 1) await output(['memory', `a repeated word number ${i}`]);

    const cut = await output(['search', 'repeated', '--limit', '2']);
    expect(cut).toContain('2 of 4 record(s) matching "repeated"');
  });

  it('narrows by kind and by tree, and marks the tree on every line', async () => {
    await run(['init'], capture().io);
    await output(['memory', 'a shared word, in public']);
    await output(['memory', 'a shared word, on this machine', '--scope', 'private']);
    await output(['task', 'a shared word in a task']);

    const onlyMemories = await output(['search', 'shared', '--kind', 'memory']);
    expect(onlyMemories).toContain('2 record(s)');
    expect(onlyMemories).toContain('  public  ');
    expect(onlyMemories).toContain('  private  ');
    expect(onlyMemories).not.toContain('task (');

    const onlyPrivate = await output(['search', 'shared', '--scope', 'private']);
    expect(onlyPrivate).toContain('1 record(s)');
    expect(onlyPrivate).toContain('on this machine');
  });

  it('answers a term nothing matches plainly, and an empty record too', async () => {
    await run(['init'], capture().io);

    expect(await output(['search'])).toContain('Nothing recorded here yet.');
    await output(['memory', 'something']);
    expect(await output(['search', 'zebra'])).toContain('Nothing recorded matching "zebra".');
  });

  it('rejects a kind, a scope and a limit that are not valid — nothing is searched', async () => {
    await run(['init'], capture().io);

    const kind = capture();
    await run(['search', 'x', '--kind', 'memories'], kind.io);
    expect(kind.failed()).toBe(true);
    expect(kind.err.join('\n')).toContain('Invalid --kind "memories"');

    const scope = capture();
    await run(['search', 'x', '--scope', 'team'], scope.io);
    expect(scope.failed()).toBe(true);
    expect(scope.err.join('\n')).toContain('Invalid --scope "team"');

    const limit = capture();
    await run(['search', 'x', '--limit', 'lots'], limit.io);
    expect(limit.failed()).toBe(true);
    expect(limit.err.join('\n')).toContain('Invalid --limit "lots"');
  });

  it('shows each kind with the field a reader opened it for', async () => {
    await run(['init'], capture().io);
    const decision = idOf(await output(['decision', 'Adopt SQLite', 'it is local-first']));
    const skill = idOf(await output(['skill', 'One slice per PR', '--body', 'the pattern itself']));

    const shownDecision = await output(['show', decision]);
    expect(shownDecision).toContain('ADR-1 — Adopt SQLite (proposed)');
    expect(shownDecision).toContain('it is local-first');

    // A skill's body IS served here: this reader is curating patterns, and the
    // agent's surface makes the opposite call (see `runShow`).
    const shownSkill = await output(['show', skill]);
    expect(shownSkill).toContain('One slice per PR (proposed)');
    expect(shownSkill).toContain('the pattern itself');

    const json = JSON.parse(await output(['show', decision, '--json'])) as {
      kind: string;
      scope: string;
      record: { rationale: string };
    };
    expect(json.kind).toBe('decision');
    expect(json.scope).toBe('public');
    expect(json.record.rationale).toBe('it is local-first');
  });

  it('refuses an id no tree holds, and works with no project at all', async () => {
    const missing = capture();
    await run(['init'], capture().io);
    await run(['show', 'not-a-real-id'], missing.io);
    expect(missing.failed()).toBe(true);
    expect(missing.err.join('\n')).toContain('No record not-a-real-id here.');

    // Outside a project the global tree is still a record worth searching — the
    // one place these two part from the intelligence reads, which refuse.
    const outside = join(sandbox, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    process.chdir(outside);
    try {
      const personal = capture();
      await run(['memory', 'a personal note', '--scope', 'global'], personal.io);
      expect(personal.failed()).toBe(false);
      const found = capture();
      await run(['search', 'personal'], found.io);
      expect(found.failed()).toBe(false);
      expect(found.out.join('\n')).toContain('global');
    } finally {
      process.chdir(repo);
    }
  });

  it('leaves the trees byte-identical: a read that writes nothing', async () => {
    await run(['init'], capture().io);
    const id = idOf(await output(['memory', 'a fact worth finding']));

    const before = digestOf(sandbox);
    await output(['search', 'fact']);
    await output(['search']);
    await output(['show', id]);
    expect(digestOf(sandbox)).toBe(before);
  });
});

describe('mnema CLI — guard (dry-run of the gate), end to end', () => {
  /**
   * Founds a project with one task, and returns the task's id and the identity
   * that made it — which every guard here asks AS. A real move's `who` comes from
   * a key, so a dry-run for a value naming no identity is refused.
   */
  async function taskAndIdentity(): Promise<{ id: string; who: string }> {
    const who = await foundIdentity();
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
    return { id, who };
  }

  it('ALLOWS a legal move with its proof, and --json emits the faithful verdict', async () => {
    const { id, who } = await taskAndIdentity();

    // cancel is legal from DRAFT with a reason → ALLOWED, reaching CANCELED.
    const human = capture();
    await run(['guard', 'cancel', id, '--actor', who, '--reason', 'dropped'], human.io);
    expect(human.failed()).toBe(false);
    expect(human.out.join('\n')).toContain(`ALLOWED: cancel ${id} → CANCELED`);

    // --json emits the gate's own verdict, faithful.
    const json = capture();
    await run(['guard', 'cancel', id, '--actor', who, '--reason', 'dropped', '--json'], json.io);
    const verdict = JSON.parse(json.out.join('\n')) as {
      ok: boolean;
      to?: string;
      action?: string;
    };
    expect(verdict).toMatchObject({ ok: true, to: 'CANCELED', action: 'cancel' });
  });

  it('REFUSES MISSING_PROOF when the required proof is absent (a useful answer, not a failure)', async () => {
    const { id, who } = await taskAndIdentity();
    const c = capture();
    // cancel is legal but needs a reason; without it → REFUSED (MISSING_PROOF).
    await run(['guard', 'cancel', id, '--actor', who], c.io);
    // A refused verdict is a successful dry-run — it does not signal CLI failure.
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (MISSING_PROOF)');
  });

  it('REFUSES ILLEGAL_TRANSITION for a move the current state does not allow', async () => {
    const { id, who } = await taskAndIdentity();
    const c = capture();
    // approve is not legal from DRAFT → REFUSED (ILLEGAL_TRANSITION).
    await run(['guard', 'approve', id, '--actor', who, '--note', 'lgtm'], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (ILLEGAL_TRANSITION)');
  });

  it('REFUSES WHO_IS_WHICH when --which equals --actor', async () => {
    const { id, who } = await taskAndIdentity();
    const c = capture();
    await run(['guard', 'submit', id, '--actor', who, '--which', who], c.io);
    expect(c.failed()).toBe(false);
    expect(c.out.join('\n')).toContain('REFUSED (WHO_IS_WHICH)');
  });

  it('requires --actor, and refuses an unknown id / no project honestly', async () => {
    const { id, who } = await taskAndIdentity();

    // Omitting --actor is a usage error the parser reports (nothing read).
    const missing = capture();
    await run(['guard', 'submit', id], missing.io);
    expect(missing.failed()).toBe(true);

    // Unknown id → an honest refusal.
    const unknown = capture();
    await run(['guard', 'submit', 'not-a-real-id', '--actor', who], unknown.io);
    expect(unknown.failed()).toBe(true);
    expect(unknown.err.join('\n')).toContain('No task not-a-real-id here.');

    // Outside a project, a read refuses NO_PROJECT. The orphan must be a SIBLING
    // of repo, not under it (resolveTrees walks UP and would find repo's .mnema).
    const orphan = join(sandbox, 'elsewhere');
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    const out = capture();
    await run(['guard', 'submit', 'anything', '--actor', `mnid:${'0'.repeat(64)}`], out.io);
    expect(out.failed()).toBe(true);
    expect(out.err.join('\n')).toContain('No mnema project here');
  });
});

/**
 * The promise this shortening is only honest under: WHAT THE READS PRINT, THE FLAGS
 * TAKE BACK.
 *
 * Nothing here types a value of its own. Every case runs a reading, pulls the
 * identity OUT of the text it produced, and feeds exactly that back through the real
 * CLI — because a test that asserted "the flag accepts eight hex" would pass while
 * the reads printed twelve, and the person copying from their terminal would be the
 * one to find out. The value under test is the one that came out.
 */
describe('mnema CLI — the identity a read prints is the identity a flag takes', () => {
  /** The identity as it appears in `text` — the short form, from the output itself. */
  function printedIdentity(text: string): string {
    const found = /mnid:[0-9a-f]+/.exec(text);
    if (found === null) throw new Error(`no identity in the output: ${text}`);
    return found[0];
  }

  it('prints one short form in every read, and it is a PREFIX of the whole anchor', async () => {
    const whole = await foundIdentity();
    await run(['task', 'ship it'], capture().io);
    await run(['memory', 'the runbook is in the record'], capture().io);

    // Every reading that names an identity, and the form each one printed.
    const reads: Record<string, string[]> = {};
    for (const argv of [
      ['accountability'],
      ['focus', '--actor', whole],
      ['resume', '--actor', whole],
    ]) {
      const c = capture();
      await run(argv, c.io);
      expect(c.failed(), argv.join(' ')).toBe(false);
      reads[argv[0] as string] = c.out;
    }
    // `show` of the memory, and `timeline` of it, both name the identity too.
    const search = capture();
    await run(['search', 'runbook'], search.io);
    const memoryId = (/[0-9a-f-]{36}/.exec(search.out.join('\n')) as RegExpMatchArray)[0];
    for (const argv of [
      ['show', memoryId],
      ['timeline', memoryId],
    ]) {
      const c = capture();
      await run(argv, c.io);
      expect(c.failed(), argv.join(' ')).toBe(false);
      reads[argv[0] as string] = c.out;
    }

    const forms = new Set(Object.values(reads).map((out) => printedIdentity(out.join('\n'))));
    // ONE form across all five: a reader who learns it in one read recognizes it in
    // the next, and the flags below only have to take one thing.
    expect(forms.size, JSON.stringify(reads, null, 2)).toBe(1);
    const short = [...forms][0] as string;

    // It is the anchor's own leading characters — checkable against the whole value
    // by eye, which a hashed label would not be.
    expect(whole.startsWith(short)).toBe(true);
    expect(short.length).toBeLessThan(whole.length);
    // And no read leaked the whole thing beside it.
    for (const [read, out] of Object.entries(reads)) {
      expect(out.join('\n'), read).not.toContain(whole);
    }
  });

  it('takes that same text back at every door that receives an identity', async () => {
    const whole = await foundIdentity();
    const created = capture();
    await run(['task', 'ship it'], created.io);
    const id = (
      created.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray
    )[1] as string;

    const account = capture();
    await run(['accountability'], account.io);
    const short = printedIdentity(account.out.join('\n'));

    // The three reads that take an actor, and the filter over the very read it came
    // from — each given the text the terminal showed, not a value computed here.
    for (const argv of [
      ['focus', '--actor', short],
      ['resume', '--actor', short],
      ['guard', 'submit', id, '--actor', short],
      ['accountability', '--who', short],
    ]) {
      const c = capture();
      await run(argv, c.io);
      expect(c.failed(), argv.join(' ')).toBe(false);
    }
    // …and the WRITE that consents to join an identity, whose echo names the whole
    // value it resolved to: the confirmation that the prefix meant who it meant.
    const requested = capture();
    await run(['key', 'request', '--anchor', short], requested.io);
    expect(requested.failed()).toBe(false);
    expect(requested.out.join('\n')).toContain(`to join ${whole}`);

    // The filtered account is the same account: the prefix narrowed to the one
    // identity there is, rather than to nobody.
    const filtered = capture();
    await run(['accountability', '--who', short], filtered.io);
    expect(filtered.out).toEqual(account.out);
  });

  it('keeps the WHOLE anchor in --json, which is data and not a line to read', async () => {
    const whole = await foundIdentity();
    for (const argv of [
      ['focus', '--actor', whole, '--json'],
      ['resume', '--actor', whole, '--json'],
      ['accountability', '--json'],
    ]) {
      const c = capture();
      await run(argv, c.io);
      expect(c.out.join('\n'), argv.join(' ')).toContain(whole);
    }
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

  it('still wants the WHOLE fingerprint to retire a key — a prefix is not a key', async () => {
    // An anchor may now be named by a prefix, and a fingerprint may not. The two are
    // different values: an anchor is an identity the record lists, so a prefix
    // resolves against something and an ambiguous one is refused by name — a
    // fingerprint names a physical key, and guessing which one a short value means
    // is not a guess to make about key material. Nothing is retired.
    useMachine('a');
    await initHere();
    const own = privateKeysOf('a')[0]?.replace('.key', '') as string;

    const short = capture();
    await run(['key', 'revoke', own.slice(0, 8), '--reason', 'a prefix should not do'], short.io);
    expect(short.failed()).toBe(true);
    expect(
      orderedEvents({ root: publicTree() }, catalogUpcasters()).filter(
        (event) => event.kind === 'key.revoked',
      ),
    ).toHaveLength(0);
    // The help says the full one, and the full one works.
    const whole = capture();
    await run(['key', 'revoke', own, '--reason', 'the machine is being retired'], whole.io);
    expect(whole.failed()).toBe(false);
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
    await run(['run', 'end', '--which', 'claude-code', '--outcome', 'shipped'], e.io);
    expect(e.failed()).toBe(false);
    expect(e.out.join('\n')).toContain(`Ended run ${started.id}`);
    expect(e.out.join('\n')).toContain('unset MNEMA_RUN');
    // The close names the agent that executed it, the way the birth named the one the
    // session was for — and it is on the ENVELOPE of the fact, not only on the line.
    expect(e.out.join('\n')).toContain('by claude-code');
    const closed = eventsOf(treesOf().projectPrivate).find((x) => x.kind === 'run.ended');
    expect(closed?.which).toBe('claude-code');

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
    await run(['run', 'end', '--which', 'ci-runner'], capture().io);

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
    await run(['run', 'end', '--which', 'claude-code'], e.io);
    expect(e.failed()).toBe(true);
    expect(e.err.join('\n')).toContain('needs a run');
    expect(e.err.join('\n')).toContain('MNEMA_RUN');
  });

  it('`run end` without --which is a usage error at PARSE time, and the run stays open', async () => {
    // The other half of the pair reading the same. `run start` has no way to open a
    // session unnamed; a close that could omit its executor would record an agent's
    // session as sealed by the person — which is what it did, and what no read could
    // tell apart from a person who really did close it.
    await initHere();
    const started = await startRun('claude-code');
    const e = capture();
    await run(['run', 'end', started.id], e.io);
    expect(e.failed()).toBe(true);

    // The refusal is COMMANDER's, and asserting which one it is, is what makes this
    // test discriminate: with the flag merely optional the invocation reaches the
    // command and earns `NO_AGENT` instead — also a refusal, also non-zero, so a test
    // that only checked "it failed" passed on the declaration this one is about. (The
    // matrix found exactly that, in the first version of this test.)
    const said = e.err.join('\n');
    expect(said).toContain("required option '--which <agent>' not specified");
    expect(said).not.toContain('name the one closing this session');

    expect(eventsOf(treesOf().projectPrivate).some((x) => x.kind === 'run.ended')).toBe(false);
    expect(projectRuns(eventsOf(treesOf().projectPrivate)).get(started.id)?.open).toBe(true);
  });

  it('closing the same run twice is refused, never silent', async () => {
    await initHere();
    const started = await startRun('claude-code');
    const first = capture();
    await run(['run', 'end', started.id, '--which', 'claude-code'], first.io);
    expect(first.failed()).toBe(false);

    const again = capture();
    await run(['run', 'end', started.id, '--which', 'claude-code'], again.io);
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

  it('an AGENT NAME holding a newline cannot forge a run in `focus`', async () => {
    // `focus` lists one line per open run, `<id>  <agent>`, and the agent's name
    // is text an actor wrote. Split across two lines, its second half would read
    // as a run of its own — an id the record never minted, for an agent that is
    // not this actor's. The goal sits on the same line and is just as writable.
    const anchor = await initHere();
    const forgedLine = '  019f0000-0000-7000-8000-000000000000  someone-else';
    await startRun(`claude-code\n${forgedLine}`, 'a goal');
    await startRun('other-agent', `a goal\n${forgedLine}`);

    const f = capture();
    await run(['focus', '--actor', anchor], f.io);
    expect(f.failed()).toBe(false);
    const lines = f.out.join('\n').split('\n');
    // The header plus exactly one line per open run — two runs, two lines.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('2 open run(s)');
    expect(f.out.join('\n')).not.toContain(`\n${forgedLine}`);

    // --json stays the faithful object: the agent and the goal as written.
    const j = capture();
    await run(['focus', '--actor', anchor, '--json'], j.io);
    const focus = JSON.parse(j.out.join('\n')) as {
      openRuns: Array<{ agent: string; goal?: string }>;
    };
    expect(focus.openRuns.some((r) => r.agent.includes('\n'))).toBe(true);
    expect(focus.openRuns.some((r) => r.goal?.includes('\n') === true)).toBe(true);
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

  it('`focus` says how long each open run has been open and how long since it recorded', async () => {
    // What makes a list of leftover runs readable. Two runs, one with a fact pinned to
    // it and one with none, and the difference is stated rather than left to a blank:
    // an absent idleness MEANS the run recorded nothing, and a line that only omitted
    // it would read as "idle: unknown".
    const anchor = await initHere();
    const worked = await startRun('claude-code', 'with a fact in it');
    process.env.MNEMA_RUN = worked.id;
    await run(['memory', 'a fact pinned to that session', '--which', 'claude-code'], capture().io);
    delete process.env.MNEMA_RUN;
    const empty = await startRun('other-agent', 'with nothing in it');

    const f = capture();
    await run(['focus', '--actor', anchor], f.io);
    expect(f.failed()).toBe(false);
    // Still one line per run — the age rides the run's own line, because a reader
    // counts runs by lines.
    const lines = f.out.join('\n').split('\n');
    expect(lines).toHaveLength(3);
    const forWorked = lines.find((l) => l.includes(worked.id)) ?? '';
    const forEmpty = lines.find((l) => l.includes(empty.id)) ?? '';
    expect(forWorked).toMatch(/· open \d+[dhms]/);
    expect(forWorked).toMatch(/· last recorded \d+[dhms].* ago/);
    expect(forEmpty).toContain('· nothing recorded in it');

    // `--json` carries the numbers themselves, and whose run it is: a command-line
    // read opens none, so every one of them is another session's.
    const j = capture();
    await run(['focus', '--actor', anchor, '--json'], j.io);
    const focus = JSON.parse(j.out.join('\n')) as {
      openRuns: Array<{
        id: string;
        thisSession: boolean;
        ageSeconds?: number;
        idleSeconds?: number;
      }>;
    };
    expect(focus.openRuns.every((r) => r.thisSession === false)).toBe(true);
    expect(focus.openRuns.find((r) => r.id === worked.id)?.idleSeconds).toBeTypeOf('number');
    expect(focus.openRuns.find((r) => r.id === empty.id)).not.toHaveProperty('idleSeconds');
  });

  it('`resume` ages an OPEN last run and says nothing of the sort about an ended one', async () => {
    const anchor = await initHere();
    const started = await startRun('claude-code', 'still going');

    const open = capture();
    await run(['resume', '--actor', anchor], open.io);
    expect(open.out.join('\n')).toMatch(/· open \d+[dhms]/);

    process.env.MNEMA_RUN = started.id;
    await run(['run', 'end', '--which', 'claude-code', '--outcome', 'shipped'], capture().io);
    delete process.env.MNEMA_RUN;

    const ended = capture();
    await run(['resume', '--actor', anchor], ended.io);
    expect(ended.out.join('\n')).toContain(`last run ${started.id} (ended)`);
    // No age on an ended run: it reports its own end, and an age there reads as time
    // still passing in it.
    expect(ended.out.join('\n')).not.toContain('· open ');
  });

  it('and the MCP surface seals a session with the SAME fact — one shape, each its own agent', async () => {
    // The agreement, over the one record both surfaces write to. What a `run.ended`
    // carries cannot depend on which surface closed it: a reader replays one chain and
    // has no idea which door a fact came through, so a close attributed on one surface
    // and anonymous on the other would make the attribution a property of the caller.
    // It WAS one — the MCP close and the CLI close were the same operation, and the
    // operation took no agent, so both were the person's.
    await initHere();
    const started = await startRun('cli-agent');
    await run(['run', 'end', started.id, '--which', 'cli-agent'], capture().io);

    // The other surface, as the transport opens it: a connection announces its name,
    // writes, and goes away. It is never asked who is closing.
    const session = openSession({
      clientName: 'mcp-agent',
      roots: [pathToFileURL(repo).href],
      env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') },
    });
    const made = runCreateSkill(session, { name: 'Seal it', body: 'Close what you opened.' });
    if (!made.ok) throw new Error(`setup: the MCP write refused (${made.code})`);
    expect(closeSession(session).closed).toHaveLength(1);

    const sealed = eventsOf(treesOf().projectPrivate).filter((e) => e.kind === 'run.ended');
    expect(sealed).toHaveLength(2);
    // The SAME envelope shape from both: one surface cannot carry a field the other
    // leaves off. Compared as key sets, because the values are an id and an instant.
    const shapes = sealed.map((e) => Object.keys(e).sort());
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]).toContain('which');
    // And each names the agent of ITS session — the surfaces agree on the field, not
    // on the value, which is the whole point of recording it.
    expect(new Set(sealed.map((e) => e.which))).toEqual(new Set(['cli-agent', 'mcp-agent']));
  });
});

/**
 * A `--which` that names nobody, end to end.
 *
 * The property under test is not "the flag is validated". It is that an agent
 * cannot become indistinguishable from a person by DECLARING itself and naming
 * nothing — which is what `--which "$AGENT"` with an unset variable does in a CI
 * step, and what the record used to swallow twice over: the `which` dropped out of
 * every event (so the fact asserted a human acted directly) and the birth was
 * routed to the team's COMMITTED tree, because "no agent" is read as "a person
 * captured this".
 *
 * The three forms are not decoration. `canonicalIdentity` is the one rule that
 * decides this, and what it says about a form is the answer here — so a form it
 * reads as an identity (the zero-width one) is asserted to be ACCEPTED, not
 * refused. Guessing would have written the opposite test.
 */
describe('mnema CLI — a --which that names nobody', () => {
  function treesOf() {
    return resolveTrees(repo, { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') });
  }

  /** Every event of a tree, or [] when that tree was never written. */
  function eventsOf(root: string | undefined) {
    return root !== undefined && existsSync(root)
      ? orderedEvents({ root }, catalogUpcasters())
      : [];
  }

  /**
   * The forms that name NO agent, and one that does.
   *
   * Whitespace is the accident (`"$VAR"` empty, a copy-paste that brought a
   * non-breaking space along); the lone surrogate is the value the chain cannot
   * canonicalize at all, which the same rule catches for free.
   */
  const NAMES_NOBODY: readonly (readonly [string, string])[] = [
    ['a space', '   '],
    ['a tab', '\t'],
    ['a non-breaking space (U+00A0)', ' '],
    ['an ideographic space (U+3000)', '　'],
    ['a byte-order mark (U+FEFF)', '﻿'],
    ['a lone surrogate', '\ud800'],
  ];

  for (const [label, value] of NAMES_NOBODY) {
    it(`REFUSES --which that is ${label}, and nothing is recorded`, async () => {
      await run(['init'], capture().io);
      const before = eventsOf(treesOf().projectPublic).length;

      const t = capture();
      await run(['task', 'ship it', '--which', value], t.io);
      expect(t.failed()).toBe(true);
      // The message says both ways out: name the agent, or drop the flag.
      const said = t.err.join('\n');
      expect(said).toContain('--which');
      expect(said).toContain('names no agent');
      expect(said).toContain('a person acted directly');

      // Nothing was born — in ANY tree. The refusal is at the door, before a
      // scope is even resolved, so there is no "it landed somewhere else".
      const trees = treesOf();
      expect(eventsOf(trees.projectPublic).length).toBe(before);
      expect(eventsOf(trees.projectPrivate).some((e) => e.kind === 'task.created')).toBe(false);
      expect(eventsOf(trees.global).some((e) => e.kind === 'task.created')).toBe(false);
    });
  }

  it('a MOVE refuses it too — the flag is read off the parent group, the rule is not', async () => {
    await run(['init'], capture().io);
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
    // A birth is a PAIR (created + the transition into the initial state), so the
    // count before is what "it did not move" is measured against — not zero.
    const transitions = () =>
      eventsOf(treesOf().projectPublic).filter((e) => e.kind === 'task.transitioned').length;
    const before = transitions();

    const m = capture();
    await run(['task', 'move', 'submit', id, '--which', '   '], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('names no agent');
    // The task did not move: the refusal is at parse time, before the action runs.
    expect(transitions()).toBe(before);
  });

  it('`run start --which "   "` refuses, and no session is born', async () => {
    // The old failure here was an INTERNAL error leaking out ("needs a non-empty
    // string at payload.agent") for a value the surface should never have taken.
    await run(['init'], capture().io);
    const s = capture();
    await run(['run', 'start', '--which', ' '], s.io);
    expect(s.failed()).toBe(true);
    expect(s.err.join('\n')).toContain('names no agent');
    expect(s.err.join('\n')).not.toContain('payload.agent');
    expect(eventsOf(treesOf().projectPrivate).some((e) => e.kind === 'run.started')).toBe(false);
  });

  it('`guard --which "   "` refuses — the dry-run answers for the move it mirrors', async () => {
    const who = await foundIdentity();
    const c = capture();
    await run(['task', 'ship it'], c.io);
    const id = (c.out.join('\n').match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;

    const g = capture();
    await run(['guard', 'submit', id, '--actor', who, '--which', '   '], g.io);
    expect(g.failed()).toBe(true);
    expect(g.err.join('\n')).toContain('names no agent');
  });

  it('a zero-width name is a NAME, not a blank: it is recorded and lands private', async () => {
    // What `canonicalIdentity` does with U+200C is the answer, and it keeps it: the
    // char is not whitespace, so this is an (invisible) agent name and not an
    // absent one. That means the two things the hole broke are intact — the `which`
    // is on the event, and the birth went to this machine's private tree — so there
    // is nothing here to refuse. Asserting the opposite would have been asserting
    // a guess.
    await run(['init'], capture().io);
    const t = capture();
    await run(['task', 'ship it', '--which', '‌'], t.io);
    expect(t.failed()).toBe(false);

    const trees = treesOf();
    const created = eventsOf(trees.projectPrivate).find((e) => e.kind === 'task.created');
    expect(created?.which).toBe('‌');
    expect(eventsOf(trees.projectPublic).some((e) => e.kind === 'task.created')).toBe(false);
  });

  it('an ORDINARY agent name did not regress: recorded, and the birth lands private', async () => {
    await run(['init'], capture().io);
    const t = capture();
    await run(['task', 'ship it', '--which', 'claude-code'], t.io);
    expect(t.failed()).toBe(false);

    const trees = treesOf();
    const created = eventsOf(trees.projectPrivate).find((e) => e.kind === 'task.created');
    expect(created?.which).toBe('claude-code');
    // A name with stray whitespace around it is still that name (trimmed), never
    // a refusal — the accident the canonical rule exists to absorb.
    const padded = capture();
    await run(['task', 'and again', '--which', '  claude-code  '], padded.io);
    expect(padded.failed()).toBe(false);
    expect(
      eventsOf(treesOf().projectPrivate)
        .filter((e) => e.kind === 'task.created')
        .map((e) => e.which),
    ).toEqual(['claude-code', 'claude-code']);
  });

  it('an ABSENT --which still means a person acted: no which, and the birth is PUBLIC', async () => {
    // The rule that must NOT change. Defaulting an omitted flag to some agent name
    // would invent an agent where there was a person — the same fiction, inverted.
    await run(['init'], capture().io);
    const t = capture();
    await run(['task', 'ship it'], t.io);
    expect(t.failed()).toBe(false);

    const trees = treesOf();
    const created = eventsOf(trees.projectPublic).find((e) => e.kind === 'task.created');
    expect(created?.which).toBeUndefined();
    expect(eventsOf(trees.projectPrivate).some((e) => e.kind === 'task.created')).toBe(false);
  });

  it('EVERY verb that declares an executing agent validates it — no site can forget', () => {
    // The structural half of the proof: the behaviour above is asserted on a few
    // verbs, and this is what makes it true of the rest — and of the next one
    // somebody adds. A `--which` with no parser is a verb where the hole is open.
    const program = buildProgram(capture().io);
    const declaring: string[] = [];
    const unvalidated: string[] = [];
    const walk = (command: Command, path: string): void => {
      for (const option of command.options) {
        if (option.long !== '--which') continue;
        declaring.push(path);
        if (option.parseArg === undefined) unvalidated.push(path);
      }
      for (const child of command.commands) walk(child, `${path} ${child.name()}`.trim());
    };
    walk(program, '');

    // Every verb that DECLARES the flag is listed, so a new one shows up here.
    expect(declaring.sort()).toEqual(
      [
        'accountability',
        'decision',
        'guard',
        'memory',
        'observe',
        'handoff',
        'link',
        'run start',
        'run end',
        'skill',
        'task',
      ].sort(),
    );
    // …and exactly one is exempt: accountability's `--which` is a FILTER over who
    // already acted, not a declaration of who is acting now.
    expect(unvalidated).toEqual(['accountability']);
  });
});

describe('mnema CLI — what enters the record', () => {
  function treesOf() {
    return resolveTrees(repo, { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') });
  }

  /** Every string anywhere in every payload of a tree — the generic sweep. */
  function recordedText(root: string | undefined): string[] {
    if (root === undefined || !existsSync(root)) return [];
    const found: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        found.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) collect(item);
      }
    };
    for (const event of orderedEvents({ root }, catalogUpcasters())) collect(event.payload);
    return found;
  }

  const SECRET = 'AKIAIOSFODNN7EXAMPLE';

  it('an agent records a credential: the chain holds a placeholder, the agent is told, and it verifies', async () => {
    await run(['init'], capture().io);

    // 1. The write goes through, with the credential in it.
    const m = capture();
    await run(['memory', `the deploy key is ${SECRET}`], m.io);
    expect(m.failed()).toBe(false);
    const printed = m.out.join('\n');
    expect(printed).toContain('Captured memory');

    // 2. What is IN THE CHAIN does not contain the value — the assertion that
    //    matters, over the record itself rather than over the report.
    const trees = treesOf();
    for (const value of recordedText(trees.projectPublic)) {
      expect(value).not.toContain(SECRET);
    }
    // …and the placeholder is what landed instead, with the context intact.
    expect(recordedText(trees.projectPublic)).toContain(
      'the deploy key is <SECRET:aws-access-key>',
    );

    // 3. The AGENT was told, and told what to do — a silent scrub would leave a
    //    live credential unrotated because nobody knew it had been typed.
    expect(printed).toContain('1 value(s) replaced before recording');
    expect(printed).toContain('<SECRET:aws-access-key>');
    expect(printed).toContain('rotate them');

    // 4. The chain still verifies: screening happens before the append, so the
    //    entry it produced is an ordinary signed entry.
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
  });

  it('run start echoes the goal AS RECORDED, not as typed', async () => {
    await run(['init'], capture().io);
    const s = capture();
    await run(['run', 'start', '--which', 'an-agent', '--goal', `deploy with ${SECRET}`], s.io);
    const printed = s.out.join('\n');

    // The echo and the notice sit on consecutive lines, so printing the typed
    // value would put a credential directly above the line saying it was
    // replaced — the product contradicting itself in two lines.
    expect(printed).not.toContain(SECRET);
    expect(printed).toContain('deploy with <SECRET:aws-access-key>');
    expect(printed).toContain('1 value(s) replaced before recording');
  });

  it('the notice stays away when nothing was replaced', async () => {
    await run(['init'], capture().io);
    const m = capture();
    await run(['memory', 'an ordinary note about the merge order'], m.io);
    const printed = m.out.join('\n');
    expect(printed).toContain('Captured memory');
    expect(printed).not.toContain('replaced before recording');
  });

  it('a field over the limit is REFUSED, and nothing is recorded', async () => {
    await run(['init'], capture().io);
    const before = recordedText(treesOf().projectPublic).length;

    const m = capture();
    await run(['memory', 'x'.repeat(65_537)], m.io);
    expect(m.failed()).toBe(true);
    expect(m.err.join('\n')).toContain('Refused (CONTENT_TOO_LARGE)');
    // The refusal is actionable: which field, how big, and what to do instead.
    expect(m.err.join('\n')).toContain('"content"');
    expect(m.err.join('\n')).toContain('split it');

    expect(recordedText(treesOf().projectPublic).length).toBe(before);
  });

  it('`exposure` finds the facts written before the door, and prints no value', async () => {
    await run(['init'], capture().io);

    // A record the door would have cleaned, appended the way a pre-door write
    // left it: the tree's own writer, so the entry is signed and verifiable.
    const trees = treesOf();
    const writer = openTreeForWriting(trees, 'public');
    writer.append(
      memoryCaptured(
        {
          at: '2026-01-01T00:00:00.000Z',
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: '019fa8b7-0410-717b-9af2-cfeb013fc4ac',
        },
        { content: `the old note held ${SECRET}` },
      ),
    );
    writer.checkpoint();

    const e = capture();
    await run(['exposure'], e.io);
    expect(e.failed()).toBe(false);
    const printed = e.out.join('\n');

    // It found it, and named where it is and what class — the actionable half.
    expect(printed).toContain('019fa8b7-0410-717b-9af2-cfeb013fc4ac');
    expect(printed).toContain('public');
    expect(printed).toContain('aws-access-key');
    expect(printed).toContain('Rotate the credentials');
    // And NOT the value — not whole, not as a prefix. A command that printed it
    // would move the credential into the terminal scrollback and the CI log.
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain('AKIA ');
    expect(printed).not.toContain(`${SECRET.slice(0, 8)}`);

    // The same holds for --json, which is the other path a value could take out.
    const j = capture();
    await run(['exposure', '--json'], j.io);
    expect(j.out.join('\n')).not.toContain(SECRET);
    expect(j.out.join('\n')).toContain('aws-access-key');
  });

  it('`exposure` says nothing RECOGNIZABLE rather than nothing, on a clean record', async () => {
    await run(['init'], capture().io);
    await run(['memory', 'the staging password is hunter2'], capture().io);

    const e = capture();
    await run(['exposure'], e.io);
    const printed = e.out.join('\n');
    expect(printed).toContain('Nothing recognizable');
    // WHERE it looked, beside the count. A denominator next to an empty list reads as
    // ground covered, and this command covers the project `cwd` resolves to — the MCP
    // tool, opened over several at once, decomposes its denominator for the same reason.
    expect(printed).toContain('this project’s trees and the machine-global tree');
    // The limit, said where the person reads it: a password in prose has no
    // format, so it is in the record and this report cannot see it.
    expect(printed).toContain('only known credential formats are recognized');
  });

  it('every writing verb declares the contract in its own --help', async () => {
    // The instruction is the layer that covers what the shape cannot reach, so it
    // has to be present at the point of use — not only in a README.
    for (const verb of [
      ['task'],
      ['decision'],
      ['skill'],
      ['memory'],
      ['observe'],
      ['handoff'],
      ['link'],
      ['run'],
      ['task', 'move'],
      ['decision', 'move'],
      ['decision', 'supersede'],
      ['skill', 'move'],
    ]) {
      const h = capture();
      await run([...verb, '--help'], h.io);
      const help = h.out.join('\n');
      expect(help, `${verb.join(' ')} --help`).toContain('Permanent');
      expect(help, `${verb.join(' ')} --help`).toContain('Do not record credentials');
      expect(help, `${verb.join(' ')} --help`).toContain('written verbatim');
    }
  });
});

describe('mnema CLI — skills, the provenance audit', () => {
  /** Runs a verb and returns its stdout as one string. */
  async function output(argv: string[]): Promise<string> {
    const c = capture();
    await run(argv, c.io);
    expect(c.failed()).toBe(false);
    return c.out.join('\n');
  }

  /**
   * The id printed by a verb that mints one — read from the parentheses the verb
   * prints it in, never as the first uuid-shaped run in the line. A name is text
   * an actor wrote, so it can HOLD something uuid-shaped, and the first match
   * would then be the actor's text instead of the record's id.
   */
  function idOf(text: string): string {
    return (text.match(/\(([0-9a-f-]{36})\)/) as RegExpMatchArray)[1] as string;
  }

  /** Proposes, reviews and adopts one pattern, each act declared by `which`. */
  async function adopt(name: string, proposer?: string, adopter?: string): Promise<string> {
    const declare = (agent?: string) => (agent !== undefined ? ['--which', agent] : []);
    const id = idOf(
      await output(['skill', ...declare(proposer), name, '--body', `the pattern of ${name}`]),
    );
    await output(['skill', 'move', 'review', id, '--note', 'read it', ...declare(adopter)]);
    await output(['skill', 'move', 'adopt', id, '--note', 'we work this way', ...declare(adopter)]);
    return id;
  }

  it('shows both acts, and says when ONE agent stands on both ends', async () => {
    await run(['init'], capture().io);
    const id = await adopt('a-habit', 'agent-A', 'agent-A');

    const printed = await output(['skills']);
    expect(printed).toContain('1 pattern(s)');
    expect(printed).toContain(id);
    expect(printed).toContain('proposed by agent-A · adopted by agent-A (the same agent)');
    // The state and the tree, which together say how far the pattern reaches. An
    // agent's write lands private, so that is where this one is.
    expect(printed).toMatch(/adopted\s+private\s+a-habit/);
  });

  it('one agent proposing and ANOTHER adopting is distinguishable from both ends equal', async () => {
    await run(['init'], capture().io);
    await adopt('two-agents', 'agent-A', 'agent-B');

    const printed = await output(['skills']);
    expect(printed).toContain('proposed by agent-A · adopted by agent-B');
    expect(printed).not.toContain('the same agent');
  });

  it('a person’s act reads as "a person", never as a blank or an invented name', async () => {
    await run(['init'], capture().io);
    await adopt('by-hand');

    const printed = await output(['skills']);
    expect(printed).toContain('proposed by a person · adopted by a person');
    // Two absences are not evidence of one actor: a tree can hold two people's
    // facts, so the same-agent line must NOT appear.
    expect(printed).not.toContain('the same agent');
    expect(printed).not.toContain('unknown');
  });

  it('a pattern nobody adopted shows the proposal alone', async () => {
    await run(['init'], capture().io);
    const id = idOf(await output(['skill', '--which', 'agent-A', 'an-idea', '--body', 'maybe']));

    const printed = await output(['skills']);
    expect(printed).toContain(`${id}`);
    expect(printed).toContain('proposed by agent-A');
    expect(printed).not.toContain('adopted by');
  });

  it('reports every state and every visible tree, ordered by name', async () => {
    await run(['init'], capture().io);
    // Two trees: a team pattern in public, an agent's in private.
    const team = idOf(
      await output(['skill', 'Zebra', '--body', 'the team pattern', '--scope', 'public']),
    );
    await output(['skill', 'move', 'review', team, '--note', 'ok']);
    await output(['skill', 'move', 'adopt', team, '--note', 'ok']);
    await adopt('Alpha', 'agent-A', 'agent-A');
    const rejected = idOf(await output(['skill', 'Middle', '--body', 'no']));
    await output(['skill', 'move', 'reject', rejected, '--note', 'not for us']);

    const lines = (await output(['skills'])).split('\n').slice(1);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Alpha');
    expect(lines[1]).toContain('Middle');
    expect(lines[2]).toContain('Zebra');
    expect(lines[1]).toContain('rejected');
    expect(lines[2]).toMatch(/adopted\s+public/);
  });

  it('--json is faithful and carries no body', async () => {
    await run(['init'], capture().io);
    const id = await adopt('a-habit', 'agent-A', 'agent-B');

    const json = JSON.parse(await output(['skills', '--json'])) as Array<{
      id: string;
      name: string;
      state: string;
      scope: string;
      proposedBy?: string;
      adoption?: { at: string; by?: string };
      selfAdopted: boolean;
    }>;
    expect(json).toEqual([
      {
        id,
        name: 'a-habit',
        state: 'adopted',
        scope: 'private',
        proposedBy: 'agent-A',
        adoption: { at: expect.any(String), by: 'agent-B' },
        selfAdopted: false,
      },
    ]);
    // The audit is about provenance; the body is `mnema show <id>`.
    expect(JSON.stringify(json)).not.toContain('the pattern of');
  });

  it('writes NOTHING — not a consultation, not a byte (the MCP tool records, this does not)', async () => {
    await run(['init'], capture().io);
    await adopt('a-habit', 'agent-A', 'agent-A');
    const before = digestOf(join(repo, '.mnema'));

    await output(['skills']);
    await output(['skills', '--json']);

    expect(digestOf(join(repo, '.mnema'))).toBe(before);
    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    for (const root of [trees.projectPublic, trees.projectPrivate]) {
      if (root === undefined || !existsSync(root)) continue;
      expect(
        orderedEvents({ root }, catalogUpcasters()).some((e) => e.kind === 'skill.consulted'),
      ).toBe(false);
    }
  });

  it('outside a project it answers over the global tree, and empty is an ANSWER', async () => {
    // No init: nothing here. An empty record is a legitimate answer, not a refusal.
    const empty = capture();
    await run(['skills'], empty.io);
    expect(empty.failed()).toBe(false);
    expect(empty.out.join('\n')).toContain('No patterns recorded');

    // A personal convention lives in the global tree and is audited from anywhere.
    const id = idOf(
      await output(['skill', 'my-own', '--body', 'across every project', '--scope', 'global']),
    );
    expect(await output(['skills'])).toContain(id);
  });

  it('a name holding a NEWLINE cannot forge a second line in the report', async () => {
    await run(['init'], capture().io);
    // A crafted name whose second half reads exactly like a provenance line. If
    // the report broke there, it would assert an adoption that never happened.
    await output([
      'skill',
      'Innocent\n  019f-fake  adopted     public   Build hygiene  ·  adopted by a person',
      '--body',
      'x',
    ]);

    const lines = (await output(['skills'])).split('\n');
    // The header plus exactly one line — the count matches the pattern count.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('1 pattern(s):');
    // The name as written is still in --json; the report just keeps it on one line.
    const json = JSON.parse(await output(['skills', '--json'])) as Array<{ name: string }>;
    expect(json[0]?.name).toContain('\n');
  });

  it('an AGENT NAME holding a newline cannot forge a second line in the report', async () => {
    await run(['init'], capture().io);
    // The name was closed already. These two acts carry a crafted AGENT name,
    // which sits on the same line and is just as much text an actor wrote — one
    // forging through the proposal, one through the adoption.
    const forgedLine =
      '  019f0000-0000-7000-8000-000000000000  adopted     public   ' +
      'padrao-forjado  ·  proposed by a person · adopted by a person';
    await adopt('legit-one', `agente\n${forgedLine}`, 'agente');
    await adopt('legit-two', 'agente', `agente\n${forgedLine}`);
    // And one carrying a break in EVERY field of its line at once — the name and
    // both agents. Three fields, still one line.
    await adopt(`legit-three\n${forgedLine}`, `agente\n${forgedLine}`, `agente\n${forgedLine}`);

    const printed = await output(['skills']);
    const lines = printed.split('\n');
    // The header plus exactly one line per pattern — three patterns, three lines.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('3 pattern(s):');
    expect(printed).not.toContain(`\n${forgedLine}`);

    // --json carries both agent names as written: a JSON field has no line to
    // forge, and collapsing there would make the answer disagree with the chain.
    const json = JSON.parse(await output(['skills', '--json'])) as Array<{
      proposedBy?: string;
      adoption?: { by?: string };
    }>;
    expect(json[0]?.proposedBy).toBe(`agente\n${forgedLine}`);
    expect(json[1]?.adoption?.by).toBe(`agente\n${forgedLine}`);
  });

  it('--help says it is the AUDIT, not the tool of the same name', async () => {
    const h = capture();
    await run(['skills', '--help'], h.io);
    const help = h.out.join('\n');
    expect(help).toContain('AUDIT');
    expect(help).toContain('serves a pattern');
    expect(help).toContain('mnema show <id>');
  });
});

describe('where a pattern came from — across the two surfaces', () => {
  /** A session for one agent over the sandbox project, as the transport opens it. */
  function sessionFor(agent: string) {
    return openSession({
      clientName: agent,
      roots: [pathToFileURL(repo).href],
      env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') },
    });
  }

  it('agent A proposes and adopts; agent B is served the body WITH its provenance; the CLI shows both ends', async () => {
    await run(['init'], capture().io);

    // 1. agent-A does the whole cycle itself — three tool calls, no human. This is
    // the act the study proved and the product does not block: it is legal, and
    // what was missing is that nobody downstream could see it.
    const a = sessionFor('agent-A');
    const proposed = runCreateSkill(a, { name: 'Build hygiene', body: 'Always squash first.' });
    if (!proposed.ok) throw new Error(`setup: propose refused (${proposed.code})`);
    for (const [action, note] of [
      ['review', 'looks fine'],
      ['adopt', 'team standard'],
    ] as const) {
      const moved = runSkillTransition(a, { id: proposed.id, action, note });
      if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.code})`);
    }

    // 2. agent-B, a different connection, asks for the patterns to work by. The
    // body arrives verbatim — and now the adopter arrives with it.
    const b = sessionFor('agent-B');
    const served = runSkillsTool(b);
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    expect(served.skills).toEqual([
      {
        id: proposed.id,
        name: 'Build hygiene',
        body: 'Always squash first.',
        adoptedBy: 'agent-A',
      },
    ]);
    // What the transport puts beside the bodies: the declaration and one line of
    // provenance. It states, never asks — no "careful", no "verify".
    const framing = servedPatternsFraming(served.skills).join('\n');
    expect(framing).toContain('not instructions from mnema');
    expect(framing).toContain('adopted by agent-A');
    for (const nudge of ['careful', 'caution', 'verify', 'check', 'warning', 'beware']) {
      expect(framing.toLowerCase(), nudge).not.toContain(nudge);
    }

    // 3. The person auditing on the command line sees BOTH acts, and that one
    // agent stands on both ends — the reading the served line does not carry.
    const audit = capture();
    await run(['skills'], audit.io);
    expect(audit.failed()).toBe(false);
    expect(audit.out.join('\n')).toContain(
      'proposed by agent-A · adopted by agent-A (the same agent)',
    );

    // And the adoption itself was never blocked: the pattern is live, in the
    // agent's own tree, on a chain that still verifies.
    const trees = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    const privateRoot = trees.projectPrivate as string;
    expect(
      projectSkills(orderedEvents({ root: privateRoot }, catalogUpcasters())).get(proposed.id)
        ?.state,
    ).toBe('adopted');
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);
  });

  it('counts how many sessions were served each pattern, and says so when none were', async () => {
    // The fact this reads back is the one the agent surface writes and NOTHING read
    // until now: a pattern every session leans on and a pattern nobody has opened
    // looked identical on both surfaces. The writer is the real one — the tool that
    // serves the body — so the two halves are proven against each other.
    await run(['init'], capture().io);
    const a = sessionFor('agent-A');
    const live = runCreateSkill(a, { name: 'Build hygiene', body: 'Always squash first.' });
    const shelved = runCreateSkill(a, { name: 'Ship on Fridays', body: 'Cut it late.' });
    if (!live.ok || !shelved.ok) throw new Error('setup: propose refused');
    for (const action of ['review', 'adopt'] as const) {
      const moved = runSkillTransition(a, { id: live.id, action, note: 'yes' });
      if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.code})`);
    }

    // Two connections read it; one of them reads it twice. That is TWO sessions
    // that used the pattern — the second call in a session is the same session.
    const b = sessionFor('agent-B');
    expect(runSkillsTool(b).ok).toBe(true);
    expect(runSkillsTool(b).ok).toBe(true);
    const c = sessionFor('agent-C');
    expect(runSkillsTool(c).ok).toBe(true);

    const audit = capture();
    await run(['skills'], audit.io);
    expect(audit.failed()).toBe(false);
    const lines = audit.out.filter((line) => line.startsWith('  '));
    expect(lines.find((line) => line.includes(live.id))).toContain('consulted in 2 run(s)');
    // Never adopted, so never served, so never consulted — stated, not left blank.
    expect(lines.find((line) => line.includes(shelved.id))).toContain('never consulted');

    // And the same number when the pattern is opened on its own.
    const opened = capture();
    await run(['show', live.id], opened.io);
    expect(opened.out.join('\n')).toContain('consulted in 2 run(s)');
  });

  it('proposed by one agent and adopted by ANOTHER is a different report', async () => {
    await run(['init'], capture().io);
    const a = sessionFor('agent-A');
    const proposed = runCreateSkill(a, { name: 'Build hygiene', body: 'Always squash first.' });
    if (!proposed.ok) throw new Error('setup: propose refused');
    // A second agent reviews and adopts what the first proposed.
    const b = sessionFor('agent-B');
    for (const [action, note] of [
      ['review', 'read it'],
      ['adopt', 'we work this way'],
    ] as const) {
      const moved = runSkillTransition(b, { id: proposed.id, action, note });
      if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.code})`);
    }

    // The body carries the ADOPTER, which is the act that made it live.
    const served = runSkillsTool(b);
    if (!served.ok) throw new Error('skills refused');
    expect(served.skills[0]?.adoptedBy).toBe('agent-B');

    const audit = capture();
    await run(['skills'], audit.io);
    const printed = audit.out.join('\n');
    expect(printed).toContain('proposed by agent-A · adopted by agent-B');
    expect(printed).not.toContain('the same agent');
  });
});

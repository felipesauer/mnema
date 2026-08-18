/**
 * `mnema antipatterns` on the pattern moves: the three answers, and the one the whole
 * reading exists for.
 *
 * THE SIGNAL A STUDY PROMISED IN PLACE OF A GATE, and the reason it was blocked for a
 * fortnight is the reason this file is mostly about the THIRD answer. A `skill.consulted`
 * is written by the surface that SERVES a body, which is the agent's; a person curating
 * patterns opens the file with `mnema show`, which records nothing and structurally
 * cannot. So a reading that treated "no consultation" as "did not consult" would name
 * every person doing the work correctly — a signal that fires on the correct behaviour is
 * not a signal.
 *
 * What makes the middle answer sayable is the RUN, and the cases below are the truth
 * table it comes from rather than three examples of it:
 *
 *   1. the run was served this pattern's body            → consulted
 *   2. the run was served ANOTHER pattern's body, not this one → the one assertion
 *   3. the run was served nothing at all                 → not observable
 *
 * CASE 3 IS DRIVEN TWICE, and the second time is the point. Once through the agent's
 * surface with no consultation in the run, and once by a PERSON at the command line —
 * `run start`, `mnema show <id>`, `mnema skill move review <id>` — which is the exact
 * sequence the study said no rule could tell apart from skipping the reading. The rule of
 * the run tells it apart, and the page comes back with nothing pointed at that pattern.
 *
 * A13: NOTHING HERE WRITES A `skill.consulted` BY HAND. Every one of them comes out of
 * `runSkillsTool`, the only thing in the product that writes one, and every move comes out
 * of the MCP tool or the CLI verb that moves a pattern. A fixture that appended the event
 * itself would leave this suite green over a shape the product does not produce — and the
 * envelope field the whole rule turns on (`run`) is exactly the field a hand-written
 * fixture gets to choose.
 *
 * AND IT IS A READ, PROVED BY BYTES. The last case digests the whole sandbox around the
 * invocation, on a record that HAS an accusation in it, so the guard cannot pass by
 * finding nothing to report.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { openSession, type Session } from '../src/mcp/session.js';
import {
  runAntipatternsTool,
  runCreateSkill,
  runSkillsTool,
  runSkillTransition,
} from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/**
 * The one line of the page that ASSERTS something, verbatim.
 *
 * It is a whole label and not a word, and the difference is load-bearing: the closing
 * note says "never a move made without consulting", so a case checking for the absence of
 * a loose phrase would find the reading's own disclaimer and go red on the page it is
 * meant to pass.
 */
const ACCUSES = 'moved without consulting it';

/** A fragment of the closing note, distinctive enough to prove the sentence is there. */
const WITNESS_NOTE = 'a consultation is recorded when the AGENT surface serves a body';

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

/** One move, as the reading reports it. */
interface ReportedMove {
  readonly skill: string;
  readonly action: string;
  readonly run?: string;
}

/** The three answers, read out of the JSON the verb emits. */
interface Reported {
  readonly note: string;
  readonly consulted: ReportedMove[];
  readonly movedWithoutConsulting: ReportedMove[];
  readonly notObservable: ReportedMove[];
}

/** `mnema antipatterns --json`, parsed down to the reading this file is about. */
async function reported(): Promise<Reported> {
  const said = await mnema('antipatterns', '--json');
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return (JSON.parse(said.out.join('\n')) as { patternMoves: Reported }).patternMoves;
}

/** The page a person gets, as one string. */
async function page(): Promise<string> {
  const said = await mnema('antipatterns');
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return said.out.join('\n');
}

/** An agent connection over this project — the surface that serves a body. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** Proposes a pattern through the agent's surface and returns its id. */
function propose(session: Session, name: string): string {
  const created = runCreateSkill(session, { name, body: `the body of ${name}` });
  if (!created.ok) throw new Error(`setup: propose refused — ${created.message}`);
  return created.id;
}

/** Has the connection served a body — the only thing that writes a consultation. */
function consult(session: Session, id: string): void {
  const served = runSkillsTool(session, { id });
  if (!served.ok) throw new Error(`setup: skills refused — ${served.message}`);
  // Non-vacuity: a call answered in NAMES records nothing, and this whole file would
  // then be measuring a run with no consultation in it under three different labels.
  expect(served.served).toBe('bodies');
}

/** Moves a pattern through the agent's surface. */
function move(session: Session, id: string, action: 'review' | 'adopt' | 'deprecate'): void {
  const moved = runSkillTransition(
    session,
    action === 'deprecate'
      ? { id, action, reason: 'it fell out of use' }
      : { id, action, note: `a verdict on ${action}` },
  );
  if (!moved.ok) throw new Error(`setup: move refused — ${moved.message}`);
}

/**
 * A content digest of every file under `dir` — the shape the read-only guards of this
 * suite share.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-witness-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'data') };
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
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

describe('the three answers the record can give about a pattern move', () => {
  it('a run served the body and then moving the pattern comes back consulted', async () => {
    const session = connect();
    const id = propose(session, 'the-way-we-slice');
    consult(session, id);
    move(session, id, 'review');

    const witness = await reported();
    expect(witness.consulted.map((m) => [m.skill, m.action])).toEqual([[id, 'review']]);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.notObservable).toEqual([]);
    // The consultation and the move name the SAME session — the field the whole rule
    // turns on, so a run that quietly stopped travelling would not pass here.
    expect(witness.consulted[0]?.run).toBeDefined();
    expect(await page()).toContain('pattern moves with a consultation in the same run: 1');
  });

  it('a run served another pattern and moving this one is the one case it asserts', async () => {
    const session = connect();
    const read = propose(session, 'the-one-we-read');
    const moved = propose(session, 'the-one-we-moved');
    consult(session, read);
    move(session, moved, 'review');

    const witness = await reported();
    // The run recorded a consultation, so its silence about the other pattern MEANS
    // something — and it is the only pattern the reading names.
    expect(witness.movedWithoutConsulting.map((m) => [m.skill, m.action])).toEqual([
      [moved, 'review'],
    ]);
    expect(witness.consulted).toEqual([]);
    expect(witness.notObservable).toEqual([]);

    const said = await page();
    expect(said).toContain('pattern moves with none, in a run that recorded others: 1');
    expect(said).toContain(`${ACCUSES}: ${moved} (review)`);
    // And the pattern the run DID read is not on the accused line.
    expect(said.split('\n').find((line) => line.startsWith(ACCUSES))).not.toContain(read);
  });

  it('a run that recorded no consultation at all is not observable, and nothing accuses', async () => {
    const session = connect();
    const id = propose(session, 'the-way-we-slice');
    move(session, id, 'review');

    const witness = await reported();
    expect(witness.notObservable.map((m) => [m.skill, m.action])).toEqual([[id, 'review']]);
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.consulted).toEqual([]);

    // TWO ASSERTIONS, and the second is the one this reading exists for: the page says
    // the count, and it says nothing ABOUT this pattern — the accusing line is absent,
    // and so is the id it would have carried.
    const said = await page();
    expect(said).toContain('pattern moves in a run with no consultation at all: 1');
    expect(said).not.toContain(ACCUSES);
    expect(said).not.toContain(id);
  });

  it('a person driving the command line — run start, show, skill move — is never accused', async () => {
    // The sequence the study said nothing could tell apart from skipping the reading:
    // a session IS open, the body WAS read, and `mnema show` records nothing because the
    // auditor's surface has no writer. The rule of the run tells it apart.
    const proposed = await mnema('skill', 'the-way-we-slice', '--body', 'a reusable pattern');
    expect(proposed.failed, proposed.err.join(' / ')).toBe(false);
    const id = /\(([0-9a-f-]{36})\)/.exec(proposed.out.join('\n'))?.[1] as string;
    expect(id).toBeDefined();

    const started = await mnema('run', 'start', '--which', 'a-person-at-a-terminal');
    expect(started.failed, started.err.join(' / ')).toBe(false);
    const opened = /^Started run ([0-9a-f-]{36})$/m.exec(started.out.join('\n'))?.[1] as string;
    expect(opened).toBeDefined();
    // What the printed export line does in a shell, done here.
    process.env.MNEMA_RUN = opened;

    const shown = await mnema('show', id);
    expect(shown.failed, shown.err.join(' / ')).toBe(false);
    // Non-vacuity: the body really was served, which is the half `show` does and the
    // half that leaves no trace.
    expect(shown.out.join('\n')).toContain('a reusable pattern');

    const reviewed = await mnema('skill', 'move', 'review', id, '--note', 'it reads well');
    expect(reviewed.failed, reviewed.err.join(' / ')).toBe(false);

    const witness = await reported();
    expect(witness.movedWithoutConsulting).toEqual([]);
    expect(witness.notObservable.map((m) => [m.skill, m.action, m.run])).toEqual([
      [id, 'review', opened],
    ]);
    const said = await page();
    expect(said).not.toContain(ACCUSES);
    expect(said).not.toContain(id);
  });

  it('says what it can witness on the page, in all three cases', async () => {
    // The closing note is not a footer: it is what makes the counts above it readable,
    // so it is on the page whatever the record says — including when there is no move in
    // it at all.
    expect(await page()).toContain(WITNESS_NOTE);

    const session = connect();
    const read = propose(session, 'the-one-we-read');
    const moved = propose(session, 'the-one-we-moved');
    consult(session, read);
    move(session, read, 'review');
    move(session, moved, 'review');
    // A SECOND connection, which is a second run, and it records no consultation: the
    // third answer cannot be had from the first session, whose own consultation is
    // exactly what makes its silence sayable.
    const quiet = connect();
    const unread = propose(quiet, 'the-one-nobody-read');
    move(quiet, unread, 'review');

    const said = await page();
    // All three answers are on this one page — consulted, asserted, and unobservable —
    // so the sentence is being read beside every one of them rather than beside a zero.
    expect(said).toContain('pattern moves with a consultation in the same run: 1');
    expect(said).toContain('pattern moves with none, in a run that recorded others: 1');
    expect(said).toContain('pattern moves in a run with no consultation at all: 1');
    expect(said).toContain(WITNESS_NOTE);
    // And it travels in the JSON, for the reader who never sees the page.
    expect((await reported()).note).toContain(WITNESS_NOTE);
  });

  it('is the command line’s alone — the agent’s own audit tool carries none of it', () => {
    // The axis, held to being an axis. Handing an agent a tool for checking whether it
    // consulted before it moved lets the audited party clear the finding before anybody
    // reads it, so this reading rides beside `Antipatterns` rather than inside it — and
    // that is a property of a type, which nothing but a case like this can see.
    const session = connect();
    const read = propose(session, 'the-one-we-read');
    const moved = propose(session, 'the-one-we-moved');
    consult(session, read);
    move(session, read, 'review');
    move(session, read, 'adopt');
    move(session, read, 'deprecate');
    move(session, moved, 'review');

    const answered = runAntipatternsTool(session);
    if (!answered.ok) throw new Error(`the tool refused — ${answered.message}`);
    const said = JSON.stringify(answered.value);
    // Non-vacuity FIRST: the tool really did answer about THIS record, with a shape in
    // it. Without this the checks below would pass over a refusal or an empty object.
    expect(said).toContain(read);
    for (const absent of ['movedWithoutConsulting', 'notObservable', 'patternMoves', moved]) {
      expect(said, `the agent's surface must not carry ${absent}`).not.toContain(absent);
    }
  });

  it('writes nothing — the whole sandbox, byte for byte, around the reading', async () => {
    const session = connect();
    const read = propose(session, 'the-one-we-read');
    const moved = propose(session, 'the-one-we-moved');
    consult(session, read);
    move(session, moved, 'review');
    // The guard is taken over a record that HAS something to report. Hashed around an
    // empty answer it would pass on a reading that writes when it finds a move.
    expect(await page()).toContain(`${ACCUSES}: ${moved} (review)`);

    const before = digest(sandbox);
    await mnema('antipatterns');
    await mnema('antipatterns', '--json');
    expect(digest(sandbox)).toBe(before);
  });
});

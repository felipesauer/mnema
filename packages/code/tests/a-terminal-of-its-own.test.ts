/**
 * The read-only session, over the surface it is actually a session of.
 *
 * `repl/session.test.ts` proves the gate can tell a read from a write from a word
 * nobody declared, on declarations it owns. This file is the other half: it asks the
 * REAL program what each verb declared and holds the session to it — every read
 * offered, every write refused — so a verb added tomorrow lands in one of the two
 * enumerations without an edit here.
 *
 * AND IT MEASURES, because "it only reads" is a claim about a record and not about a
 * branch. The whole surface is typed into a session over a real project — every read,
 * every write — and what is counted before and after is the number of events in every
 * tail of every tree plus the key material on the machine, exactly as
 * `every-verb-says-if-it-writes.test.ts` counts them. That file cannot cover `repl`
 * itself: the session refuses without a terminal at both ends, so no row of its table
 * can reach the loop. This is where that row is paid.
 *
 * THE MEASUREMENT'S OWN TEETH are here too. A session that refused everything would
 * leave the record untouched and pass, saying nothing — so the reads are checked for
 * having ANSWERED, and one write typed at the SHELL over the same fixture is checked
 * for moving the count that the same writes typed at the PROMPT do not move. Without
 * that pair, "the record did not change" is a sentence about a test that did nothing.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { completionTree } from '../src/completion/tree.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { completerFor } from '../src/repl/complete.js';
import { dispositionOf, verbsOffered } from '../src/repl/gate.js';
import { whatTheSessionShowed } from '../src/repl/seen.js';
import { openSession, theSessionsOwnWords, typedLine } from '../src/repl/session.js';
import { LEAVE, SESSION_WORDS } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import type { Declared } from '../src/wiring/verb.js';
import { fakeTerminal, hooksNothing, until } from './support/console.js';
import { held } from './support/the-record-held.js';

/** `packages/code/src`, for the guard that reads the session's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** One escape byte, written as an escape so no control byte enters this file. */
const ESC = '\u001b';

// ---------------------------------------------------------------------------
// What the program declares, and what the session makes of it
// ---------------------------------------------------------------------------

/** Every verb's declaration, read off the entry's own program. */
function declared(): readonly Declared[] {
  const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  return buildProgram(quiet).verbs;
}

const DECLARED = declared();

/** The verbs on one side of the classification, in registration order. */
function verbsThat(effect: Declared['effect']): string[] {
  return DECLARED.filter((verb) => verb.effect === effect).map((verb) => verb.command.name());
}

// ---------------------------------------------------------------------------
// What reached the record
// ---------------------------------------------------------------------------

// WHAT THE RECORD HOLDS WAS SPELLED HERE AND IT IS ONE INSTRUMENT NOW. The same rule was
// written out in `every-verb-says-if-it-writes.test.ts`, and a third case needed it — so the
// counting of events and the hashing of key material moved to one place, where the argument for
// what it counts and what it deliberately does not lives with it (`support/the-record-held.ts`).

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let repo: string;
let anchor: string;
let task: string;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** Everything one invocation wrote, on either stream, and whether it failed. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Captures what `work` writes through an injected port. */
async function captured(work: (io: CliIo) => Promise<void>): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  await work({
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { out, err, failed };
}

/** `mnema <argv>` at the shell, with output injected. */
const shell = (...argv: string[]): Promise<Said> => captured((io) => run(argv, io));

/**
 * One line typed at the session's prompt, with output injected.
 *
 * The session KNOWS NOBODY, deliberately and by name: what is asked here is what the gate
 * does with a line, and a session with an identity fills a flag into some of them
 * (`repl/asking.ts`). The cases below type the actor out where a verb needs one, so this
 * is the session that changes nothing about what they run.
 */
const prompt = (line: string, render = renderPlain): Promise<Said> =>
  captured(async (io) => {
    await typedLine(line, { io, render, self: REPL_VERB, identity: undefined });
  });

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-session-'));
  repo = join(sandbox, 'project');
  mkdirSync(repo, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell, for the reason
  // the golden clears them: the styled half of this file asserts the rule's answer, not
  // an environment's.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(repo);

  const founded = await shell('init');
  const identity = founded.out.find((line) => line.trim().startsWith('identity:'));
  if (identity === undefined) throw new Error(`fixture: init printed no identity: ${founded.out}`);
  anchor = identity.trim().slice('identity:'.length).trim();
  const created = await shell('task', 'the task the session is asked about');
  const id = created.out.join('\n').match(/\(([0-9a-f-]{36})\)/);
  if (id?.[1] === undefined) throw new Error(`fixture: task printed no id: ${created.out}`);
  task = id[1];
}, 120_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('the session offers the reads and refuses the writes', () => {
  it('runs every verb that declared it reads, enumerated from the declaration', () => {
    // Not a list here: whatever the program says reads, the session must run. A read
    // added tomorrow arrives covered, and one that changes sides arrives red.
    const offered = verbsOffered(DECLARED, REPL_VERB);
    for (const verb of verbsThat('reads')) {
      if (verb === REPL_VERB) continue;
      expect(dispositionOf(verb, DECLARED, REPL_VERB).does, verb).toBe('run');
      expect(offered, verb).toContain(verb);
    }
    // And the enumeration is not empty, which is the way this case could pass saying
    // nothing at all.
    expect(offered.length).toBeGreaterThanOrEqual(15);
    expect(offered).not.toContain(REPL_VERB);
  });

  it('refuses every verb that declared it writes, enumerated from the declaration', async () => {
    // THE CENTRAL GUARANTEE. Each write is TYPED, so what is checked is the session's
    // answer and not a predicate about it, and each refusal has to name the verb and
    // say where to run it — a no that does not is a no a caller has to guess past.
    const writes = verbsThat('mutates');
    expect(writes.length).toBeGreaterThanOrEqual(11);
    for (const verb of writes) {
      const said = dispositionOf(verb, DECLARED, REPL_VERB);
      expect(said.does, verb).toBe('refuse');
      const answered = await prompt(verb);
      expect(answered.err.join('\n'), verb).toContain(`\`${verb}\` can change the record`);
      expect(answered.err.join('\n'), verb).toContain(`mnema ${verb}`);
      // Nothing was printed on the other stream: a refused line produces a refusal and
      // no output, which is how a reader tells one from the other.
      expect(answered.out, verb).toEqual([]);
    }
  });

  it('leaves nothing in the record after the whole surface is typed at its prompt', async () => {
    // The measurement. Every verb there is goes through the session — the reads for
    // real, the writes to be refused — and the record is counted around all of it.
    const started = held(sandbox);
    const answers: string[] = [];
    for (const verb of verbsThat('mutates')) await prompt(verb);
    for (const verb of verbsThat('reads')) {
      if (verb === REPL_VERB) continue;
      // `--help` is what every verb answers without an argument of its own, so the
      // exercise needs no table of invocations to stay enumerated. It runs the verb's
      // whole declaration through the session's own parse.
      const said = await prompt(`${verb} --help`);
      expect(said.out.join('\n'), verb).toContain(`Usage: mnema ${verb}`);
      answers.push(...said.out);
    }
    // And four reads that really read, so the exercise is not one long help text.
    for (const line of [
      'verify',
      'search',
      `show ${task}`,
      `focus --actor ${anchor}`,
      'accountability',
    ]) {
      const said = await prompt(line);
      expect(said.out.length, line).toBeGreaterThan(0);
      answers.push(...said.out);
    }
    const ended = held(sandbox);
    expect(ended.events).toBe(started.events);
    expect(ended.keys).toBe(started.keys);

    // THE TEETH. The same fixture, one write typed at the SHELL: the count moves. So
    // "nothing changed" above is a fact about the session and not about a measurement
    // that cannot see a write.
    await shell('memory', 'a fact the shell recorded');
    expect(held(sandbox).events).toBe(started.events + 1);
    // And the exercise really produced answers — at least one line per read it ran,
    // counted off the declaration so the floor cannot drift from the surface.
    expect(answers.length).toBeGreaterThanOrEqual(verbsThat('reads').length);
  }, 120_000);

  it('refuses a word no verb answers to, without handing it to the parser', async () => {
    const said = await prompt('nosuchverb --force');
    expect(said.err.join('\n')).toContain('This session does not run `nosuchverb`');
    // commander's own refusal for an unknown command would name the program and point
    // at `--help`; the session answered before the parser saw the line, which is what
    // makes default-deny structural rather than a bet on somebody else's dispatch.
    expect(said.err.join('\n')).not.toContain('mnema has no command');
  });
});

describe('the session needs a terminal', () => {
  it('refuses in this process, which is not one, and says what to do instead', async () => {
    const said = await shell(REPL_VERB);
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('is an interactive session and this is not a terminal');
    expect(said.err.join('\n')).toContain('mnema <verb>');
    expect(said.out).toEqual([]);
  });

  it('refuses in a real process whose streams are pipes, and exits non-zero', () => {
    // The in-process case drives an injected port; this one is the binary, with the
    // streams a caller would actually give it — and it must COME BACK, because a
    // session that read a pipe would sit on it until the pipe closed.
    const done = spawnSync(process.execPath, [CLI, REPL_VERB], {
      cwd: repo,
      env: { ...process.env, HOME: join(sandbox, 'home'), XDG_DATA_HOME: join(sandbox, 'data') },
      input: 'verify\n',
      encoding: 'utf-8',
      timeout: 30_000,
    });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain('is an interactive session and this is not a terminal');
    expect(done.stdout).toBe('');
  }, 60_000);
});

describe('the bare invocation is untouched', () => {
  it('prints the help and fails, byte for byte what `--help` prints', async () => {
    // The verb was added so that this stays true. `mnema` with no verb has printed the
    // help since the first commit, and an agent that ran the binary in a terminal and
    // met a prompt instead would wait for input nobody is going to type.
    const bare = await captured((io) => run([], io));
    const help = await captured((io) => run(['--help'], io));
    expect(bare.err.join('\n')).toBe(help.out.join('\n'));
    expect(bare.failed).toBe(true);
    expect(bare.out).toEqual([]);
    // And the new verb is IN that help, which is the one line of it this delivery moved.
    expect(bare.err.join('\n')).toContain(REPL_VERB);
  });

  it('comes back, in a real process, rather than waiting for a line', () => {
    const done = spawnSync(process.execPath, [CLI], {
      cwd: repo,
      env: { ...process.env, HOME: join(sandbox, 'home') },
      input: '',
      encoding: 'utf-8',
      timeout: 30_000,
    });
    expect(done.status).toBe(1);
    expect(done.stdout).toBe('');
    expect(done.stderr).toContain('Usage: mnema [options] [command]');
  }, 60_000);
});

describe('the session prints through the surface’s own renderer', () => {
  /** Every escape sequence out, so what is left is what a pipe would have received. */
  const stripped = (line: string): string =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
    line.replace(/\u001b\[[0-9;]*m/g, '');

  it('paints inside the session, and says exactly what the plain line says', async () => {
    // Inside a terminal stdout IS one, so this is the first place on this surface where
    // painting is the normal path rather than the exception. The promise the three
    // colour deliveries made is that style adds nothing and drops nothing — asserted
    // here against the same command run outside the session, which resolves to plain by
    // the rule and not by a fixture asking for it.
    let painted = 0;
    for (const line of ['verify', 'accountability', `show ${task}`, 'skills', 'brief']) {
      const inside = await prompt(line, renderStyled);
      const outside = await shell(...line.split(' '));
      expect(inside.out.map(stripped), line).toEqual(outside.out);
      if (inside.out.join('\n').includes(ESC)) painted++;
    }
    // Some of them come out IDENTICAL, and that is the renderer working rather than a
    // gap: a list of plain columns opens nothing, so its styled line is byte for byte
    // its plain one (`accountability` is one). What the case needs is that the
    // comparison is not vacuous — that painting happened at all — and `verify`'s
    // verdict is the shape that carries both a weight and a hue.
    expect(painted).toBeGreaterThan(0);
    const verdict = await prompt('verify', renderStyled);
    expect(verdict.out.join('\n')).toContain(`${ESC}[1m`);
    expect(verdict.out.join('\n')).toContain(`${ESC}[32m`);
  }, 60_000);

  it('paints the refusal too, and never paints a plain session', async () => {
    const painted = await prompt('task something', renderStyled);
    expect(painted.err.join('\n')).toContain(`${ESC}[31m`);
    const plain = await prompt('task something');
    expect(plain.err.join('\n')).not.toContain(ESC);
    expect(plain.err.map(stripped)).toEqual(painted.err.map(stripped));
  });
});

describe('tab offers what the session runs, over the real tree', () => {
  it('offers every read and not one write, with a record already on the page', async () => {
    const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const { program } = buildProgram(quiet);
    const offered = verbsOffered(DECLARED, REPL_VERB);
    // A SESSION THAT HAS SOMETHING TO OFFER, and it is fed the bytes a read of this
    // product really writes. Without it both absences below are absences of everything:
    // a top level that leaked ids, or a walk that descended into a write and offered the
    // records under it, would have nothing to leak and would pass.
    const seen = whatTheSessionShowed();
    for (const line of (await shell('search', '')).out) seen.saw(line);
    expect(
      seen.matching('').map((offer) => offer.word),
      'the read named no record',
    ).toContain(task);
    const complete = completerFor(
      completionTree(program),
      offered,
      theSessionsOwnWords(),
      seen.matching,
    );
    // The WORDS of what is offered — each offer also carries what it is, which is what the
    // palette draws its second column from and is asserted where the palette is
    // (`tests/a-palette-for-the-words.test.ts`).
    const hits = complete('')[0].map((hit) => hit.word);
    expect(hits).toEqual([...offered, ...SESSION_WORDS].sort());
    for (const write of verbsThat('mutates')) expect(hits, write).not.toContain(write);
    // A LINE DOES NOT START WITH AN ID, so the top level offers none however many the
    // session has named.
    expect(hits, 'the top level offered a record').not.toContain(task);
    // And it does not descend into a write either: the level under one is a level this
    // session cannot reach, so offering its subcommands — or the records it has seen —
    // would be a menu of a place the next line refuses to go.
    expect(complete('task ')).toEqual([[], '']);
    // WHERE IT DOES OFFER ONE: under a read, which is where an argument goes.
    expect(complete('show ')[0].map((hit) => hit.word)).toContain(task);
  }, 60_000);
});

describe('what answers a Tab reaches for no door onto the disk', () => {
  /**
   * The two modules a keystroke goes through to be answered.
   *
   * A Tab over a record is the one offer on this surface whose candidates are in no
   * declaration, and the objection written against it before it existed was that the only
   * way to know one is to READ. That it does not is measured — the reads a Tab causes are
   * counted in `tests/the-name-and-the-hints.test.ts` — and this is the other half: an
   * absence in the source, so a door added here is refused before anybody has to notice a
   * counter moving.
   */
  const ANSWERING = ['complete.ts', 'seen.ts'];

  /**
   * Every way a module of this workspace opens something.
   *
   * The chain is on the list because it is the door the SIBLING really uses: where the
   * session is standing is a `readdir` and a small file, and neither is spelled here —
   * `standing.ts` asks `@mnema/chain` for both. A ban that named only `node:fs` would
   * have missed the one module that proves it can accuse anything.
   *
   * What is deliberately NOT on it is `@mnema/core`, because one thing is taken from
   * there and it is a pattern match with no I/O in it: the form an id is written in
   * (`mintedIdsIn`), which is the recognizer this whole affordance is built out of.
   */
  const DOORS: readonly { readonly why: string; readonly term: RegExp }[] = [
    { why: 'the filesystem is a door onto the record', term: /['"]node:fs['"]/ },
    { why: 'so is a read of one', term: /readFileSync|readdirSync|openSync|existsSync/ },
    { why: 'and so is anything that resolves a tree', term: /tree-sources|@mnema\/copilot/ },
    { why: 'and the chain is the door the record is really behind', term: /@mnema\/chain/ },
  ];

  const opening = (source: string): string[] =>
    DOORS.filter((door) => door.term.test(source)).map((door) => door.why);

  it('opens nothing, in either module', () => {
    for (const file of ANSWERING) {
      const source = readFileSync(join(SRC, 'repl', file), 'utf-8');
      expect(opening(source), file).toEqual([]);
      // The corpus is real rather than a path that does not exist.
      expect(source.length).toBeGreaterThan(1000);
    }
  });

  it('and the ban would accuse the line a careful author would write', () => {
    // NOT VACUOUS, IN BOTH DIRECTIONS. Each term is checked against the line somebody
    // would really add — and a SIBLING of these two trips it, because reading is exactly
    // what that one is for: where the session is standing is a `readdir` and a small file.
    expect(opening(`import { readdirSync } from 'node:fs';`)).toHaveLength(2);
    expect(opening(`import { withScopedCaches } from '../tree-sources.js';`)).toHaveLength(1);
    expect(opening(readFileSync(join(SRC, 'repl', 'standing.ts'), 'utf-8')).length).toBeGreaterThan(
      0,
    );
  });
});

describe('the session writes no history anywhere', () => {
  /**
   * What a module of the session may not reach, and the line each one would be.
   *
   * A ban list goes vacuous the day its terms stop matching anything anyone would
   * write, so each is checked against the line a careful author WOULD write — the
   * import and the call together, so the build would not have failed first and hidden
   * the accusation.
   */
  const FORBIDDEN: readonly { readonly why: string; readonly term: RegExp }[] = [
    {
      why: 'node:repl keeps a history file when an environment variable names one',
      term: /['"]node:repl['"]/,
    },
    {
      why: 'a history file is a decision about the caller’s home that nobody has taken',
      term: /historyFile|history_file/i,
    },
    {
      why: 'nothing in a session writes to disk',
      term: /writeFileSync|appendFileSync|createWriteStream|writeFile\(/,
    },
    { why: 'the caller’s home is not this product’s to write in', term: /homedir\(|env\.HOME/ },
  ];

  /**
   * Every module of `src/repl`, tests excluded.
   *
   * By EXTENSION and not by a list, and the extension is the one thing here that could
   * quietly stop matching: a module written in another dialect of the same language
   * would be a module of the session this scan does not read, and the ban below would
   * pass over it saying nothing. The enumeration at the end of the case is what makes
   * that visible — it names every file there is, so one this filter cannot see is one
   * the case reports missing.
   */
  const modules = (): readonly string[] =>
    readdirSync(join(SRC, 'repl'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();

  /** What a source reaches for that a session may not. */
  const reaching = (source: string): string[] =>
    FORBIDDEN.filter((forbidden) => forbidden.term.test(source)).map((forbidden) => forbidden.why);

  it('reaches for nothing that outlives the process', () => {
    for (const file of modules()) {
      expect(reaching(readFileSync(join(SRC, 'repl', file), 'utf-8')), file).toEqual([]);
    }
    // The corpus is real: an empty directory passes this and says nothing. And it is
    // every file, so a module the filter above cannot see is a module missing here.
    expect(modules()).toEqual([
      'area.ts',
      'asking.ts',
      'complete.ts',
      'console.ts',
      'editing.ts',
      'erasing.ts',
      'floor.ts',
      'following.ts',
      'gate.ts',
      'inset.ts',
      'leaving.ts',
      'palette.ts',
      'panel.ts',
      'pointing.ts',
      'region.ts',
      'scrolling.ts',
      'seen.ts',
      'session.ts',
      'standing.ts',
    ]);
    expect(readdirSync(join(SRC, 'repl')).filter((file) => !file.endsWith('.ts'))).toEqual([]);
  });

  it('would accuse the line an author would write', () => {
    const relapse = [
      "import { start } from 'node:repl';",
      "import { appendFileSync } from 'node:fs';",
      "const historyFile = join(homedir(), '.mnema_history');",
      'appendFileSync(historyFile, rl.history.join());',
    ].join('\n');
    expect(reaching(relapse).length).toBe(FORBIDDEN.length);
    expect(reaching('const rl = createInterface({ input, output });')).toEqual([]);
  });
});

describe('the loop is wired to the gate and to the tree', () => {
  it('completes a verb on Tab, runs it, and leaves on the word that leaves', async () => {
    // The elo, end to end and without a device to hand: the completer the console was
    // given is the one built from the command tree, the line it completes is the line
    // the gate then runs, and the answer lands on the page. Each step waits for the one
    // before it, so nothing here is a sleep whose length is a guess.
    const terminal = fakeTerminal();
    const aside: string[] = [];
    const io: CliIo = {
      out: (line) => aside.push(line),
      err: (line) => aside.push(line),
      fail: () => undefined,
    };
    const closed = openSession({
      io,
      renderingAt: () => renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });

    // The prompt WITHOUT its trailing space: the layout trims the end of every row it
    // writes, and the caret is put back where the space would have been.
    await until(() => terminal.bytes().includes('mnema>'), 'prompted');
    terminal.type('veri');
    await until(() => terminal.bytes().includes('veri'), 'echoed what was typed');
    terminal.type('\t');
    await until(() => terminal.bytes().includes('verify'), 'completed the verb on Tab');
    terminal.type('\r');
    await until(
      () => terminal.bytes().includes('local integrity verified'),
      'answered the completed line',
    );

    terminal.type(`${LEAVE}\r`);
    await closed;
    const page = terminal.bytes();
    // The banner is the session's own, and it counts the reads it offers rather than
    // stating a number that would go stale.
    expect(page).toContain('a session over this project');
    expect(page).toContain(`${verbsOffered(DECLARED, REPL_VERB).length} verbs`);
    // And NOT ONE line went to the port the process would have written on: inside a
    // session every line lands on the page, which is the whole of what changed.
    expect(aside).toEqual([]);
  }, 60_000);
});

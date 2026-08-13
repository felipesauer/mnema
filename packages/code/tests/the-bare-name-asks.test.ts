/**
 * THE BARE NAME ASKS WHAT YOU WANT — at a terminal, and nowhere else.
 *
 * `mnema` with nothing after it printed the catalogue: twenty-nine verbs at once, with the
 * options above them. That is the right answer for somebody who knows what they are looking
 * for and the wrong one for somebody who has just typed the name of a program. So at a
 * terminal it asks, with two doors that depend on what is in this directory.
 *
 * THE HALF EVERYTHING RESTS ON IS THE OTHER ONE. Without a terminal the answer did not move
 * by a byte: the help, on stderr, with the exit code of one. Every shell pipeline, every
 * script and every CI job that has ever run this binary with no arguments is on that side of
 * the decision, and `src/cli.help.golden.txt` is where those bytes are pinned — this file is
 * what says the entry DELEGATES to the very call the golden drives, and what says the
 * question really does appear when the same call is made at a device.
 *
 * WHAT EACH CASE NEEDS THE INSTRUMENT IT USES FOR:
 *
 *   - THE PIPE is asked IN PROCESS, with the port injected and nothing that is a terminal.
 *     That is the shape the golden itself drives, and it is what makes "byte for byte"
 *     a comparison between two transcripts rather than a claim.
 *   - THE QUESTION is asked on a REAL PSEUDO-TERMINAL, because whether a device is a
 *     terminal is the whole discriminant and only a device answers it. What the page says,
 *     which door the arrows land on and what choosing RUNS are all read off the bytes a
 *     terminal received.
 *   - WHAT IT WROTE is counted around the run, off the sandbox's own files, and with teeth:
 *     a real write in the same fixture moves the number (`support/the-record-held.ts`).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { theDoors } from '../src/choice/doors.js';
import { buildProgram, type CliIo, run, start } from '../src/cli.js';
import { PICK } from '../src/repl/palette.js';
import { INIT_VERB } from '../src/wiring/init.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { ESC, fakeTerminal, until, withoutLayout } from './support/console.js';
import {
  arrivedSince,
  inPty as drive,
  type Fixture,
  FRAME_IS_DRAWN,
  type Ran,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import { held } from './support/the-record-held.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** `packages/code/src`, for the guards that read this surface's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** What the console's own opening always says, and the question never does. */
const OPENED = 'a session over this project';

/** The first words of what `mnema init` reports when it founds a project. */
const FOUNDED = 'Initialized mnema project at';

/** The keys a caller answers a question with, as a terminal sends them. */
const RETURN = '\r';
const ESCAPE = ESC;
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/** A port nothing writes to: what a program built for its declarations alone is handed. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/** What this program declared, read off a program built the way the entry builds one. */
const verbs = buildProgram(quiet).verbs;

/**
 * THE DOORS THE PRODUCT COMPOSES, in each state a directory can be in — asked of the module
 * that composes them rather than retyped.
 *
 * It is the elo between what this file reads off a screen and what the surface decided: a
 * delivery that rewords a door moves these cases with it, and one that retyped the words here
 * would go on asserting the old ones against a page that had changed.
 */
const doorsIn = (inProject: boolean) => theDoors(verbs, inProject);

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
/** A directory with a project in it. */
let project: string;
/** A directory with no project anywhere above it — where the first door is `init`. */
let nowhere: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

beforeAll(async () => {
  // A6: a sandbox of this run's own. Nothing here writes into the working tree.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-bare-'));
  project = join(sandbox, 'project');
  nowhere = join(sandbox, 'nowhere');
  mkdirSync(project, { recursive: true });
  mkdirSync(nowhere, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes this binary prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  await run(['init'], quiet);
  await run(['task', 'the task the question is asked over'], quiet);

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs the binary on a pseudo-terminal, in one of the two directories. */
async function inPty(options: {
  readonly where: string;
  /** What goes after the name. Empty is the bare invocation, which is the subject. */
  readonly verb?: string;
  readonly columns?: number;
  readonly rows?: number;
  readonly steps: readonly Step[];
}): Promise<Ran> {
  const fixture: Fixture = {
    cli: CLI,
    verb: options.verb ?? '',
    project: options.where,
    scratch: sandbox,
    environment,
  };
  return await drive(fixture, {
    columns: options.columns ?? 100,
    rows: options.rows ?? 30,
    steps: options.steps,
  });
}

/**
 * A WHOLE FRAME THIS STEP CAUSED, WITH `what` ON IT.
 *
 * The question has no row being typed, so the usual wait — a finished frame carrying the
 * prompt — cannot be used: what a step waits for is a string of the page, arriving since the
 * step began, at a frame boundary. The first half keeps it from ending on a frame that was
 * already in flight and the second from reading half of one (`support/pty.ts`).
 */
function aFrameSaying(what: string): (bytes: string, since: number) => boolean {
  return (bytes, since) => bytes.endsWith(FRAME_IS_DRAWN) && bytes.slice(since).includes(what);
}

/**
 * The step a bare invocation at a terminal begins with: the question DRAWN.
 *
 * WHAT IT WAITS FOR IS THE DOOR THAT DEPENDS ON THE DIRECTORY, not the one both states
 * share. Waiting for the catalogue would be waiting for something a page composed against
 * the WRONG state also carries — so the mutation that fixes the doors would sail past this
 * step and die later, on whichever assertion happened to come first. Named after that door
 * for the same reason: a red that says which door never appeared is a red about the defect.
 */
const asks = (inProject: boolean): Step => ({
  until: aFrameSaying(doorsIn(inProject)[0]?.word as string),
  what: `offered \`${doorsIn(inProject)[0]?.word}\` as the first thing to do here`,
});

/** What a page looks like with the layout's own placement taken out. */
const pageOf = (bytes: string): string => withoutLayout(bytes);

/** Which door the mark is on, read off the last frame in `bytes`. */
function theMarkedRow(bytes: string): string {
  const rows = pageOf(bytes)
    .split('\n')
    .filter((row) => row.includes(PICK));
  return rows.at(-1) ?? '';
}

// ---------------------------------------------------------------------------
// Without a terminal, nothing moved
// ---------------------------------------------------------------------------

describe('with no terminal the bare name is the help it always was', () => {
  /** Everything an invocation wrote, encoded so the two streams and the exit are compared. */
  async function transcriptOf(
    drive: (io: CliIo) => Promise<void>,
  ): Promise<{ readonly said: string; readonly failed: boolean }> {
    const lines: string[] = [];
    let failed = false;
    // ONE CALL MAY CARRY SEVERAL LINES — commander hands its whole help over in one write —
    // so the prefix goes on each of them, exactly as the golden's own encoder does. A helper
    // that prefixed the call rather than the line would compare two strings that are equal
    // and say nothing about which stream the other twenty-eight rows went to.
    const said = (prefix: string, text: string) => {
      for (const line of text.split('\n'))
        lines.push(line === '' ? prefix.trimEnd() : `${prefix}${line}`);
    };
    const io: CliIo = {
      out: (line) => said('| ', line),
      err: (line) => said('! ', line),
      fail: () => {
        failed = true;
      },
    };
    await answered(drive(io));
    return { said: lines.join('\n'), failed };
  }

  /**
   * THE INVOCATION, HELD TO ANSWERING AT ALL — and a red that says what went wrong.
   *
   * A verb that prints and exits comes back; a QUESTION does not, because it is waiting for a
   * key nobody is going to press. So the way this case fails when the terminal is taken out
   * of the decision is that the call never returns — and a bare `await` turns that into the
   * runner's own *test timed out*, which names the case and not the defect. Measured: the
   * mutation that lets the question appear without a terminal produced exactly that message.
   * What is raced against it is a message that says what happened.
   */
  async function answered(what: Promise<void>): Promise<void> {
    await Promise.race([
      what,
      new Promise((_, no) =>
        setTimeout(
          () =>
            no(
              new Error(
                'the bare name never came back with no terminal: it opened something that ' +
                  'waits for a keystroke, where a pipe, a script and a CI job get the help ' +
                  'and an exit code',
              ),
            ),
          20_000,
        ),
      ),
    ]);
  }

  it('delegates to the very call the golden pins, byte for byte', async () => {
    // THE TWO SIDES OF ONE COMPARISON: what the golden drives (`run` with an empty argv and
    // an injected port) and what the binary now does at an entry that is not a terminal.
    // Equal STRINGS, so a stream that changed or a line that moved is a difference.
    const asRun = await transcriptOf((io) => run([], io));
    const asEntry = await transcriptOf((io) =>
      start([], { io, input: process.stdin, output: process.stdout, interactive: false }),
    );
    expect(asEntry.said, 'the entry no longer answers what the golden pins').toBe(asRun.said);
    expect(asEntry.failed, 'the exit code moved').toBe(asRun.failed);
    // AND IT IS THE CATALOGUE, ON STDERR, WITH A NON-ZERO EXIT — asserted rather than left
    // to the equality above, which two empty transcripts would also satisfy.
    expect(asEntry.failed, 'the bare name stopped failing').toBe(true);
    expect(asEntry.said, 'the catalogue is not on stderr').toContain('! Usage: mnema');
    expect(asEntry.said, 'the verbs are not in it').toContain(`! ${' '.repeat(2)}${REPL_VERB}`);
    expect(asEntry.said, 'something reached stdout').not.toContain('\n| ');
  }, 60_000);

  it('would say something else the moment a terminal is claimed', async () => {
    // THE NON-VACUITY OF THE CASE ABOVE, and the mutation the handoff names: the same call,
    // the same argv, the same port — and BOTH ends a terminal. It must not print the help,
    // and it must draw the question instead.
    const terminal = fakeTerminal({ columns: 100, rows: 30 });
    const lines: string[] = [];
    const io: CliIo = {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      fail: () => undefined,
    };
    const asked = start([], {
      io,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
    });
    const door = doorsIn(true)[1]?.word as string;
    await until(() => pageOf(terminal.bytes()).includes(door), 'asked what you want');
    // NOT ONE LINE OF THE CATALOGUE reached the port, which is the half that says the two
    // answers are exclusive rather than one on top of the other.
    expect(lines.join('\n'), 'the help was printed at a terminal too').not.toContain(
      'Usage: mnema',
    );
    terminal.type(ESCAPE);
    await asked;
  }, 60_000);
});

// ---------------------------------------------------------------------------
// At a terminal: the doors come out of the directory
// ---------------------------------------------------------------------------

describe('at a terminal the bare name asks, and the doors are the directory’s', () => {
  it('offers the console and the catalogue in a project, and opens the console on Enter', async () => {
    const doors = doorsIn(true);
    const ran = await inPty({
      where: project,
      steps: [
        asks(true),
        // ENTER ON THE FIRST DOOR, which is where the mark is before a key is pressed.
        { types: RETURN, until: arrivedSince(PROMPT), what: 'opened what it chose' },
        { types: CTRL_D, until: () => true, what: 'left the console' },
      ],
    });
    const question = ran.bytes.slice(0, ran.at[0] as number);
    // BOTH DOORS ARE ON THE PAGE, in the words the product composed them with.
    for (const door of doors) expect(pageOf(question), door.word).toContain(door.word);
    // AND THE FIRST OF THEM IS THE ONE THE MARK IS ON, before anything is typed.
    expect(theMarkedRow(question), 'the mark did not open on the first door').toContain(
      doors[0]?.word as string,
    );
    // AND ENTER OPENED THE CONSOLE — the one thing only the chosen line can produce.
    expect(ran.bytes, 'Enter on the first door did not open the console').toContain(OPENED);
    expect(ran.bytes, 'there is no row being typed').toContain(PROMPT);
  }, 300_000);

  it('offers establishing a project where there is none, and founds one on Enter', async () => {
    const doors = doorsIn(false);
    // THE FIRST DOOR IS A DIFFERENT DOOR, which is the whole of what this case is about.
    expect(doors[0]?.argv, 'the first door outside a project').toEqual([INIT_VERB]);
    const ran = await inPty({
      where: nowhere,
      steps: [
        asks(false),
        { types: RETURN, until: arrivedSince(FOUNDED), what: 'founded the project' },
      ],
    });
    const question = ran.bytes.slice(0, ran.at[0] as number);
    for (const door of doors) expect(pageOf(question), door.word).toContain(door.word);
    // AND THE CONSOLE IS NOT OFFERED WHERE THERE IS NO RECORD: a door onto an empty room.
    expect(pageOf(question), 'the console was offered outside a project').not.toContain(
      doorsIn(true)[0]?.word as string,
    );
    // AND THE PROJECT IS REALLY THERE afterwards, which no byte on the page can say.
    expect(ran.bytes, 'Enter did not found a project').toContain(FOUNDED);
    expect(held(join(sandbox, 'nowhere')).events, 'the founding wrote nothing').toBeGreaterThan(0);
  }, 300_000);

  it('walks to the catalogue with the arrows, and holds at the last door', async () => {
    const doors = doorsIn(true);
    const ran = await inPty({
      where: project,
      steps: [
        asks(true),
        // ONE DOWN MOVES THE MARK, and that is a frame this step really caused.
        { types: DOWN, until: aFrameSaying(PICK), what: 'moved down' },
        // A SECOND DOWN HOLDS, AND A HOLD DRAWS NOTHING. The rows it would produce are the
        // rows already on the screen, so the layout writes not one byte — which is why this
        // step may not wait for a frame of its own (`support/pty.ts`, `aFrameSince`). What
        // says the mark held is what RETURN then chose: had the second Down wrapped round to
        // the first door, the console would have opened instead of the catalogue. The two
        // keys are one write, so the order they are read in is the order they were sent.
        {
          types: `${DOWN}${RETURN}`,
          until: arrivedSince('Usage: mnema'),
          what: 'held at the last door and chose it',
        },
      ],
    });
    const moved = ran.bytes.slice(ran.at[0] as number, ran.at[1] as number);
    expect(theMarkedRow(moved), 'one Down did not move the mark to the last door').toContain(
      doors[1]?.word as string,
    );
    // AND THE CATALOGUE IS WHAT CHOOSING IT PRINTED — every verb, which is what the door said.
    expect(ran.bytes, 'the catalogue was not printed').toContain('Usage: mnema');
    expect(ran.bytes, 'the catalogue is not the whole catalogue').toContain('completion <shell>');
    // AND THE CONSOLE WAS NOT OPENED, which is what a Down that wrapped would have produced.
    expect(ran.bytes, 'the second Down wrapped back to the first door').not.toContain(OPENED);
  }, 300_000);

  it('holds at the first door when the arrows are walked up from it', async () => {
    // THE OTHER END, AND IT DRAWS NOTHING AT ALL: the mark opens on the first door, so every
    // Up from there is a hold and no frame is written for any of them. What answers is again
    // what RETURN chose — the console, which is the first door — where a list that wrapped
    // would have taken the last one and printed the catalogue.
    const ran = await inPty({
      where: project,
      steps: [
        asks(true),
        {
          types: `${UP}${UP}${RETURN}`,
          until: arrivedSince(PROMPT),
          what: 'held at the first door and chose it',
        },
        { types: CTRL_D, until: () => true, what: 'left the console' },
      ],
    });
    expect(ran.bytes, 'Up did not hold at the first door').toContain(OPENED);
    expect(ran.bytes, 'walking up wrapped round to the catalogue').not.toContain('Usage: mnema');
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Leaving: zero, and nothing written
// ---------------------------------------------------------------------------

describe('leaving without choosing runs nothing, writes nothing and exits zero', () => {
  for (const [named, key] of [
    ['Esc', ESCAPE],
    ['Ctrl-C', CTRL_C],
    ['Ctrl-D', CTRL_D],
  ] as const) {
    it(`answers ${named} with a clean exit and an untouched record`, async () => {
      const started = held(sandbox);
      const ran = await inPty({
        where: project,
        steps: [asks(true), { types: key, until: () => true, what: `left with ${named}` }],
      });
      // THE EXIT CODE, which is the one thing no byte on the page can answer: asking is not
      // an error, so a caller who did not want either door gets their prompt back with a zero.
      expect(ran.code, `${named} did not exit zero`).toBe(0);
      // AND NEITHER DOOR WAS OPENED. Both leave a mark nothing else on this path produces.
      expect(ran.bytes, 'it opened the console anyway').not.toContain(OPENED);
      expect(ran.bytes, 'it printed the catalogue anyway').not.toContain('Usage: mnema');
      // AND THE RECORD GAINED NOTHING, on both halves of what *changed the record* means.
      const ended = held(sandbox);
      expect(ended.events, 'asking appended to the record').toBe(started.events);
      expect(ended.keys, 'asking touched the key material').toBe(started.keys);
    }, 300_000);
  }

  it('THE TEETH: the same instrument over the same fixture sees a write', async () => {
    // Without this the three counts above are a fact about a measurement that cannot see a
    // write rather than about a question that does not make one.
    const started = held(sandbox);
    const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    await run(['memory', 'a fact written after the question was asked'], quiet);
    expect(held(sandbox).events, 'the instrument cannot see a write').toBe(started.events + 1);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The verb is untouched
// ---------------------------------------------------------------------------

describe('`mnema repl` opens the session directly, with no question in front of it', () => {
  it('draws the console and never a door', async () => {
    const ran = await inPty({
      where: project,
      verb: REPL_VERB,
      steps: [
        { until: arrivedSince(PROMPT), what: 'opened its console' },
        { types: CTRL_D, until: () => true, what: 'left' },
      ],
    });
    expect(ran.bytes, 'the session did not open').toContain(OPENED);
    // NOT ONE DOOR ANYWHERE IN THE RUN, in either state's words: a shortcut that made
    // everybody pass through it would have taken the word away rather than added to it.
    for (const door of [...doorsIn(true), ...doorsIn(false)]) {
      expect(
        ran.bytes,
        `\`mnema ${REPL_VERB}\` went through the question: ${door.word}`,
      ).not.toContain(door.word);
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// A1: the sites, found by the discriminant
// ---------------------------------------------------------------------------

/** What deciding on the BARE NAME looks like: a comparison of what was typed against nothing. */
const RULES_ON_THE_BARE_NAME = /argv\.length\s*(?:===|>|<|!==|>=|<=)\s*0/;

/** What asking whether there is a project here looks like, in code. */
const ASKS_FOR_A_PROJECT = /projectPublic\s*(?:===|!==)\s*undefined|standing\(\)/;

describe('A1: every site that rules on the bare name, and every one that asks for a project', () => {
  /** Every module of this surface, with its prose blanked. */
  const modules = (): readonly { readonly where: string; readonly code: string }[] =>
    sourceFiles(SRC).map((file) => ({
      where: file.slice(SRC.length + 1),
      code: codeOnly(readFileSync(file, 'utf-8')),
    }));

  it('rules on the bare name in ONE place, and that place is the entry', () => {
    // THE DISCRIMINANT IS THE COMPARISON, not a list of files. What happens when no verb was
    // given used to be commander's alone — reached from `run` — and there is now a decision in
    // front of it. A SECOND site would be a second answer to *was anything typed*, and the two
    // would disagree the first time one of them moved.
    const ruling = modules()
      .filter((module) => RULES_ON_THE_BARE_NAME.test(module.code))
      .map((module) => module.where)
      .sort();
    expect(ruling).toEqual(['cli.ts']);
    // AND IT IS ASKED ONCE THERE, counted rather than looked at.
    const entry = modules().find((module) => module.where === 'cli.ts');
    expect((entry?.code.match(RULES_ON_THE_BARE_NAME) ?? []).length).toBe(1);
    // Read, rather than absent: the walk really did reach this surface's files.
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
    // NOT VACUOUS: the detector finds the line an author would write, and is not satisfied
    // by the two neighbouring shapes that mean something else.
    expect(RULES_ON_THE_BARE_NAME.test('if (argv.length === 0) return ask();')).toBe(true);
    expect(RULES_ON_THE_BARE_NAME.test('const at = argv.indexOf(END);')).toBe(false);
    expect(RULES_ON_THE_BARE_NAME.test('return at === -1 ? argv.length : at;')).toBe(false);
  });

  it('names every site that asks whether there is a project here', () => {
    // THE SITES ARE FOUND BY THE DISCRIMINANT and then named, so the site this delivery adds
    // is the N+1st of a rule that already held in twenty-eight places rather than a new rule.
    // What every one of them shares is the RESOLVER: none of them looks for the directory
    // itself, so what a project IS has one definition (`@mnema/core`, `resolveTrees`).
    const asking = modules()
      .filter((module) => ASKS_FOR_A_PROJECT.test(module.code))
      .map((module) => module.where)
      .sort();
    // The verbs, which refuse outside a project; the two surfaces' own context; the console's
    // status line; and — the site this delivery adds — the question the bare name asks, which
    // reaches it through the console's own reading rather than through a thirtieth spelling.
    expect(asking).toContain('choice/asked.ts');
    expect(asking).toContain('repl/standing.ts');
    expect(asking.length, 'the scan found almost nothing').toBeGreaterThan(20);
    // AND THE NEW SITE ASKS IT THROUGH THE ONE FUNCTION THAT ALREADY ANSWERED IT for a
    // surface: `standing()` is where the console reads the same fact, and a second reading —
    // an `existsSync` over a directory name, say — would be a second idea of what a project is.
    const asked = modules().find((module) => module.where === 'choice/asked.ts');
    expect(asked?.code, 'the question invented its own way of finding a project').toContain(
      'standing()',
    );
    expect(asked?.code, 'the question looks for the directory itself').not.toContain('existsSync');
  });
});

/**
 * THE CONSOLE, IN A REAL PSEUDO-TERMINAL — because the promise it makes is about a
 * device, and a device is the one thing an in-process test does not have.
 *
 * `mnema repl` takes the terminal: it puts the input in raw mode, so nothing a caller
 * types is echoed by the line discipline any more, and it hides the cursor while it
 * draws. Neither of those is this process's state. They belong to the TERMINAL, and they
 * outlive the process that set them — so a session that stops without undoing them
 * leaves the caller's shell with no echo and no caret. That is the worst defect this
 * frontier can produce, and the reason it is worst is that the program which caused it
 * is already gone when anybody notices.
 *
 * SO EVERY WAY OUT IS DRIVEN HERE, in a pty, on the real binary: the word that leaves,
 * Ctrl-D, Ctrl-C,
 * each signal the product declares it answers, and a throw nobody caught. The delivery
 * before this one proved the category — its concurrency defect was invisible in process
 * and appeared on the first probe in a terminal. Here the whole subject is of that
 * nature.
 *
 * AND "THE TERMINAL CAME BACK" IS ASKED OF THE TERMINAL, twice over, because the two
 * halves are undone by different code:
 *
 *   - THE MODE. A second program is run IN THE SAME PTY after the session dies and asked
 *     what state the device is in (`stty -a`), which is the caller's own next command
 *     answering the question. Measured against a control that takes the terminal and
 *     hooks nothing: killed with `SIGHUP` it leaves `-echo -icanon` behind.
 *   - THE CARET. Hiding and showing the cursor are sequences read off the byte stream the
 *     pty received, in order: taken, then given back.
 *
 * THE SECOND HALF OF THIS FILE is the delivery's other criterion — THE SAME VERBS, THE
 * SAME LINES, ANOTHER PLACE — and the guard that the criterion can stay true: a layout
 * that could compose a line would be a second way of saying what this product says, and
 * two ways of saying the same thing diverge in silence.
 */

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runVerify } from '../src/commands/verify.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { EXIT_SIGNALS } from '../src/repl/leaving.js';
import { badgeLine, openSession, tips } from '../src/repl/session.js';
import { LEAVE } from '../src/session-words.js';
import { here } from '../src/wiring/context.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { DEFAULT_REQUIREMENT } from '../src/wiring/verify.js';
import { decodedWhole } from './support/arriving.js';
import { ESC, fakeTerminal, hooksNothing, until, withoutLayout } from './support/console.js';
import { arrivedSince, sizedTo, theDeviceWasTheSizeAskedFor } from './support/pty.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** `packages/code/src`, for the guards that read the console's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** `packages/`, for the guard that asks what the layers below can see. */
const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** Taking the caret away, and giving it back. */
const CARET_HIDDEN = `${ESC}[?25l`;
const CARET_SHOWN = `${ESC}[?25h`;
/** The page a full-screen program takes. This console must never touch it. */
const ALTERNATE_SCREEN = `${ESC}[?1049`;

/**
 * The two keystrokes that are BYTES rather than signals while the terminal is raw.
 *
 * Raw mode turns off the signal characters, so Ctrl-C and Ctrl-D never become a signal
 * on the way in — they arrive as characters the console reads. Named here, and spelled
 * as escapes, because a control byte typed into a source file is invisible in review and
 * survives an edit made around it.
 */
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/** How tall and how wide the pty is made. Wide, so nothing the terminal folds is read. */
const PTY_ROWS = 40;
const PTY_COLUMNS = 400;

/** Where the runner prints what the terminal is like once the session is gone. */
const AFTERWARDS = '--- the terminal afterwards ---';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** Everything one invocation wrote, on either stream. */
interface Said {
  readonly out: string[];
  readonly err: string[];
}

/** Captures what `work` writes through an injected port. */
async function captured(work: (io: CliIo) => Promise<void>): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  await work({
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => undefined,
  });
  return { out, err };
}

/** `mnema <argv>` at the shell, in this process, with output injected. */
const shell = (...argv: string[]): Promise<Said> => captured((io) => run(argv, io));

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-console-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  await shell('init');
  await shell('task', 'the task the console is asked about');
  await shell('memory', 'a fact the console is asked about');

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

// ---------------------------------------------------------------------------
// A real pty, and what came out of it
// ---------------------------------------------------------------------------

/** What a run in a pty produced. */
interface Ran {
  /** Every byte the terminal received, from the first to the last. */
  readonly bytes: string;
  /** What `stty -a` said in the SAME pty once the session was gone. */
  readonly afterwards: string;
  /** Whether the pty reports a terminal a caller could type into again. */
  readonly usable: { readonly echo: boolean; readonly canonical: boolean };
}

/** Whether `stty -a` reported a flag as on. A missing flag is not an on flag. */
function reads(afterwards: string, flag: string): boolean {
  const said = new RegExp(`(?<![\\w-])(-?)${flag}(?![\\w-])`).exec(afterwards);
  return said?.[1] === '';
}

/**
 * Runs `node <entry>` on a pseudo-terminal and answers with what the terminal received.
 *
 * The pty comes from `script`, which is how a shell hands a program a terminal it did
 * not inherit; the SESSION under it is a `sh -c` that writes its own pid and then
 * `exec`s, so the pid recorded is the node process itself and a signal reaches it and
 * nothing else. When it is over, `stty -a` runs in the same pty — the caller's next
 * command, answering the only question that matters.
 */
async function inPty(options: {
  readonly entry: readonly string[];
  /** Typed once the console is open. */
  readonly types?: readonly string[];
  /** Sent after everything above has been answered, so it lands mid-session. */
  readonly signal?: NodeJS.Signals;
  /**
   * Waited for after `types` and before anything else.
   *
   * It is what makes a case DETERMINISTIC without a sleep: a session that has printed
   * this has finished the line that was typed, so the keystroke or the signal that comes
   * next reaches a session doing nothing rather than one halfway through an answer.
   */
  readonly waitFor?: string;
  /** Typed last, once `waitFor` has been seen. */
  readonly thenTypes?: readonly string[];
}): Promise<Ran> {
  const here = mkdtempSync(join(sandbox, 'pty-'));
  const pidFile = join(here, 'pid');
  const runner = join(here, 'run.sh');
  writeRunner(runner, pidFile, options.entry, here);

  const arriving = decodedWhole();
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: project,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  arriving.from(child.stdout);
  arriving.from(child.stderr);
  const ended = new Promise<void>((resolve) => {
    child.on('close', () => {
      over = true;
      resolve();
    });
  });

  try {
    // THE SIZE THE CASE ASKED FOR IS THE PREMISE, and this file's is that the terminal is
    // wide enough that nothing it reads was folded — so a device that is not that wide
    // makes every line read here a line that was cut somewhere nobody chose. The rule is
    // the shared instrument's (`support/pty.ts`), read from where it is written.
    await theDeviceWasTheSizeAskedFor(here, PTY_ROWS, PTY_COLUMNS);
    // The console is open when the prompt is on the screen. Everything after this is
    // sent to a session that is really running, which is what makes a kill mid-session.
    await until(() => arriving.text().includes(PROMPT) || over, 'opened its console');
    // ⚠️ WHERE WHAT THE CALLER DOES BEGINS, and the whole reason it is taken: what this driver
    // is asked to wait for is *"local integrity verified"* in four cases, and THE PANEL SAYS
    // THAT — it is the record's own verdict, on every page there is. So the wait below was
    // answered by the opening, and the keys after it were sent to a session that had not
    // finished the verb. The rule and why it is one function: `support/pty.ts`,
    // {@link arrivedSince}.
    //
    // ⚠️ AND THIS FILE IS WHERE THE COST SHOWED. `on Ctrl-D` has been a catalogued flake of
    // this bench — the child never closing, thirty seconds, no assertion involved — and one of
    // the four is that case: the end-of-input was written while `verify` was still answering.
    // A flake is not proof of a cause, and this is not claimed as one; what IS deterministic is
    // that the wait was satisfied by the drawing, which this removes.
    const since = arriving.text().length;
    for (const typed of options.types ?? []) child.stdin.write(typed);
    if (options.waitFor !== undefined) {
      const marker = options.waitFor;
      const answered = arrivedSince(marker);
      await until(() => answered(arriving.text(), since) || over, `answered with ${marker}`);
    }
    for (const typed of options.thenTypes ?? []) child.stdin.write(typed);
    if (options.signal !== undefined) {
      await until(() => existsSync(pidFile), 'wrote down its pid');
      const pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, options.signal);
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }

  const bytes = arriving.text();
  const afterwards = bytes.slice(bytes.lastIndexOf(AFTERWARDS));
  return {
    bytes,
    afterwards,
    usable: { echo: reads(afterwards, 'echo'), canonical: reads(afterwards, 'icanon') },
  };
}

/** The shell script the pty runs: the session, then the caller's next command. */
function writeRunner(
  runner: string,
  pidFile: string,
  entry: readonly string[],
  here: string,
): void {
  writeFileSync(
    runner,
    [
      `cd ${project}`,
      ...sizedTo(PTY_ROWS, PTY_COLUMNS, here),
      `sh -c 'echo $$ > ${pidFile}; exec node ${entry.join(' ')}'`,
      `printf '\\n${AFTERWARDS}\\n'`,
      'stty -a',
      '',
    ].join('\n'),
  );
}

/** What every way out has to be true of, whichever way it was. */
function expectTheTerminalCameBack(ran: Ran, what: string): void {
  // The console really opened, so the assertions below are about something. A session
  // that refused at the door would satisfy every one of them saying nothing.
  expect(ran.bytes, `${what}: never drew a prompt`).toContain(PROMPT);
  expect(ran.bytes, `${what}: never took the caret`).toContain(CARET_HIDDEN);
  // The caret is given back, and AFTER it was taken — an ordering, because the sequence
  // appearing anywhere in the stream is not the same as the terminal being left in that
  // state.
  expect(ran.bytes.lastIndexOf(CARET_SHOWN), `${what}: never gave the caret back`).toBeGreaterThan(
    ran.bytes.lastIndexOf(CARET_HIDDEN),
  );
  // And the terminal itself: a caller's next command can be typed and seen.
  expect(
    ran.usable,
    `${what}: the terminal is not usable — ${ran.afterwards.slice(0, 200)}`,
  ).toEqual({ echo: true, canonical: true });
  // The page the caller was on is the page they are still on. A full-screen program
  // would have switched buffers, and switching back throws the scrollback away.
  expect(ran.bytes, `${what}: took the alternate screen`).not.toContain(ALTERNATE_SCREEN);
}

// ---------------------------------------------------------------------------
// Every way out
// ---------------------------------------------------------------------------

describe('the console gives the terminal back, whichever way the session ends', () => {
  it('on the word that leaves, after answering', async () => {
    const ran = await inPty({
      entry: [CLI, REPL_VERB],
      types: ['verify\r'],
      waitFor: 'local integrity verified',
      thenTypes: [`${LEAVE}\r`],
    });
    // It really ran a verb inside the console first — a session that gave the terminal
    // back before doing anything would pass the assertions below and be useless.
    expect(ran.bytes).toContain('local integrity verified');
    expectTheTerminalCameBack(ran, LEAVE);
  }, 120_000);

  it('on Ctrl-D, which is the end of the input rather than a word', async () => {
    const ran = await inPty({
      entry: [CLI, REPL_VERB],
      types: ['verify\r'],
      waitFor: 'local integrity verified',
      thenTypes: [CTRL_D],
    });
    expectTheTerminalCameBack(ran, 'Ctrl-D');
  }, 120_000);

  it('on Ctrl-C, which does NOT end the session — and the session goes on', async () => {
    // Ctrl-C abandons the LINE and the session lives, which is what `node`, `python` and
    // `psql` do and what this session has always done. In raw mode the keystroke is a
    // BYTE rather than a signal, so what is being proved here is two things at once: the
    // console survives it intact and answers the next line, and the terminal still comes
    // back when the caller does leave.
    const abandoned = 'a line the caller thought better of';
    const ran = await inPty({
      entry: [CLI, REPL_VERB],
      types: [abandoned],
      waitFor: abandoned,
      thenTypes: [CTRL_C, 'verify\r', `${LEAVE}\r`],
    });
    expect(ran.bytes).toContain('local integrity verified');
    // And the abandoned line was never run: the session refuses a word no verb answers
    // to, and no such refusal is on the screen because the line never reached the gate.
    expect(ran.bytes).not.toContain('This session does not run');
    expectTheTerminalCameBack(ran, 'Ctrl-C');
  }, 120_000);

  // ONE CASE PER SIGNAL THE PRODUCT DECLARES IT ANSWERS, generated from the declaration
  // rather than listed here — so a signal added to the set arrives covered, and one
  // removed cannot leave a case that proves nothing.
  for (const signal of EXIT_SIGNALS) {
    it(`on ${signal}, sent to the session while it is open`, async () => {
      const ran = await inPty({
        entry: [CLI, REPL_VERB],
        types: ['verify\r'],
        waitFor: 'local integrity verified',
        signal,
      });
      expectTheTerminalCameBack(ran, signal);
    }, 120_000);
  }

  it('on a throw nobody caught, which is the one nothing of ours is watching for', async () => {
    // The console is open, a bug throws, node prints the stack and goes. The hook that
    // covers it is `exit` — node emits it even for the throw nobody handled — and this
    // is the case that proves it, because nothing else does.
    //
    // The throw is raised by an entry of this test's own, in the sandbox, that calls the
    // same `run` the binary calls: there is no way to make the product throw on purpose
    // and no reason to build one into it. `SIGUSR2` is the trigger because it is not in
    // the set the session hooks, so nothing of the product's answers it.
    const crashing = join(sandbox, 'a-throw-inside-the-console.mjs');
    writeFileSync(
      crashing,
      [
        `import { run } from '${CLI}';`,
        "process.on('SIGUSR2', () => {",
        "  throw new Error('a probe threw while the console was open');",
        '});',
        `await run(['${REPL_VERB}']);`,
        '',
      ].join('\n'),
    );
    const ran = await inPty({
      entry: [crashing],
      types: ['verify\r'],
      waitFor: 'local integrity verified',
      signal: 'SIGUSR2',
    });
    // The crash really happened and really reached the caller — a console that swallowed
    // it would be worse than one that leaves the terminal taken.
    expect(ran.bytes).toContain('a probe threw while the console was open');
    expectTheTerminalCameBack(ran, 'an uncaught throw');
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The same verbs, the same lines, another place
// ---------------------------------------------------------------------------

/** Every style sequence out, so what is left is what a pipe would have received. */
const stripped = (line: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  line.replace(/\u001b\[[0-9;]*m/g, '');

/** The console's own row of affordances, as the session composes it. Never an answer. */
const TIPS = renderPlain(tips());

/**
 * The rune the two rules of the input area are drawn with, named by its code point.
 *
 * A run is one keystroke away from a hyphen, and a rune a reader cannot tell from a
 * neighbouring one is a rune an edit destroys without anybody seeing it happen.
 */
const RUN = '\u2500';

/**
 * Whether a row is the console's OWN tips rather than a line the session landed.
 *
 * Matched as a SUFFIX of the tips and not by equality, because the region holding them is
 * redrawn on every keystroke and a slice of the byte stream taken between two frames can
 * begin part-way through the row. An empty row is never the tips, and the guard is not
 * pedantry: two of the reads compared below separate their sections with blank lines, and
 * every string ends with the empty one.
 */
function isTips(row: string): boolean {
  const text = stripped(row);
  return text.length > 0 && TIPS.endsWith(text);
}

/**
 * The console's own badge, as the session composes it over THIS fixture's record.
 *
 * Composed by the module that composes it rather than retyped here, for the reason that
 * module gives: a second spelling of the row goes stale the day the shape changes, and the
 * case below would then be comparing an answer to a stale filter. The level comes from the
 * fold every reading of this surface reads.
 */
function theBadge(): string {
  const verdict = runVerify({ ...here(), requirement: DEFAULT_REQUIREMENT, global: false });
  return verdict.ok ? renderPlain(badgeLine(verdict.record.level)) : '';
}

/** Whether a row is the console's own badge, at whatever column the width put it. */
function isBadge(row: string): boolean {
  const text = stripped(row).trim();
  return text.length > 0 && theBadge().endsWith(text);
}

/**
 * Whether a row is one of the two rules the input sits between.
 *
 * By SHAPE, and it is the one row of the area that cannot be matched against something the
 * session composed: a rule is drawn by the layout rather than written, so there is no
 * string anywhere to compare it to. Nothing this product PRINTS is one character repeated
 * across a row — the panel's own rule has the frame at both ends of it — and the case
 * below is what says so, because a filter that swallowed an answer would break the very
 * equality it exists to serve.
 */
function isRule(row: string): boolean {
  const text = stripped(row).replace(/ +$/, '');
  return text.length > 0 && [...text].every((glyph) => glyph === RUN);
}

/**
 * Everything the console wrote to the page that is not the row being typed, nor the rows
 * of the area around it.
 *
 * The rows the layout redraws are written once per frame and every other row is written
 * once, ever. Telling them apart is therefore not frame archaeology: a row that begins
 * with the prompt is the input row or the echo of one, the tips and the badge are the
 * console's own and are matched against what the session composed for them, a rule is a
 * row of nothing but the run, and every other row is a line the session landed. The echo
 * is checked on its own, where it cannot be confused with an answer.
 *
 * THE LIST GREW WITH THE AREA, and it is the delivery that gave the input a place of its
 * own that grew it: a badge in the corner and two rules are three more rows the console
 * redraws. What did not change is the test the filter has to pass — the answers are
 * compared to what the same verb says at a shell, so a row wrongly kept and a row wrongly
 * dropped both come out as an inequality.
 */
/**
 * WHAT THE CONSOLE PLACED RATHER THAN SAID, taken off the end of what it landed.
 *
 * THE PAGE IS PLACED WITH ROWS THAT HAVE NOTHING ON THEM, so that the input ends on the last row
 * the layout leaves, and the console lands more of them whenever the input area gives rows back
 * — which is what a list of words shutting does (`repl/page.ts`, `repl/console.ts`). They are
 * lines of the flow, so they arrive through the same door a verb's lines do and there is nothing
 * in a row with nothing on it to tell the two apart.
 *
 * SO IT IS THE POSITION THAT TELLS THEM APART, and that is exact rather than a heuristic: a
 * placement is APPENDED to the flow, so it is always the tail of it. What a verb said is
 * everything before the last row that has something on it. Every session below leaves by typing
 * a word that begins with a slash, which opens the list and shuts it again, so every one of them
 * ends with a placement.
 *
 * ⚠️ AND IT WOULD HIDE A VERB WHOSE LAST LINE IS BLANK, which is why both sides of the
 * comparison are trimmed and why the shell's own answer is asserted not to end in one: a read of
 * this product that ended with a blank line would otherwise stop being compared at all.
 */
function withoutThePlacement(rows: readonly string[]): string[] {
  const said = [...rows];
  while (said.at(-1) === '') said.pop();
  return said;
}

function landed(bytes: string): string[] {
  const rows = withoutLayout(bytes).split('\n');
  // The tail after the last newline: not a row, an artefact of splitting on one.
  rows.pop();
  return rows.filter(
    (row) => !row.startsWith(PROMPT) && !isTips(row) && !isBadge(row) && !isRule(row),
  );
}

/** Drives a console over `typed` in this process and answers with what it drew. */
async function inTheConsole(
  typed: readonly string[],
  render = renderPlain,
): Promise<{ readonly opening: string; readonly answers: string[]; readonly all: string }> {
  const terminal = fakeTerminal();
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const closed = openSession({
    io,
    render,
    self: REPL_VERB,
    input: terminal.stdin,
    output: terminal.stdout,
    interactive: true,
    leaving: hooksNothing,
  });
  await until(() => terminal.bytes().includes('a session over this project'), 'opened');
  const opening = terminal.bytes();
  for (const line of typed) {
    const before = terminal.bytes().length;
    terminal.type(`${line}\r`);
    await until(() => terminal.bytes().length > before, `answered ${line}`);
    // The turn is serialized, so the next line waits for this one — and the wait is on
    // the page having stopped growing rather than on a fixed pause.
    let settled = terminal.bytes().length;
    for (let still = 0; still < 8; still++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (terminal.bytes().length === settled) break;
      settled = terminal.bytes().length;
      still = 0;
    }
  }
  terminal.type(`${LEAVE}\r`);
  await closed;
  return {
    opening,
    answers: landed(terminal.bytes().slice(opening.length)),
    all: terminal.bytes(),
  };
}

describe('the same verbs, the same lines, another place', () => {
  /** Every style sequence out, so what is left is what a pipe would have received. */
  const stripped = (line: string): string =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
    line.replace(/\u001b\[[0-9;]*m/g, '');

  it('lands what a verb says, line for line, and nothing of the console’s', async () => {
    // THE CRITERION OF THE DELIVERY, proved by comparison rather than by reading. Two of
    // these verbs separate their sections with BLANK LINES, which is the shape a layout
    // silently drops: text with nothing in it occupies no row unless it is told to.
    const verbs = ['verify', 'accountability', 'skills', 'brief', 'search'];
    for (const verb of verbs) {
      const outside = await shell(...verb.split(' '));
      // The verb really said something: an empty answer would satisfy any equality.
      expect(outside.out.length, verb).toBeGreaterThan(0);
      // And the comparison is a comparison of the same thing: the layout trims the end
      // of every row it writes, so a line that ended in spaces could not survive it —
      // which is a fact about this product's lines and is checked rather than assumed.
      for (const line of outside.out) expect(line, verb).toBe(line.replace(/[ \t]+$/, ''));
      const inside = await inTheConsole([verb]);
      expect(outside.out.at(-1), `${verb}: the shell's answer ends with a blank line`).not.toBe('');
      expect(withoutThePlacement(inside.answers), verb).toEqual(withoutThePlacement(outside.out));
      // And the caller's own line is on the page, the way a terminal shows what you sent.
      expect(inside.all, verb).toContain(`${PROMPT} ${verb}`);
    }
    // At least one of them really carried a blank line: without that, the case above
    // would pass on a layout that drops them.
    const withBlanks = await shell('brief');
    expect(withBlanks.out.filter((line) => line.length === 0).length).toBeGreaterThan(0);
  }, 180_000);

  it('lands a refusal too, word for word, on the one page a terminal is', async () => {
    // A refusal goes to the OTHER STREAM outside, and inside one terminal there is no
    // other stream — stdout and stderr are the same page, and a `no` written past the
    // console's back would land on top of whatever the caret was over. So it is compared
    // to the same refusal said outside, which for a WRITE is the whole promise of this
    // session: running `mnema task oops` at a shell would record one.
    const inside = await inTheConsole(['task oops']);
    const outside = await captured(async (io) => {
      const { typedLine } = await import('../src/repl/session.js');
      await typedLine('task oops', { io, render: renderPlain, self: REPL_VERB });
    });
    expect(outside.err.length).toBeGreaterThan(0);
    expect(outside.out).toEqual([]);
    expect(outside.err.at(-1), "the shell's refusal ends with a blank line").not.toBe('');
    expect(withoutThePlacement(inside.answers)).toEqual(withoutThePlacement(outside.err));
    expect(outside.err.join('\n')).toContain('`task` can change the record');
  }, 120_000);

  it('adds position and never a byte a reader can see, painted or plain', async () => {
    // The console is handed a line that is already bytes. Painting is the renderer's, and
    // a painted line has to survive the console untouched — asserted against the plain
    // one, because `strip(styled) === plain` is the promise three colour deliveries made
    // and this one may not break it.
    const plain = await inTheConsole(['verify']);
    const painted = await inTheConsole(['verify'], renderStyled);
    expect(painted.answers.map(stripped)).toEqual(plain.answers);
    // Not vacuous: the painted one really is painted, weight and hue both.
    const verdict = painted.answers.join('\n');
    expect(verdict).toContain(`${ESC}[1m`);
    expect(verdict).toContain(`${ESC}[32m`);
  }, 120_000);

  it('answers three lines pasted at once, in the order they were pasted', async () => {
    // A terminal hands over everything that arrived since it was last read, so a paste
    // is one chunk with the line breaks inside it. Three verbs answered interleaved over
    // one record is the defect this shape exists to prevent.
    const terminal = fakeTerminal();
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const closed = openSession({
      io,
      render: renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });
    await until(() => terminal.bytes().includes('a session over this project'), 'opened');
    terminal.type(`verify\raccountability\r${LEAVE}\r`);
    await closed;
    const page = terminal.bytes();
    expect(page).toContain(`${PROMPT} verify`);
    expect(page).toContain(`${PROMPT} accountability`);
    expect(page.indexOf(`${PROMPT} verify`)).toBeLessThan(page.indexOf(`${PROMPT} accountability`));
    expect(page).toContain('local integrity verified');
  }, 120_000);

  it('opens no console at all when it decided there is no terminal', async () => {
    // The refusal comes before anything is taken. A console opened and then given back
    // around a refusal would flash the caller's screen for nothing and — worse — would
    // mean the taking is not conditional on there being a terminal to take.
    const terminal = fakeTerminal();
    const said: string[] = [];
    await openSession({
      io: { out: () => undefined, err: (line) => said.push(line), fail: () => undefined },
      render: renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: false,
      leaving: hooksNothing,
    });
    expect(terminal.bytes()).toBe('');
    expect(terminal.raw()).toBe(false);
    expect(said.join('\n')).toContain('is an interactive session and this is not a terminal');
  });

  it('hooks every way out on the port it was handed, and takes them off on the way back', async () => {
    // THE ELO, and the reason it is asserted here rather than left to the pty. Taking the
    // hooks away does NOT turn the pty cases red: the layout library registers a teardown
    // of its own on the same exit and the same signals, three levels down from a package
    // chosen for its boxes. So the pty can say the promise is kept and cannot say by
    // whom — and a promise made out of somebody else's transitive dependency is not a
    // promise this product can make. This is what says the hooks are ours.
    const terminal = fakeTerminal();
    const hooked: string[] = [];
    const unhooked: string[] = [];
    const closed = openSession({
      io: { out: () => undefined, err: () => undefined, fail: () => undefined },
      render: renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: {
        on: (event) => {
          hooked.push(event);
        },
        off: (event) => {
          unhooked.push(event);
        },
        raise: () => undefined,
      },
    });
    await until(() => terminal.bytes().includes('a session over this project'), 'opened');
    expect([...hooked].sort()).toEqual(['exit', ...EXIT_SIGNALS].sort());
    terminal.type(`${LEAVE}\r`);
    await closed;
    // And off again, so a second session in this process does not find the first one's.
    expect([...unhooked].sort()).toEqual([...hooked].sort());
  }, 120_000);

  it('gives the mode back when the session merely RETURNS, which no exit hook covers', async () => {
    // The half of the restoration that is unambiguously this product's. The word ends the
    // SESSION and not the process: nothing is exiting, so no hook of anybody's fires, and
    // the terminal has to be the caller's again by the time this promise resolves.
    const terminal = fakeTerminal();
    const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
    const closed = openSession({
      io,
      render: renderPlain,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });
    await until(() => terminal.bytes().includes('a session over this project'), 'opened');
    expect(terminal.raw()).toBe(true);
    terminal.type(`${LEAVE}\r`);
    await closed;
    expect(terminal.raw()).toBe(false);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The limit the whole decision rests on
// ---------------------------------------------------------------------------

/** Every `.ts` module of a directory of `src`, tests excluded. */
function modulesOf(directory: string): string[] {
  return readdirSync(join(SRC, directory))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
}

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every string a source WRITES, in order, quotes included.
 *
 * Scanned rather than pattern-matched, and the difference is not a nicety: a pattern for
 * "a quoted run with a space in it" matches from the CLOSING quote of one literal to the
 * OPENING quote of the next, so `from 'ink'` followed anywhere by `'column'` reads as one
 * long string full of spaces. That false positive is what this walk exists to avoid — it
 * consumes each literal whole, so the space between two of them is code and not text.
 */
function literalsOf(code: string): string[] {
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/** What a module that lays out lines may not do, said as the accusation it makes. */
const REACHED_FOR_A_LINE = 'a layout that reached for the parts of a line would compose one';
const TYPED_A_TEXT = 'a text a reader can see, typed into the layout';
const TEMPLATED_A_LINE = 'a line put together out of pieces, in a template';
const ADDED_UP_A_LINE = 'a line put together out of pieces, by addition';

/** Every accusation this scan can make. A ban that stops firing is one to delete. */
const COMPOSING = [REACHED_FOR_A_LINE, TYPED_A_TEXT, TEMPLATED_A_LINE, ADDED_UP_A_LINE];

/**
 * The two erases no module of this session may write: the screen, and the history above it.
 *
 * Named by what ends the sequence rather than by the whole of it, because the whole of it
 * is assembled at three sites out of an escape and a bracket — a scan for the finished
 * bytes would miss every one of them.
 */
const ERASES = ['2J', '3J'];

/**
 * Which of the bans a source breaks.
 *
 * Judged over the LITERALS and not over the file, for the reason `literalsOf` gives, and
 * over a file whose prose has been taken out first — every doc in this repository is
 * English full of apostrophes, and a scan that read one as a string would accuse
 * everything it looked at.
 */
function composing(source: string): string[] {
  const code = withoutComments(source);
  const literals = literalsOf(code);
  const broken: string[] = [];
  if (literals.some((literal) => literal.includes('presentation'))) broken.push(REACHED_FOR_A_LINE);
  if (literals.some((literal) => literal.slice(1, -1).includes(' '))) broken.push(TYPED_A_TEXT);
  if (literals.some((literal) => literal.startsWith('`') && literal.includes('${'))) {
    broken.push(TEMPLATED_A_LINE);
  }
  if (/\+\s*['"`]|['"`]\s*\+/.test(code)) broken.push(ADDED_UP_A_LINE);
  return broken;
}

/**
 * The modules that LAY OUT: the ones that take a component from the layout library.
 *
 * Read off the imports rather than off a list of file names, and the discriminant is the
 * one that matters: a module that only asks the library to MOUNT something (`render`)
 * drives, and a module that takes a Box or a Text POSITIONS. The day somebody puts a
 * component in another file, that file joins this corpus and its text goes red — which
 * is the accusation, not a gap.
 */
function laysOut(): string[] {
  return modulesOf('repl').filter((file) => {
    const clause = /import\s*\{([^}]*)\}\s*from\s*'ink'/.exec(
      readFileSync(join(SRC, 'repl', file), 'utf-8'),
    );
    if (clause === null) return false;
    return (clause[1] as string)
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .some((name) => name.length > 0 && name !== 'render');
  });
}

describe('no component composes a line; it only positions one the renderer produced', () => {
  it('is true of every module that takes a component from the layout library', () => {
    // THE LIMIT. Five deliveries built one model of what a line of this product says; a
    // component that put a sentence together would be a second, and two ways of saying
    // the same thing diverge in silence.
    for (const file of laysOut()) {
      expect(composing(readFileSync(join(SRC, 'repl', file), 'utf-8')), file).toEqual([]);
    }
    // The corpus is real: an empty one passes this and says nothing at all.
    expect(laysOut()).toEqual(['region.ts']);
  });

  it('would accuse each line a careful author would write', () => {
    // The vacuous form, ban by ban, on input this case owns — including the one that
    // reads most like ordinary work: a component adding a separator between two values.
    // The hole is assembled rather than typed, because the lint refuses a template
    // placeholder inside a plain string and this repository opens no exception to a rule
    // for the convenience of a test.
    const hole = `$${'{'}`;
    const relapse = [
      "import { fact } from '../presentation/detail.js';",
      "return node(Text, null, 'no work is open');",
      `return node(Text, null, \`${hole}count} tasks\`);`,
      "return node(Text, null, left + ': ' + right);",
    ].join('\n');
    expect(composing(relapse)).toHaveLength(COMPOSING.length);
    // And it does NOT accuse what a layout legitimately says: a style keyword, a key.
    expect(
      composing(
        [
          "import { Box, Text } from 'ink';",
          "return node(Box, { flexDirection: 'column' }, node(Text, null, line));",
          'return node(Box, { key: String(index) }, node(Text, null, line));',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reads code and not prose, which is the way this scan could lie', () => {
    // The detector's own non-vacuity. Every doc in this repository is a paragraph of
    // English full of apostrophes and spaces, and a scan that read one as a string would
    // accuse every file it looked at — passing the case above only because it never got
    // that far.
    // And the walk over the literals reads two of them as two: the space BETWEEN a
    // closing quote and the next opening one is code, and the pattern that missed that
    // accused this delivery's own layout of composing text on its first run.
    expect(literalsOf("from 'ink';\nconst a = { flexDirection: 'column' };")).toEqual([
      "'ink'",
      "'column'",
    ]);
    expect(withoutComments("/* a component's own words */\nconst a = 1;\n").trim()).toBe(
      'const a = 1;',
    );
    expect(withoutComments("// the caller's line\nconst b = 2;\n").trim()).toBe('const b = 2;');
    expect(composing('/** it never adds a word of its own. */\nconst c = 3;\n')).toEqual([]);
    // And it does not throw the code away with the prose.
    expect(withoutComments("const d = 'a b';")).toContain("'a b'");
  });

  it('never takes the alternate screen, in any module of the session', () => {
    // ⛔ Measured, and the reason the first design was abandoned: the alternate screen
    // discards the scrollback on the way out, and the scrollback is the feature.
    for (const file of modulesOf('repl')) {
      const source = readFileSync(join(SRC, 'repl', file), 'utf-8');
      expect(source, file).not.toContain('alternateScreen');
      expect(source, file).not.toContain('1049');
    }
    expect(modulesOf('repl').length).toBeGreaterThan(4);
  });

  it('never erases the page or the history above it, in any module of the session', () => {
    // ⛔ THE SISTER OF THE BAN ABOVE, and it arrived with the page that opens clean. There
    // are two ways to make a screen empty: erase it, or scroll it away. Only the second is
    // defined to put what was there into the scrollback, which is why it is the one this
    // console uses — and the erase that takes the HISTORY with it (`3J`) is the caller's
    // own log of what they were doing before they opened a session, which is not ours to
    // delete. Judged over the CODE, so the module that explains the ban may name it.
    for (const file of modulesOf('repl')) {
      const code = withoutComments(readFileSync(join(SRC, 'repl', file), 'utf-8'));
      for (const erase of ERASES) expect(code, `${file} writes ${erase}`).not.toContain(erase);
    }
    // Not vacuous: the ban is over a real corpus, it would accuse the line an author would
    // write, and the module whose whole subject this is NAMES both sequences in its prose.
    expect(modulesOf('repl').length).toBeGreaterThan(4);
    for (const erase of ERASES) {
      expect(withoutComments(`const CLEAR_IT = ESC + '[${erase}';`)).toContain(erase);
      expect(readFileSync(join(SRC, 'repl', 'page.ts'), 'utf-8')).toContain(erase);
    }
  });
});

// ---------------------------------------------------------------------------
// Where the library is allowed to be
// ---------------------------------------------------------------------------

/** The two packages a layout is made of. Neither may be visible below the surface. */
const LAYOUT = ['ink', 'react'];

/** Every `.ts` source of a package, recursively, tests excluded. */
function sourcesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesOf(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** What a package declares it depends on, both kinds. */
function declaredBy(name: string): string[] {
  const manifest = JSON.parse(readFileSync(join(PACKAGES, name, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

describe('the layout lives on the surface and the layers below cannot see it', () => {
  it('is declared by the product and by no package under it', () => {
    // The whole argument for taking the library at all: it is a dependency of the
    // SURFACE. The chain has none of its own, the core and the copilot are the domain,
    // and a package that could import a terminal layout is a package whose boundary is
    // about something other than what it is for.
    for (const layer of ['chain', 'core', 'copilot']) {
      for (const part of LAYOUT) expect(declaredBy(layer), `${layer}/${part}`).not.toContain(part);
      for (const file of sourcesOf(join(PACKAGES, layer, 'src'))) {
        const source = readFileSync(file, 'utf-8');
        for (const part of LAYOUT) {
          expect(new RegExp(`from\\s*'${part}'`).test(source), `${file} names ${part}`).toBe(false);
        }
      }
    }
    // Not vacuous: the surface DOES declare both, which is what makes the absences above
    // a boundary rather than a library nobody installed.
    for (const part of LAYOUT) expect(declaredBy('code')).toContain(part);
  });
});

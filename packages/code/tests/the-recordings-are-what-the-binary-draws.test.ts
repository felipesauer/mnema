/**
 * THE RECORDINGS ARE WHAT THE BINARY DRAWS — the two animations the front page shows, each held to
 * a run of the script it was made from, against the built binary, so neither goes stale in silence.
 *
 * WHY THIS EXISTS. An animation is the one kind of evidence on a page that a reader cannot check by
 * copying it, and it is the kind that rots quietest: it goes on showing the binary of the day it
 * was made. Measured on the command-line recording itself — its first take and the one committed
 * are four days apart, and in between the census line `verify` prints about a machine's own backup
 * key changed from *"the tail may have been dropped (a botched merge)…"* to *"a backup signs nothing
 * until it is restored"*. So each recording is made FROM a script that lives beside it in
 * `recordings/`, and this file runs that script again and holds what the binary does today to
 * what the recording shows.
 *
 * TWO RECORDINGS, TWO WAYS OF BEING MADE, ONE RULE.
 *
 *   - THE COMMAND LINE. `recordings/first-record.sh` is typed at a terminal by `asciinema`, which
 *     keeps every byte and when it came in `first-record.cast`; `agg` renders that into the GIF.
 *     Here the same script runs with `PACE=0` — no pause and no per-character delay, the text
 *     unchanged — and what it prints is held to the text of the committed cast, line for line:
 *     the control sequences out, the carriage returns out, and what the machine mints read as what
 *     it is (`support/a-page-held-to-a-run.ts`).
 *   - THE CONSOLE. It is interactive, so no shell script can drive it: something has to wait for
 *     what each key did before pressing the next. `recordings/console.json` is its script — a record
 *     to open over, and steps that each end when their own frame brings a text onto the page — and
 *     this file is what drives it, through the project's own pseudo-terminal (`support/pty.ts`).
 *     Asked to record (`RECORDING=console`), the drive WRITES `console.cast`; otherwise it holds
 *     the page every step leaves to the page the committed cast leaves at the same step.
 *
 * HOW EACH IS MADE AGAIN, from the root of a built checkout (`pnpm build`):
 *
 *     asciinema rec --overwrite -q --cols 96 --rows 34 \
 *       -c "bash recordings/first-record.sh $PWD/packages/code/dist/cli.js" recordings/first-record.cast
 *     agg recordings/first-record.cast recordings/first-record.gif
 *
 *     RECORDING=console npx vitest run packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts
 *     agg recordings/console.cast recordings/console.gif
 *
 * WHAT A RECORDING SHOWS THAT THE BINARY DID NOT WRITE, each said here:
 *   - the sandbox's home is spelled `~` — by the script for the command line, and by
 *     {@link spelledFromHome} for the console — so a path reads as it would on a reader's own
 *     machine; a case below holds that the respelling changes nothing on any page but that path;
 *   - `verify`'s lines are folded at a space by the command-line script, to fit 96 columns;
 *   - the console's recording opens on `$ mnema` typed at a shell, which is what a person types
 *     to reach it and which the pseudo-terminal's runner does not echo;
 *   - a line feed is written as the carriage return and line feed a terminal with `onlcr` hands its
 *     screen, because that is what a renderer reads; the replay here reads a line feed the same
 *     way either way (`support/screen.ts`);
 *   - and the CLOCK is the recording's own. Each step of the console lands at the time the
 *     script's `hold` puts it, with every byte it drew in one piece: the pages are the console's,
 *     the pace is the script's.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the GIFs. `agg` renders each from its cast and the suite has no `agg` to run; what ties a GIF
 *     to its cast is that one command makes both, and a reviewer sees both change in one diff;
 *   - a frame the console drew and replaced inside one step — a step is held by the page it
 *     LEAVES;
 *   - the times in a cast, beyond that they move forward.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { THE_FLOOR } from '../src/repl/floor.js';
import { accountsFor, asMinted } from './support/a-page-held-to-a-run.js';
import { ENDS_THE_INPUT } from './support/console.js';
import { aFrameSince, FRAME_IS_DRAWN, inPty, type Ran, type Step } from './support/pty.js';
import { ROOT, read } from './support/published-examples.js';
import { linesOf } from './support/reading-a-shell-line.js';
import { screenOf } from './support/screen.js';

/** The built binary — what a person runs, and what both recordings were made with. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** Where the recordings and their scripts live, beside the page that shows them. */
const RECORDINGS = join(ROOT, 'recordings');

/** What a failure says, so that a red here says how it goes green again. */
const THE_WAY_BACK = {
  cli:
    'recordings/first-record.cast no longer shows what the binary prints. Make it again: ' +
    'asciinema rec --overwrite -q --cols 96 --rows 34 -c "bash recordings/first-record.sh ' +
    '$PWD/packages/code/dist/cli.js" recordings/first-record.cast, then agg ' +
    'recordings/first-record.cast recordings/first-record.gif',
  console:
    'recordings/console.cast no longer shows what the console draws. Make it again: ' +
    'RECORDING=console npx vitest run packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts, ' +
    'then agg recordings/console.cast recordings/console.gif',
} as const;

// ---------------------------------------------------------------------------
// A cast — the asciicast v2 file a recording is kept in
// ---------------------------------------------------------------------------

/** The first line of a cast: the terminal it was made at. */
interface CastHeader {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly env?: Readonly<Record<string, string | null>>;
}

/** One event of a cast: when, what kind — `o` is output — and the bytes. */
type CastEvent = readonly [number, string, string];

/** A cast: the header, and every event in order. */
interface Cast {
  readonly header: CastHeader;
  readonly events: readonly CastEvent[];
}

/** A cast as its file holds it: the header on the first line, then one event a line. */
function castOf(text: string): Cast {
  const [first, ...rest] = text.split('\n').filter((line) => line !== '');
  if (first === undefined) throw new Error('the cast holds nothing at all');
  return {
    header: JSON.parse(first) as CastHeader,
    events: rest.map((line) => JSON.parse(line) as CastEvent),
  };
}

/** A cast as its file is written: the header, then one event a line. */
function fileOf(cast: Cast): string {
  return `${[cast.header, ...cast.events].map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/** Everything a run of events drew, in order. */
function drawnBy(events: readonly CastEvent[]): string {
  return events
    .filter(([, kind]) => kind === 'o')
    .map(([, , bytes]) => bytes)
    .join('');
}

/** One escape byte, spelled by its code point like every control byte in this repository. */
const ESC = String.fromCodePoint(0x1b);

/** A control sequence: `ESC [`, its parameters, and the byte that ends it. */
const A_SEQUENCE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');

/**
 * What a reader reads of what a script printed: the control sequences out, and each line ended
 * once. An escape this reading does not know is refused rather than left in the text, because
 * text with a stray escape in it compares unequal for a reason no line of the diff would show.
 */
function readable(bytes: string): string {
  const text = bytes.replace(A_SEQUENCE, '').replaceAll('\r', '');
  const stray = text.indexOf(ESC);
  if (stray >= 0) {
    throw new Error(
      `a sequence this reading does not know is left in: ${JSON.stringify(text.slice(stray, stray + 12))}`,
    );
  }
  return text;
}

/** The commands the command-line script types, in order — the line after the prompt. */
function typedIn(lines: readonly string[]): string[] {
  return lines.filter((line) => line.startsWith('$ ')).map((line) => line.slice(2));
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

describe('the command-line recording', () => {
  let sandbox: string;
  let today: string[];
  let shown: string[];
  let cast: Cast;

  beforeAll(() => {
    // ITS OWN SANDBOX, handed to the script as its temp directory: the script makes its own
    // under it and removes it, and this removes whatever a script that died left.
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-first-record-case-'));
    const ran = spawnSync('bash', [join(RECORDINGS, 'first-record.sh'), CLI], {
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: sandbox, TMPDIR: sandbox, PACE: '0' },
    });
    if (ran.status !== 0 || ran.stderr !== '') {
      throw new Error(
        `recordings/first-record.sh did not run clean (exit ${ran.status}): ${ran.stderr}`,
      );
    }
    today = asMinted(readable(ran.stdout)).split('\n');
    cast = castOf(read('recordings/first-record.cast'));
    shown = asMinted(readable(drawnBy(cast.events))).split('\n');
  }, 120_000);

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('prints today, line for line, what the committed cast shows', () => {
    expect(shown, THE_WAY_BACK.cli).toEqual(today);
  });

  it('reads the five commands the script types, and a cast made at the size its header names', () => {
    // NON-VACUITY. A script that printed nothing and a cast that held nothing would agree above.
    expect(typedIn(today).map((command) => command.split(' ').slice(0, 3).join(' '))).toEqual([
      'mnema init',
      'mnema decision "Keep',
      'mnema decision move',
      'mnema brief |',
      'mnema verify',
    ]);
    expect(today.length).toBeGreaterThan(30);
    expect([cast.header.width, cast.header.height]).toEqual([96, 34]);
    // Typed at human speed, the commands arrive one character an event.
    expect(cast.events.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// The console
// ---------------------------------------------------------------------------

/** One step of `recordings/console.json`. */
interface ScriptStep {
  /** A line typed one character at a time, and then Enter. */
  readonly types?: string;
  /** Keys sent as they are. */
  readonly keys?: string;
  /** The text the step's own frame brings onto the page — what says it happened. */
  readonly waitsFor?: string;
  /** The step that leaves the session; what it waits for is the process to end. */
  readonly leaves?: boolean;
  /** How many seconds the recording keeps the page this step leaves. */
  readonly hold: number;
}

/** The console's script, as `recordings/console.json` holds it. */
interface ConsoleScript {
  readonly what: readonly string[];
  readonly size: { readonly columns: number; readonly rows: number };
  readonly shell: string;
  readonly record: readonly (readonly string[])[];
  readonly steps: readonly ScriptStep[];
}

/** What the console's caller types in front of. */
const PROMPT = 'mnema>';

/** In `record`, the id the previous command printed. */
const THE_ID_ABOVE = '<the id above>';

/** A record's id, as every write prints it. */
const AN_ID = /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** How long a typed character stays before the next one, in the recording. */
const A_KEYSTROKE = 0.08;

/** The beat between the last character of a line and the Enter that sends it. */
const BEFORE_ENTER = 0.3;

/** How long the recording waits before the shell line starts, and after it is typed. */
const BEFORE_THE_SHELL = 0.4;
const AFTER_THE_SHELL = 0.35;

/** The prompt of the shell the console is reached from, as the command-line recording draws it. */
const THE_SHELLS_PROMPT = `${ESC}[1m$${ESC}[0m `;

/** Where the recording keeps a step's page, and how the console's script is read. */
const CONSOLE_CAST = 'recordings/console.cast';
const CONSOLE_SCRIPT = 'recordings/console.json';

/**
 * WHERE THE CONSOLE'S SANDBOX IS MADE: under `/tmp`, and NOT under the machine's temp directory,
 * because the console prints the project's path in its panel and the page is arranged around it.
 * Measured with a temp directory 86 characters long: the panel folded the path over two lines,
 * the respelling of the home no longer found it whole in the bytes, and the taller panel moved the
 * drawing of the name into the roll — every page of the drive differed from the recording's. A
 * sandbox under `/tmp` is the same length on every machine this file can run on: the
 * pseudo-terminal it drives is Linux's (`script -qec`, `stty -F`), where `/tmp` always is.
 */
const UNDER_A_PATH_OF_ONE_LENGTH = '/tmp/mnema-console-recording-';

/** A step as the pseudo-terminal runs it, and how long the recording keeps what it leaves. */
interface Paced {
  readonly step: Step;
  readonly hold: number;
}

/** Whether `text` is on the page a stream leaves. A stream that cannot be replayed holds nothing. */
function pageHolds(bytes: string, text: string, columns: number, rows: number): boolean {
  try {
    return screenOf(bytes, columns, rows).text.includes(text);
  } catch {
    return false;
  }
}

/**
 * THE PAGE HOLDS `text` AT A FINISHED FRAME — what a step with no key waits for: the program
 * opened, and drew.
 */
function drawnWith(text: string, columns: number, rows: number): Step['until'] {
  return (bytes) => bytes.endsWith(FRAME_IS_DRAWN) && pageHolds(bytes, text, columns, rows);
}

/**
 * A FRAME THE STEP CAUSED, THAT BROUGHT `text` ONTO THE PAGE — on it now, and not on it when the
 * step began.
 *
 * THE SECOND HALF IS THE SCRIPT'S RULE, NOT A NICETY. A step that waited for a text already on the
 * page would end on the frame before it did anything, and it would record a page nothing had
 * changed — the frame the console does not write at all when a read leaves the page as it was. So
 * a script whose step asks for a text that is already there never ends, and says so by name.
 */
function bringsOnto(text: string, columns: number, rows: number): Step['until'] {
  let began = -1;
  let wasThere = false;
  return (bytes, since) => {
    if (!bytes.endsWith(FRAME_IS_DRAWN) || !bytes.slice(since).includes(FRAME_IS_DRAWN)) {
      return false;
    }
    if (began !== since) {
      began = since;
      wasThere = pageHolds(bytes.slice(0, since), text, columns, rows);
    }
    return !wasThere && pageHolds(bytes, text, columns, rows);
  };
}

/** The script's steps as the pseudo-terminal runs them, each with the hold the recording gives it. */
function pacedSteps(script: ConsoleScript): Paced[] {
  const { columns, rows } = script.size;
  const paced: Paced[] = [];
  script.steps.forEach((one, index) => {
    const what = `step ${index + 1} of ${CONSOLE_SCRIPT}`;
    if (one.leaves === true) {
      const types = one.keys ?? ENDS_THE_INPUT;
      paced.push({ step: { types, until: () => true, what: `${what}: left` }, hold: one.hold });
      return;
    }
    const waitsFor = one.waitsFor;
    if (waitsFor === undefined) throw new Error(`${what} waits for nothing`);
    if (one.types !== undefined) {
      const line = one.types;
      [...line].forEach((character, at) => {
        paced.push({
          step: {
            types: character,
            until: aFrameSince(PROMPT),
            what: `${what}: typed ${JSON.stringify(line.slice(0, at + 1))}`,
          },
          hold: at === line.length - 1 ? BEFORE_ENTER : A_KEYSTROKE,
        });
      });
      paced.push({
        step: {
          types: '\r',
          until: bringsOnto(waitsFor, columns, rows),
          what: `${what}: ${JSON.stringify(waitsFor)} on the page`,
        },
        hold: one.hold,
      });
      return;
    }
    const until =
      one.keys === undefined
        ? drawnWith(waitsFor, columns, rows)
        : bringsOnto(waitsFor, columns, rows);
    const step: Step =
      one.keys === undefined
        ? { until, what: `${what}: ${JSON.stringify(waitsFor)} on the page` }
        : { types: one.keys, until, what: `${what}: ${JSON.stringify(waitsFor)} on the page` };
    paced.push({ step, hold: one.hold });
  });
  return paced;
}

/**
 * WHERE THE PROGRAM BEGINS: the byte after the line the pseudo-terminal's runner echoes to name
 * its device (`support/pty.ts`). That line is the instrument's, not the console's, and a reader of
 * the recording would take it for the product's first words.
 */
function theProgramBegins(bytes: string): number {
  const named = /^TTY=\S+\r?\n/.exec(bytes);
  if (named === null) {
    throw new Error(
      'the runner no longer opens by naming its device, so where the console begins is unknown',
    );
  }
  return named[0].length;
}

/** What every step drew: from where the previous one ended, and the last to the end of the run. */
function slicesOf(ran: Ran, count: number): string[] {
  if (ran.at.length !== count) {
    throw new Error(`the drive ended ${ran.at.length} steps where the script has ${count}`);
  }
  let from = theProgramBegins(ran.bytes);
  return [...ran.at.slice(0, -1), ran.bytes.length].map((end) => {
    const slice = ran.bytes.slice(from, end);
    from = end;
    return slice;
  });
}

/**
 * THE SANDBOX'S HOME, SPELLED `~` — so the path the console's panel prints reads the way it would
 * on a reader's machine. The only respelling the recording makes of the console's own bytes; the
 * last case below holds that it changes nothing on any page but that path.
 */
function spelledFromHome(bytes: string, home: string): string {
  return bytes.split(home).join('~');
}

/** A step's bytes as the recording holds them: the home spelled `~`, each line fed as `onlcr` does. */
function asRecorded(bytes: string, home: string): string {
  return spelledFromHome(bytes, home).replace(/\r?\n/g, '\r\n');
}

/** A time in a cast: seconds, to the millisecond, so a file made twice reads the same. */
const toTheMillisecond = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** The events the shell line is typed in, before the program's first byte. */
function theShellLine(shell: string): { readonly bytes: string; readonly hold: number }[] {
  return [
    { bytes: THE_SHELLS_PROMPT, hold: 0.5 },
    ...[...shell].map((character) => ({ bytes: character, hold: A_KEYSTROKE })),
    { bytes: '\r\n', hold: AFTER_THE_SHELL },
  ];
}

/** The recording a drive makes: the shell line, then one event for everything each step drew. */
function theRecordingOf(
  script: ConsoleScript,
  paced: readonly Paced[],
  slices: readonly string[],
): Cast {
  const events: CastEvent[] = [];
  let clock = BEFORE_THE_SHELL;
  const lands = (bytes: string, hold: number): void => {
    events.push([toTheMillisecond(clock), 'o', bytes]);
    clock += hold;
  };
  for (const { bytes, hold } of theShellLine(script.shell)) lands(bytes, hold);
  slices.forEach((slice, index) => {
    lands(slice, (paced[index] as Paced).hold);
  });
  return {
    header: {
      version: 2,
      width: script.size.columns,
      height: script.size.rows,
      env: { TERM: 'xterm-256color' },
    },
    events,
  };
}

/**
 * The page every step leaves, as a reader reads it: the text of the screen, with what the machine
 * mints read as what it is. The shell line is the recording's first events and not a step of its
 * own; it is on every page, as it would be on a reader's screen.
 */
function pagesOf(cast: Cast, script: ConsoleScript, steps: number): string[] {
  const before = theShellLine(script.shell).length;
  if (cast.events.length !== before + steps) {
    throw new Error(
      `the cast holds ${cast.events.length} events where the script makes ${before + steps}. ${THE_WAY_BACK.console}`,
    );
  }
  return Array.from({ length: steps }, (_, step) =>
    asMinted(
      screenOf(
        drawnBy(cast.events.slice(0, before + step + 1)),
        cast.header.width,
        cast.header.height,
      ).text,
    ),
  );
}

describe('the console recording', () => {
  const script = JSON.parse(read(CONSOLE_SCRIPT)) as ConsoleScript;
  const { columns, rows } = script.size;
  const paced = pacedSteps(script);
  let sandbox: string;
  let home: string;
  let project: string;
  let environment: NodeJS.ProcessEnv;
  let ran: Ran;
  let made: Cast;

  beforeAll(async () => {
    // ITS OWN SANDBOX, a home inside it, and the repository inside the home — so the one path the
    // console prints is a path under the home, which the recording spells `~`.
    sandbox = mkdtempSync(UNDER_A_PATH_OF_ONE_LENGTH);
    home = join(sandbox, 'home');
    project = join(home, 'your-repository');
    mkdirSync(project, { recursive: true });
    environment = { PATH: process.env.PATH ?? '', HOME: home };
    spawnSync('git', ['init', '-q'], { cwd: project, env: environment });
    let last: string | undefined;
    for (const argv of script.record) {
      const words = argv.map((word) => {
        if (word !== THE_ID_ABOVE) return word;
        if (last === undefined) throw new Error(`${CONSOLE_SCRIPT}: nothing above printed an id`);
        return last;
      });
      const wrote = spawnSync(process.execPath, [CLI, ...words], {
        cwd: project,
        encoding: 'utf-8',
        env: environment,
      });
      if (wrote.status !== 0) {
        throw new Error(`${CONSOLE_SCRIPT}: \`mnema ${words.join(' ')}\` failed: ${wrote.stderr}`);
      }
      last = AN_ID.exec(wrote.stdout)?.[0] ?? last;
    }
    ran = await inPty(
      {
        cli: CLI,
        // THE BARE NAME, which is how a person reaches the console: it asks, and the first door
        // opens it.
        verb: '',
        project,
        scratch: sandbox,
        environment: { ...environment, TERM: 'xterm-256color' },
      },
      { columns, rows, steps: paced.map((one) => one.step) },
    );
    made = theRecordingOf(
      script,
      paced,
      slicesOf(ran, paced.length).map((slice) => asRecorded(slice, home)),
    );
    if (process.env.RECORDING === 'console') {
      writeFileSync(join(ROOT, CONSOLE_CAST), fileOf(made));
    }
  }, 180_000);

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('draws today, step by step, the pages the committed cast shows', () => {
    const committed = castOf(read(CONSOLE_CAST));
    expect([committed.header.width, committed.header.height], THE_WAY_BACK.console).toEqual([
      columns,
      rows,
    ]);
    expect(pagesOf(committed, script, paced.length), THE_WAY_BACK.console).toEqual(
      pagesOf(made, script, paced.length),
    );
  });

  it('keeps the floor: the console is recorded at a size it opens at', () => {
    // The console draws nothing but the size it lacks under 80 by 42 (`src/repl/floor.ts`), and a
    // recording made under it would be a recording of that screen.
    expect(columns).toBeGreaterThanOrEqual(80);
    expect(rows).toBeGreaterThanOrEqual(42);
    const pages = pagesOf(made, script, paced.length);
    expect(pages.some((page) => page.includes(PROMPT))).toBe(true);
  });

  it('spells the home `~` and changes nothing else on any page', () => {
    // THE RESPELLING, HELD. Replayed without it, every page is the same page with the sandbox's
    // path where the recording has `~` — so the one thing the recording does to the console's
    // bytes moves no row and leaves no cell behind.
    const raw = slicesOf(ran, paced.length);
    const before = theShellLine(script.shell);
    const shell = before.map(({ bytes }) => bytes).join('');
    let drawnRaw = shell;
    let drawnRecorded = shell;
    raw.forEach((slice) => {
      drawnRaw += slice.replace(/\r?\n/g, '\r\n');
      drawnRecorded += asRecorded(slice, home);
      const unspelled = screenOf(drawnRaw, columns, rows).text.split(home).join('~');
      expect(screenOf(drawnRecorded, columns, rows).text).toBe(unspelled);
    });
    // And nothing of the sandbox reaches the recording, which is the reason for the respelling.
    expect(fileOf(made)).not.toContain(sandbox);
  });

  it('opens where a person opens it, and every read changes the page', () => {
    // NON-VACUITY, read off the drive and not assumed: the bare name asked, the first door opened
    // the console, and each read brought its own answer — which is what makes the recording look
    // like a console answering rather than a page that sat still.
    const pages = pagesOf(made, script, paced.length);
    expect(pages[0]).toContain('what would you like to do here?');
    for (const one of script.steps) {
      if (one.waitsFor === undefined) continue;
      expect(pages.some((page) => page.includes(one.waitsFor as string))).toBe(true);
    }
    // What the session said stays on the caller's own screen once it has left: the last page is
    // the caller's buffer again, and the last answer is on it.
    const left = screenOf(drawnBy(made.events), columns, rows);
    expect(left.alternate).toBe(false);
    expect(left.text).toContain('census [backup-key]');
  });

  it('is the record whose opening document the front page quotes, cut only where it says', () => {
    // THE PAGE QUOTES WHAT A SESSION IS HANDED, AND SAYS OVER WHICH RECORD: this one. So the
    // block is held to `brief` over it, the way the first record's block is held to its commands
    // — every line shown was printed, in order, and a line that is `…` alone stands for lines
    // left out (`support/a-page-held-to-a-run.ts`).
    const quoted = theQuotedOpening(read(PAGE));
    const printed = spawnSync(process.execPath, [CLI, 'brief'], {
      cwd: project,
      encoding: 'utf-8',
      env: environment,
    });
    expect(printed.status, printed.stderr).toBe(0);
    const lines = printed.stdout.replace(/\n$/, '').split('\n').map(asMinted);
    expect(
      accountsFor(quoted.map(asMinted), lines),
      `${PAGE} quotes an opening \`brief\` does not print over ${CONSOLE_SCRIPT}'s record:\n` +
        `--- the page quotes:\n${quoted.join('\n')}\n--- brief printed:\n${printed.stdout}`,
    ).toBe(true);
    // NON-VACUITY: the quote is the document's beginning and its decisions, not an empty block.
    expect(quoted[0]).toContain('Generated by `mnema brief`');
    expect(quoted.filter((line) => line.startsWith('- **ADR-'))).toHaveLength(2);
  });

  it('is taller than the command line by the floor the page names', () => {
    // THE PAGE SAYS HOW BIG A WINDOW THE CONSOLE NEEDS, and the number is the floor's, read off
    // the product rather than retyped (`src/repl/floor.ts`).
    const said = /at least (\d+) columns wide and (\d+) rows tall/.exec(read(PAGE));
    expect(said, `${PAGE} no longer says the size the console needs`).not.toBeNull();
    expect([Number(said?.[1]), Number(said?.[2])]).toEqual([THE_FLOOR.columns, THE_FLOOR.rows]);
    expect(rows).toBeGreaterThan(castOf(read('recordings/first-record.cast')).header.height);
  });
});

/** The page the recordings are played on, and the section whose block quotes the opening. */
const PAGE = 'README.md';
const QUOTES_THE_OPENING = '## What a session is handed';

/**
 * The block the front page quotes the opening document in: the first fence under
 * {@link QUOTES_THE_OPENING} whose language is `text`. It throws when there is none, because a
 * case that silently read nothing would be a case saying a quote it never compared agrees.
 */
function theQuotedOpening(page: string): string[] {
  const heading = page.split('\n').indexOf(QUOTES_THE_OPENING) + 1;
  if (heading === 0) throw new Error(`${PAGE} no longer carries "${QUOTES_THE_OPENING}"`);
  const lines = linesOf(page).filter((line) => line.at > heading);
  const first = lines.find((line) => line.fence === 'text');
  if (first === undefined) throw new Error(`${PAGE} quotes no \`text\` block under the heading`);
  const block: string[] = [];
  for (const line of lines.filter((one) => one.at >= first.at)) {
    if (line.fence !== 'text' || line.at !== first.at + block.length) break;
    block.push(line.source);
  }
  return block;
}

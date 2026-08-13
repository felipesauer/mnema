/**
 * ONE AUTHORITY OVER COLOUR — the whole page obeys the caller, or none of it does.
 *
 * The session draws two kinds of thing and they had two authorities. What it SAYS is
 * composed and rendered by this product's own rule — a flag, two conventional variables, a
 * terminal (`src/wiring/color.ts`) — and obeyed the caller. What the page IS — the rules
 * that close its regions, the guide down its margin, the mark on a picked row, the
 * product's mark and its title — is drawn by the layout library and was coloured by the
 * library's own detection, which has no entry for `NO_COLOR` at all.
 *
 * MEASURED ON A REAL PSEUDO-TERMINAL, at a hundred by thirty, opening a session and asking
 * one verb — style sequences in the whole stream:
 *
 *   | the caller asked                  | before | after |
 *   |-----------------------------------|-------:|------:|
 *   | nothing (a terminal)              |    312 |   312 |
 *   | `NO_COLOR=1`                      |    120 |     0 |
 *   | `--color=never`, `FORCE_COLOR=1`  |    120 |     0 |
 *   | `--color=never` alone             |      0 |     0 |
 *   | `--color=always`, `NO_COLOR=1`    |    312 |   312 |
 *   | `TERM=dumb`                       |    192 |     0 |
 *   | `TERM=dumb`, `--color=always`     |    312 |   312 |
 *
 * The hundred and twenty were sixty accents and sixty closers — every one of them the
 * library's, and not one byte from our renderer.
 *
 * THE FOURTH ROW IS WHY THE SECOND CASE BELOW SETS `FORCE_COLOR`. That library sniffs the
 * process's own command line for `--color=never`, so the one rung a caller TYPES was already
 * being honoured by accident, and a case that asked the flag on its own would have come back
 * green over a defect that was whole. The variable is that library's real channel and it wins
 * over the sniff, so setting it is what makes the flag prove anything.
 *
 * WHAT THE CASES BELOW ASK, and why each needs the instrument it uses:
 *
 *   - THE QUIET DIRECTION, on a real device, over the WHOLE stream: `NO_COLOR` and
 *     `--color=never` each leave not one style sequence anywhere — ours or the library's.
 *     A pseudo-terminal is the only instrument for it, because the library's own detection
 *     is about a device.
 *   - AND IT IS THE PRODUCT THAT DECIDES, not the variable the library reads: the flag is
 *     asked with `FORCE_COLOR=1` set, which is the library's own channel saying the
 *     opposite.
 *   - THE LOUD DIRECTION, which a fix that only knew how to turn colour OFF would leave
 *     behind. It is asked in a pipe — a pair of streams standing in for a device — because
 *     that is where the library, left alone, paints nothing at all: this process's stdout
 *     is not a terminal, nothing forces colour, and the flag sniff that library does over
 *     `process.argv` finds no `--color` on a test runner's command line. So the chrome on
 *     that page is painted for one reason only. Measured on that page, nine rules drawn
 *     across it: **nought of the nine painted before, nine of the nine after**.
 *   - AND THE TERMINAL'S OWN WORD. `TERM=dumb` is where the two authorities disagreed in
 *     BOTH directions: the library honoured it and this product's precedence did not read
 *     `TERM` at all, so the page was half painted — and delivering our answer without
 *     reading it painted the page whole on a device that had declared it cannot. The rung
 *     is in the precedence now, under both variables, and the page is quiet. The pair-by-
 *     pair ordering is `src/chosen-once.test.ts`; what is asked here is the PAGE.
 *   - AND THE SITES, BY THE DISCRIMINANT. Not a list of files: the modules that load the
 *     library are found by what they IMPORT, and the channel is found by its own name.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIo } from '../src/cli.js';
import { run } from '../src/cli.js';
import { foldedAt } from '../src/presentation/folded.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { PAINTS, PLAIN, theLibraryIsTold, WHAT_THE_LIBRARY_READS } from '../src/repl/painting.js';
import { openSession } from '../src/repl/session.js';
import { paintsAtAll } from '../src/wiring/color.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import {
  ENDS_THE_INPUT,
  fakeTerminal,
  hooksNothing,
  until,
  withoutLayout,
} from './support/console.js';
import {
  aFrameSince,
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Step,
} from './support/pty.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** `packages/code/src`, for the scan that reads this product's own source. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/** The verb the caller types, and the first words of what it answers. */
const A_VERB = 'search';

/** The glyph a rule is drawn out of, by code point — the page's own edge. */
const RUN = '\u2500';

/**
 * THE ACCENT AS BYTES: SGR 35, which is what the layout's word `magenta` becomes.
 *
 * Spelled here as the escape rather than the word, because what these cases read is a
 * stream: the two spellings of the one accent are held together on the bytes of a frame by
 * `the-page-shows-its-seams.test.ts`, and this reads the end of that elo the library
 * writes.
 */
const ACCENT = '\u001b[35m';

/** Every style sequence in some bytes, in the order they appear. */
function sgrOf(text: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.match(/\u001b\[[0-9;]*m/g) ?? [];
}

/** The same bytes with every style sequence taken out — what a pipe would have received. */
function stripped(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS the subject.
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Whether a row of a page is a rule and nothing else — the discriminant for a seam. */
function isRule(row: string): boolean {
  const drawn = stripped(row).replace(/ +$/, '');
  return drawn.length > 0 && [...drawn].every((glyph) => glyph === RUN);
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** A port that throws everything away, for the calls made for their effect. */
const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

beforeAll(async () => {
  // A6: a sandbox of this run's own. Nothing here writes into the working tree.
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-colour-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  // NEITHER VARIABLE IS SET, and that is the premise the loud case rests on: with the
  // library's own channel silent and this process's stdout a pipe, the library paints
  // nothing of its own accord.
  delete process.env[WHAT_THE_LIBRARY_READS];
  process.chdir(project);

  await run(['init'], quiet);
  await run(['task', 'the task the colour is measured over'], quiet);

  // TAKEN BEFORE ANY SESSION RUNS IN THIS PROCESS, because opening one writes the
  // library's channel into this process's own environment — which is the whole subject.
  // A runner that inherited that would be a device told what to do by the last case.
  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    // A TERMINAL THAT SAYS IT CAN PAINT. Without it the library distrusts the device and
    // paints nothing whatever anybody decides, so every case below would be answered by
    // the fixture instead of by the product.
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs `mnema repl` on a pseudo-terminal of a given size. */
async function inPty(options: {
  readonly columns: number;
  readonly rows: number;
  readonly steps: readonly Step[];
  readonly environment?: NodeJS.ProcessEnv;
  /** What goes on the command line before the verb — a `--color`, when a case asks one. */
  readonly asked?: string;
}) {
  const fixture: Fixture = {
    cli: CLI,
    verb: options.asked === undefined ? REPL_VERB : `${options.asked} ${REPL_VERB}`,
    project,
    scratch: sandbox,
    environment: options.environment ?? environment,
  };
  return drive(fixture, options);
}

/** The step every session begins with, the one that asks a verb, and the one that leaves. */
const opens: Step = opensAConsole(PROMPT);
const asks: Step = { types: `${A_VERB}\r`, until: aFrameSince(PROMPT), what: `asked ${A_VERB}` };
const leaves: Step = leavesTheSession;

/** The three steps every case below drives, and the size it drives them at. */
const A_SESSION = { columns: 100, rows: THE_FLOOR.rows, steps: [opens, asks, leaves] };

// ---------------------------------------------------------------------------
// The quiet direction, on a device
// ---------------------------------------------------------------------------

describe('a caller who asked for no colour gets none of it, anywhere on the page', () => {
  it('leaves not one style sequence in the stream with `NO_COLOR` set', async () => {
    const quietly = { ...environment, NO_COLOR: '1' };
    const ran = await inPty({ ...A_SESSION, environment: quietly });
    // THE WHOLE STREAM, not one frame: everything the device received from the moment the
    // runner started to the transcript written back on the way out. A count over one frame
    // would say nothing about the opening or about what is left on the caller's own page.
    const left = sgrOf(ran.bytes);
    expect(left.length, `the page still carries colour: ${[...new Set(left)].join(' ')}`).toBe(0);
    // AND THE PAGE IS STILL THE PAGE. A session that failed to open, or one whose every
    // frame was empty, would satisfy the count above and say nothing at all.
    expect(ran.bytes, 'the session never answered the verb').toContain('record(s)');
    expect(ran.bytes, 'the page has no edges left').toContain(RUN);

    // NOT VACUOUS: the same session, same size, same steps, with nothing asking for quiet
    // — and the LIBRARY's own accent is in it. That sequence is the one this delivery
    // silenced, so its presence here is what makes the zero above a measurement.
    const loud = await inPty(A_SESSION);
    expect(sgrOf(loud.bytes).length, 'nothing is painted even with colour on').toBeGreaterThan(0);
    expect(loud.bytes, 'the layout painted nothing of its own even with colour on').toContain(
      ACCENT,
    );
  }, 300_000);

  it('answers `--color=never` the same way, against a variable saying the opposite', async () => {
    // THE PRODUCT DECIDES, NOT THE VARIABLE THE LIBRARY READS. `FORCE_COLOR` is that
    // library's own channel and it is set to ON here, so a session that came back quiet is
    // one where this product's flag reached the library and overruled it. Without this the
    // case would pass on a session where nobody had asked the library anything.
    const asked = { ...environment, [WHAT_THE_LIBRARY_READS]: PAINTS };
    const ran = await inPty({ ...A_SESSION, environment: asked, asked: '--color=never' });
    const left = sgrOf(ran.bytes);
    expect(left.length, `the flag was ignored: ${[...new Set(left)].join(' ')}`).toBe(0);
    expect(ran.bytes, 'the session never answered the verb').toContain('record(s)');

    // NOT VACUOUS: the same environment WITHOUT the flag paints, and the accent in it is
    // the library's — so what the flag turned off was the library and not the fixture.
    const loud = await inPty({ ...A_SESSION, environment: asked });
    expect(loud.bytes, 'the variable alone paints nothing').toContain(ACCENT);
  }, 300_000);

  it('takes a `dumb` terminal at its word, on the whole page and on both halves', async () => {
    // THE RUNG THE OTHER TWO CASES DO NOT REACH, and the one where the two authorities used
    // to disagree in BOTH directions. `TERM=dumb` is a real terminal declaring it prints
    // text and nothing else. The layout library has always honoured it and this product's
    // precedence did not, so the page came out half painted — a hundred and ninety-two
    // style sequences from this renderer and none from the library. Handing our answer over
    // without reading `TERM` made it three hundred and twelve, which is the same
    // disagreement resolved to the other side. Reading it is the agreement.
    const dumb = { ...environment, TERM: 'dumb' };
    const ran = await inPty({ ...A_SESSION, environment: dumb });
    const left = sgrOf(ran.bytes);
    expect(
      left.length,
      `a terminal that said it cannot paint was painted: ${[...new Set(left)].join(' ')}`,
    ).toBe(0);
    // AND IT IS A PAGE, not a session that never got there: the verb answered and the edges
    // are drawn. The glyphs are what a `dumb` terminal can show; the escapes are not.
    expect(ran.bytes, 'the session never answered the verb').toContain('record(s)');
    expect(ran.bytes, 'the page has no edges left').toContain(RUN);

    // AND THE CALLER'S OWN REQUEST STILL OUTRANKS THE DEVICE, which is what keeps this a
    // rung and not a ban: `--color=always` on the same terminal paints, chrome included.
    // It is also the non-vacuity of the zero above — the same fixture, one flag apart.
    const asked = await inPty({ ...A_SESSION, environment: dumb, asked: '--color=always' });
    expect(sgrOf(asked.bytes).length, 'the flag lost to the terminal').toBeGreaterThan(0);
    expect(asked.bytes, 'the chrome stayed bare where the caller asked for colour').toContain(
      ACCENT,
    );
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The loud direction, in a pipe
// ---------------------------------------------------------------------------

describe('a caller who asked for colour gets it on the chrome too, not only on the lines', () => {
  it('paints the page’s own edges where the library would have painted nothing', async () => {
    // THE PREMISE, ASSERTED RATHER THAN ASSUMED: this process's output is not a terminal
    // and the library's channel is silent, which is the state in which that library paints
    // nothing. A case that ran with either of those false would be reading a fixture.
    expect(process.stdout.isTTY, 'this process has a terminal, so the premise is gone').not.toBe(
      true,
    );
    expect(process.env[WHAT_THE_LIBRARY_READS], 'something already forced colour').toBeUndefined();

    const terminal = fakeTerminal({ columns: 120, rows: THE_FLOOR.rows });
    const closed = openSession({
      io: quiet,
      // THE INVOCATION ASKED FOR COLOUR, which is what `--color=always` resolves to one
      // layer up (`src/wiring/color.ts`): the session is handed the rule, not the flag.
      renderingAt: () => renderStyled,
      self: REPL_VERB,
      input: terminal.stdin,
      output: terminal.stdout,
      interactive: true,
      leaving: hooksNothing,
    });
    await until(() => terminal.bytes().includes(PROMPT), 'opened');
    terminal.type(ENDS_THE_INPUT);
    await closed;

    const rows = withoutLayout(terminal.bytes()).split('\n');
    const rules = rows.filter(isRule);
    expect(rules.length, 'the page drew no edge at all').toBeGreaterThan(0);
    expect(rules[0], 'the chrome is unpainted where the caller asked for colour').toContain(ACCENT);
    // AND THE DECISION IS WHAT SAID SO: after a session that paints, the channel carries the
    // product's answer. It is the elo between the page above and the module below.
    expect(process.env[WHAT_THE_LIBRARY_READS]).toBe(PAINTS);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

describe('the answer is measured off the renderer, so the two cannot disagree', () => {
  it('says of each renderer what that renderer does', () => {
    expect(paintsAtAll(renderStyled)).toBe(true);
    expect(paintsAtAll(renderPlain)).toBe(false);
    // AND A FOLD IS NOT A COLOUR. `chooseRenderer` wraps whichever painting it was handed
    // in the one that folds, so a page on a terminal is answered by a folded renderer —
    // and a probe that read the fold as paint would tell the library the opposite thing on
    // every device that reported a width.
    expect(paintsAtAll(foldedAt(80, renderStyled))).toBe(true);
    expect(paintsAtAll(foldedAt(80, renderPlain))).toBe(false);
  });

  it('would go quiet on a probe the painting renderer does not paint', () => {
    // THE ONE WAY THIS ANSWER CAN ROT, pinned rather than left to inspection: a part in a
    // role that carries no weight comes back untouched from BOTH renderers
    // (`presentation/styled.ts`, `painted`), so a probe built out of one would report that
    // the painting renderer does not paint. The line the rule really uses is a `label`.
    const bare = { indent: 0, parts: [{ role: 'field' as const, text: 'colour' }] };
    expect(renderStyled(bare), 'a bare role has started carrying a weight').toBe(renderPlain(bare));
    const painted = { indent: 0, parts: [{ role: 'label' as const, text: 'colour' }] };
    expect(renderStyled(painted), 'the probe’s own role stopped being painted').not.toBe(
      renderPlain(painted),
    );
  });

  it('writes the value the library reads, and nothing else', () => {
    // Over a map of its own: what the product does to the environment is one assignment,
    // and it is asserted here so the pty cases above are reading a mechanism that was
    // stated rather than one they inferred.
    const env: NodeJS.ProcessEnv = {};
    theLibraryIsTold(true, env);
    expect(env).toEqual({ [WHAT_THE_LIBRARY_READS]: PAINTS });
    theLibraryIsTold(false, env);
    expect(env).toEqual({ [WHAT_THE_LIBRARY_READS]: PLAIN });
    // The two values are the library's own vocabulary and not a spelling of ours.
    expect([PAINTS, PLAIN]).toEqual(['1', '0']);
  });
});

// ---------------------------------------------------------------------------
// A1: the sites, found by the discriminant
// ---------------------------------------------------------------------------

/** One module of this surface: where it lives, its bytes, and its bytes as code. */
interface Module {
  readonly where: string;
  readonly raw: string;
  readonly code: string;
}

/** Every module of this surface that ships, tests excluded. */
function modules(): readonly Module[] {
  return sourceFiles(SRC).map((file) => {
    const raw = readFileSync(file, 'utf-8');
    return { where: file.slice(SRC.length + 1), raw, code: codeOnly(raw) };
  });
}

/** One import a module makes: what it names, and whether the import LOADS anything. */
interface Imported {
  /** The module it resolves to, in the same form as {@link Module.where}. */
  readonly what: string;
  /**
   * How it is reached: `value` loads the module, `type` is erased and loads nothing,
   * `dynamic` loads it when the line runs rather than when the file does.
   */
  readonly how: 'value' | 'type' | 'dynamic';
}

/**
 * WHAT ONE MODULE IMPORTS, by kind.
 *
 * Read off the raw source rather than off {@link Module.code}, because a specifier is a
 * STRING and `codeOnly` blanks those. The statements are anchored at the start of a line,
 * which is what keeps a doc-comment out of the answer: every line of one begins with a
 * space and a star.
 */
function importsOf(module: Module): readonly Imported[] {
  const resolve = (specifier: string): string =>
    specifier.startsWith('.')
      ? join(module.where, '..', specifier).replace(/\.js$/, '.ts')
      : specifier;
  const found: Imported[] = [];
  for (const match of module.raw.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)';/gm)) {
    found.push({
      what: resolve(match[2] as string),
      how: match[1] === undefined ? 'value' : 'type',
    });
  }
  for (const match of module.raw.matchAll(/\bimport\('([^']+)'\)/g)) {
    found.push({ what: resolve(match[1] as string), how: 'dynamic' });
  }
  return found;
}

/** The layout library, by the name a module has to write to load it. */
const THE_LIBRARY = 'ink';

describe('A1: what loads the library, and what tells it', () => {
  /**
   * EVERY MODULE THAT LOADS THE LAYOUT LIBRARY — the ones that name it, plus everything
   * that loads one of THOSE when its own file is loaded.
   *
   * A closure and not a list, which is what makes the answer survive a module added
   * tomorrow: a new component that imports the library joins it by naming it, and a module
   * that statically imports a component joins it by reaching one.
   */
  function reachingTheLibrary(all: readonly Module[]): readonly string[] {
    const reaching = new Set(
      all
        .filter((module) => importsOf(module).some((each) => each.what === THE_LIBRARY))
        .map((module) => module.where),
    );
    for (let again = true; again; ) {
      again = false;
      for (const module of all) {
        if (reaching.has(module.where)) continue;
        const loads = importsOf(module).some(
          (each) => each.how === 'value' && reaching.has(each.what),
        );
        if (!loads) continue;
        reaching.add(module.where);
        again = true;
      }
    }
    return [...reaching].sort();
  }

  it('is three modules, and the scan that says so really read this surface', () => {
    const all = modules();
    // THE CORPUS IS REAL: a scan that found no file passes every case below saying nothing.
    expect(all.length).toBeGreaterThan(50);
    expect(all.map((module) => module.where)).toContain('repl/session.ts');
    // IT WAS TWO AND THE THIRD IS THE QUESTION THE BARE NAME ASKS. It draws rows and reads
    // keys with the same library, which is what makes the rule below a rule in TWO places
    // rather than a property of one file.
    expect(reachingTheLibrary(all)).toEqual([
      'choice/screen.ts',
      'repl/console.ts',
      'repl/region.ts',
    ]);
  });

  it('is reached from the rest of the surface only by DYNAMIC imports, at every door', () => {
    // THE PROPERTY THE WHOLE DELIVERY RESTS ON. That library reads the channel once, while
    // its own module graph is being loaded, so the answer has to be written before the
    // import that loads it — and a STATIC import of any of it from anywhere would run
    // before every line of every function, this one included.
    //
    // IT NAMED ONE DOOR AND THERE ARE TWO, which is the amarra rather than a correction: a
    // rule that holds in N places with a guard that names one is exactly the class this
    // bench has paid for eight times. What is asserted is the SET, found by what each module
    // imports — so a third door added tomorrow is named here the day it is written.
    const all = modules();
    const library = reachingTheLibrary(all);
    const doors = all
      .filter((module) => !library.includes(module.where))
      .flatMap((module) =>
        importsOf(module)
          .filter((each) => library.includes(each.what))
          .map((each) => `${module.where} ${each.how}`),
      )
      .sort();
    // The type-only ones are erased by the compiler and load nothing: the shape of a line
    // the session needs (`Drawn`) and the shape of what a screen answers with (`Screen`).
    // They are named here so a pass is not read as saying there is one mention per door.
    expect(doors).toEqual([
      'choice/asked.ts dynamic',
      'choice/asked.ts type',
      'repl/session.ts dynamic',
      'repl/session.ts type',
    ]);
    // AND NOT ONE OF THEM IS A VALUE IMPORT, said as the rule rather than as a list: it is
    // what the enumeration above is FOR, and it is the half that survives a door being added.
    expect(doors.filter((door) => door.endsWith(' value'))).toEqual([]);
  });

  it('would accuse the static import an author would reach for', () => {
    // NOT VACUOUS: the same scan over the same surface with one line changed — the shape
    // somebody adding a component would write — names the file that broke it.
    const all = modules();
    const relapse = all.map((module) =>
      module.where === 'repl/panel.ts'
        ? { ...module, raw: `import { Box } from './region.js';\n${module.raw}` }
        : module,
    );
    expect(reachingTheLibrary(relapse)).toContain('repl/panel.ts');
    // And a TYPE import of the same module is not an accusation, because it loads nothing.
    const typed = all.map((module) =>
      module.where === 'repl/panel.ts'
        ? { ...module, raw: `import type { Shown } from './region.js';\n${module.raw}` }
        : module,
    );
    expect(reachingTheLibrary(typed)).not.toContain('repl/panel.ts');
  });

  it('tells the library before the line that loads it, at EVERY door', () => {
    // THE RULE, ASKED OF EACH DOOR RATHER THAN OF ONE FILE. Both of them load the library
    // and both of them must have said what this product decided before that line runs — so
    // the doors are found by the discriminant (the dynamic import of a module that reaches
    // the library) and each is then held to the same two things.
    const all = modules();
    const library = reachingTheLibrary(all);
    const doors = all.filter((module) =>
      importsOf(module).some((each) => each.how === 'dynamic' && library.includes(each.what)),
    );
    // NOT VACUOUS: the walk really found doors, so what follows is asserted of something.
    expect(doors.map((door) => door.where).sort()).toEqual(['choice/asked.ts', 'repl/session.ts']);
    for (const door of doors) {
      // ONE CALL. Two would be two answers about one page, which is the defect one layer up.
      expect((door.code.match(/theLibraryIsTold\(/g) ?? []).length, door.where).toBe(1);
      // AND ONE DYNAMIC IMPORT in the file, so the position below names the import that
      // loads the library rather than whichever came first.
      expect((door.code.match(/\bimport\(/g) ?? []).length, door.where).toBe(1);
      expect(door.code.indexOf('theLibraryIsTold('), door.where).toBeLessThan(
        door.code.indexOf('import('),
      );
    }
  });

  it('names the channel in exactly the two places that read it and write it', () => {
    // THE DISCRIMINANT IS THE CHANNEL'S OWN NAME, over the raw source — prose included,
    // deliberately: a third module that so much as talks about this variable is a third
    // opinion about colour waiting to be written.
    const naming = modules()
      .filter((module) => module.raw.includes(WHAT_THE_LIBRARY_READS))
      .map((module) => module.where)
      .sort();
    expect(naming).toEqual(['repl/painting.ts', 'wiring/color.ts']);
  });
});

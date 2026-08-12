/**
 * WHICH RENDERER, chosen once — the precedence, the flag that reaches it, and the
 * rule that keeps the question from being asked anywhere else.
 *
 * Three properties, and they fail in three different ways:
 *
 *   - THE PRECEDENCE. `--color`, `NO_COLOR`, `FORCE_COLOR` and the terminal, in the
 *     order the market settled on. It is asserted pair by pair — each rung against
 *     the one below it — because the failure is not a crash: it is a caller whose
 *     `NO_COLOR` was ignored, and the only thing that would notice is a person.
 *   - THE FLAG HAS A CALLER. A precedence nothing consults is a table. So the cases
 *     drive the whole program, over a real record, and read the bytes.
 *   - NOBODY ELSE ASKS. The renderer is named in ONE file of `wiring/` — the one
 *     that chooses it — and every other verb receives one. It was written a hundred
 *     and three times before, which is precisely why there was no way to choose.
 *
 * The vacuous form of the last one is a scan that matched nothing, so it asserts the
 * set of files it read and that its detector accuses a line someone would write.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from './cli.js';
import { fact } from './presentation/detail.js';
import { renderPlain } from './presentation/plain.js';
import type { Render } from './presentation/render.js';
import { renderStyled } from './presentation/styled.js';
import { type Capability, type ColorWhen, chooseRenderer } from './wiring/color.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

describe('the precedence is the conventional one', () => {
  /**
   * One capability, with the terminal absent unless a case says otherwise.
   *
   * NO WIDTH BY DEFAULT, which is what a pipe, a file and a test report — so every case
   * of the precedence is answered by one of the two renderers themselves and can be
   * compared by identity. Whether a line FOLDS is the other question, and it has its own
   * block below.
   */
  const asked = (
    when: ColorWhen,
    env: Record<string, string | undefined> = {},
    isTty = false,
    columns = 0,
  ): Capability => ({ when, env, isTty, columns });

  it('lets an EXPLICIT `--color` win over the environment, in BOTH directions', () => {
    // Rung one, and the rung that was wrong. `never` is the last resort of a caller
    // whose terminal lies about what it can render; `always` is the same request in
    // the other direction, from a script whose environment it did not choose. Both
    // beat `NO_COLOR`, and the second half is the correction: this table used to let
    // the flag win going quiet and lose going loud, which is an asymmetry no tool in
    // the market has. `auto` is not a request and appears in none of these.
    expect(chooseRenderer(asked('never', { FORCE_COLOR: '1' }, true))).toBe(renderPlain);
    expect(chooseRenderer(asked('never', { NO_COLOR: '1' }, true))).toBe(renderPlain);
    expect(chooseRenderer(asked('never', {}, true))).toBe(renderPlain);
    expect(chooseRenderer(asked('always', { NO_COLOR: '1' }))).toBe(renderStyled);
    expect(chooseRenderer(asked('always', { NO_COLOR: '1', FORCE_COLOR: '0' }))).toBe(renderStyled);
  });

  it('lets `NO_COLOR` win over `FORCE_COLOR` and the terminal, with no flag above it', () => {
    expect(chooseRenderer(asked('auto', { NO_COLOR: '1', FORCE_COLOR: '1' }))).toBe(renderPlain);
    expect(chooseRenderer(asked('auto', { NO_COLOR: '1' }, true))).toBe(renderPlain);
    // Any value, never the value: no-color.org says presence is the signal, so a
    // tool that read `NO_COLOR=0` as "colour, please" would be the tool that broke it.
    expect(chooseRenderer(asked('auto', { NO_COLOR: '0' }, true))).toBe(renderPlain);
  });

  it('answers the five cases the whole table is for', () => {
    // The precedence as a reader would ask it, one rung per row and every rung
    // exercised once. Row two is the one that inverted.
    const cases: readonly (readonly [ColorWhen, Record<string, string>, boolean, Render])[] = [
      ['never', { FORCE_COLOR: '1' }, false, renderPlain],
      ['always', { NO_COLOR: '1' }, false, renderStyled],
      ['auto', { NO_COLOR: '1' }, false, renderPlain],
      ['auto', { FORCE_COLOR: '1' }, false, renderStyled],
      ['auto', {}, false, renderPlain],
    ];
    for (const [when, env, isTty, expected] of cases) {
      expect(chooseRenderer(asked(when, env, isTty)), JSON.stringify({ when, env })).toBe(expected);
    }
    // Both answers appear, so a table that returned one renderer for everything could
    // not walk this case.
    expect(new Set(cases.map(([, , , expected]) => expected)).size).toBe(2);
  });

  it('reads an EMPTY `NO_COLOR` as absent, which is what the standard says', () => {
    // "Present and not an empty string" — and the case matters, because an unset
    // variable expands to the empty string in a shell: `NO_COLOR="$SOME_UNSET" mnema`
    // must not turn style off on a caller who set nothing.
    expect(chooseRenderer(asked('auto', { NO_COLOR: '' }, true))).toBe(renderStyled);
  });

  it('paints in a pipe when asked to, by flag or by variable', () => {
    // What makes `mnema … --color=always | less -R` work, and what a CI that wants a
    // readable log sets.
    expect(chooseRenderer(asked('always'))).toBe(renderStyled);
    expect(chooseRenderer(asked('auto', { FORCE_COLOR: '1' }))).toBe(renderStyled);
  });

  it('reads `FORCE_COLOR=0` as the off it means, even on a terminal', () => {
    // node and chalk both made that value mean "no colour", so a caller who set it
    // meant off — and a tool that forced style ON because the variable was merely
    // PRESENT would be the worst reading of both conventions.
    expect(chooseRenderer(asked('auto', { FORCE_COLOR: '0' }, true))).toBe(renderPlain);
    // The flag still wins over it: rung one is this invocation's own request.
    expect(chooseRenderer(asked('always', { FORCE_COLOR: '0' }))).toBe(renderStyled);
  });

  it('falls back to the terminal, which is where the default lives', () => {
    expect(chooseRenderer(asked('auto', {}, true))).toBe(renderStyled);
    // The case the golden depends on: output injected, no terminal, nothing forced —
    // plain, by this rule and not by a fixture that asked for it.
    expect(chooseRenderer(asked('auto', {}, false))).toBe(renderPlain);
  });

  it('never paints without a terminal unless something ASKED — over the whole space', () => {
    // The question the cases above answer one at a time, asked of every input at once:
    // is there a way to style a pipe that nobody requested? That is the failure that
    // reaches a CI log and a redirected file, and the one the recorded transcript would
    // pay for. Small enough to enumerate: three flags × three states of one variable ×
    // four of the other × two destinations.
    const whens: ColorWhen[] = ['auto', 'always', 'never'];
    let styled = 0;
    for (const when of whens) {
      for (const noColor of [undefined, '', '1']) {
        for (const forceColor of [undefined, '', '0', '1']) {
          for (const isTty of [false, true]) {
            const env = { NO_COLOR: noColor, FORCE_COLOR: forceColor };
            if (chooseRenderer({ when, env, isTty, columns: 0 }) !== renderStyled) continue;
            styled++;
            const wanted = when === 'always' || (forceColor !== undefined && forceColor !== '0');
            expect(wanted || isTty, JSON.stringify({ when, env, isTty })).toBe(true);
          }
        }
      }
    }
    // And the enumeration reached the styled renderer often enough to be saying
    // something: an implication is satisfied for free by a renderer that never paints.
    expect(styled).toBeGreaterThan(20);
  });
});

describe('the line folds only where there is a screen to fold it to', () => {
  /**
   * A line no ordinary terminal holds — the width is what decides whether it breaks.
   *
   * A hundred and twenty-six columns of it, so that eighty folds it and four hundred does
   * not: a case about a threshold needs a line on both sides of one, and a first draft of
   * this block used a sentence that fitted in eighty and asserted that eighty broke it.
   */
  const long = fact(
    'The console is read-only by construction, and that is the whole of it: it reads the ' +
      'record and it never writes to it.',
  );

  /** Whether what a capability resolves to breaks that line. */
  const folds = (capability: Capability): boolean =>
    chooseRenderer(capability)(long).includes('\n');

  it('hands a pipe the SAME renderer it always had, whatever it reports', () => {
    // THE INVARIANT, and it is asserted by IDENTITY rather than by comparing bytes: a
    // pipe, a file, a CI log and the recorded transcript get `renderPlain` itself, so
    // there is no arithmetic between the line and the stream for a fold to slip into.
    // The width is set anyway in the second case — a stream that reported one without
    // being a terminal must still not fold, or `mnema … | wc -l` would answer differently
    // depending on the window it was launched from.
    expect(chooseRenderer({ when: 'auto', env: {}, isTty: false, columns: 0 })).toBe(renderPlain);
    expect(chooseRenderer({ when: 'auto', env: {}, isTty: false, columns: 80 })).toBe(renderPlain);
    // And the same for the one flag that puts style in a pipe: `--color=always | less -R`
    // is a pager's business, and the pager is the thing with the window.
    expect(chooseRenderer({ when: 'always', env: {}, isTty: false, columns: 80 })).toBe(
      renderStyled,
    );
  });

  it('folds on a terminal that said how wide it is', () => {
    expect(folds({ when: 'auto', env: {}, isTty: true, columns: 80 })).toBe(true);
    // The other half of the same fact: the line is long enough that a fold has something
    // to do, so the case above cannot pass on a renderer that breaks everything.
    expect(folds({ when: 'auto', env: {}, isTty: true, columns: 400 })).toBe(false);
  });

  it('folds nothing on a terminal that never said', () => {
    // Zero is what the entry answers for a stream with no width, and a width nobody
    // reported is not a width to guess at.
    expect(chooseRenderer({ when: 'auto', env: {}, isTty: true, columns: 0 })).toBe(renderStyled);
  });

  it('is not a rung of the colour precedence: `--color=never` still folds', () => {
    // The two questions are orthogonal, and this is the case that says so. A caller who
    // typed `--color=never` on a terminal asked for no colour — not for the badly folded
    // line the terminal would give them — and one who set `NO_COLOR` in their profile
    // asked for even less than that.
    expect(folds({ when: 'never', env: {}, isTty: true, columns: 80 })).toBe(true);
    expect(folds({ when: 'auto', env: { NO_COLOR: '1' }, isTty: true, columns: 80 })).toBe(true);
    // And what it folds is the plain line: no colour was asked for and none arrives.
    const quiet = chooseRenderer({ when: 'never', env: {}, isTty: true, columns: 80 });
    expect(quiet(long)).not.toContain('\u001b');
  });

  it('never folds without a terminal — over the whole space at once', () => {
    // The question the cases above answer one at a time, asked of every input together:
    // is there a way to break a line for somebody who is not looking at a screen? That is
    // the failure that reaches a CI log, a redirected file and the recorded transcript.
    const whens: ColorWhen[] = ['auto', 'always', 'never'];
    let folded = 0;
    for (const when of whens) {
      for (const noColor of [undefined, '', '1']) {
        for (const isTty of [false, true]) {
          for (const columns of [0, 1, 40, 80, 400]) {
            const capability = { when, env: { NO_COLOR: noColor }, isTty, columns };
            if (!folds(capability)) continue;
            folded++;
            expect(isTty && columns > 0, JSON.stringify(capability)).toBe(true);
          }
        }
      }
    }
    // And the enumeration reached a fold often enough to be saying something.
    expect(folded).toBeGreaterThan(20);
  });
});

describe('the flag reaches the bytes', () => {
  let sandbox: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  let lines: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {
      failed = true;
    },
  };

  /** Everything one invocation wrote, on either stream, as one string. */
  async function invoke(...argv: string[]): Promise<string> {
    lines = [];
    failed = false;
    await run(argv, io);
    return lines.join('\n');
  }

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-color-'));
    const repo = join(sandbox, 'project');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    process.chdir(repo);
    await invoke('init');
  }, 60_000);

  afterEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  // `verify` is the read used throughout: its verdict is a `statement`, which is the
  // form that has a label and a detail — the two roles that carry weight. A verb whose
  // whole output is `fact` lines would print the same bytes either way and could not
  // tell a wired flag from an ignored one.
  it('paints when the invocation asks, with no terminal in sight', async () => {
    expect(await invoke('--color=always', 'verify')).toContain('\u001b[1m');
  });

  it('writes not one escape when nothing asks — the default of a pipe', async () => {
    expect(await invoke('verify')).not.toContain('\u001b');
  });

  it('folds to the width the PROCESS reports, and to nothing when it reports none', async () => {
    // A2, THE LINK: the width is read at the entry and spent on the renderer every verb is
    // handed, and this is the case that says it ARRIVES rather than that it is plumbed. The
    // structural scan that counts who asks a stream how big it is would stay green on an
    // entry that read the number and dropped it — a mechanism wired to the end and never
    // firing is four defects of this series, and it is what this case refuses.
    //
    // The stream is DRESSED as a terminal rather than a terminal being found: what is under
    // test is the rule, and the process running a suite has a pipe. Both properties are put
    // back whatever the case does.
    const stdout = process.stdout as unknown as { isTTY?: boolean; columns?: number };
    const wasTty = stdout.isTTY;
    const wasWide = stdout.columns;
    try {
      stdout.isTTY = true;
      stdout.columns = 40;
      // `verify` says a sentence of clauses that no forty-column terminal holds, so a
      // renderer that folds has something to break — and one that never folds does not.
      // Asked of the LINES rather than of the joined output, which holds a break between
      // every two of them: what is under test is a break INSIDE one line, which is the only
      // thing a fold puts there.
      const broken = async (): Promise<boolean> => {
        await invoke('verify');
        return lines.some((line) => line.includes('\n'));
      };
      expect(await broken()).toBe(true);
      stdout.columns = undefined;
      expect(await broken()).toBe(false);
      stdout.isTTY = false;
      stdout.columns = 40;
      expect(await broken()).toBe(false);
    } finally {
      stdout.isTTY = wasTty;
      stdout.columns = wasWide;
    }
  });

  it('honors `NO_COLOR` from the environment the process is really in', async () => {
    // `FORCE_COLOR` is set alongside it deliberately: with neither of them, a runner in
    // a pipe answers plain on the LAST rung and this case would pass without `NO_COLOR`
    // doing anything at all. The same invocation paints two cases below.
    process.env.FORCE_COLOR = '1';
    process.env.NO_COLOR = '1';
    expect(await invoke('verify')).not.toContain('\u001b');
  });

  it('honors `FORCE_COLOR`, and lets `--color=never` overrule it', async () => {
    process.env.FORCE_COLOR = '1';
    expect(await invoke('verify')).toContain('\u001b[1m');
    expect(await invoke('--color=never', 'verify')).not.toContain('\u001b');
  });

  it('lets an explicit `--color=always` overrule `NO_COLOR` — the rung that moved', async () => {
    // The correction, driven through the real program rather than through the pure
    // function above: a caller typing the flag on THIS invocation is being more
    // specific than a variable exported in their shell profile, which is what git,
    // ripgrep, fd, ls, bat and delta all do. It used to come back plain.
    process.env.NO_COLOR = '1';
    expect(await invoke('--color=always', 'verify')).toContain('\u001b[1m');
  });

  it('refuses a value that names no answer, as a usage error', async () => {
    // The set is closed at the declaration, so a typo is reported and exits non-zero
    // rather than silently falling back to the default — which would be a caller who
    // asked for plain output, was ignored, and told nothing.
    const said = await invoke('--color=bogus', 'verify');
    expect(failed).toBe(true);
    expect(said).toContain('--color');
    expect(said).not.toContain('\u001b');
  });
});

describe('nothing else decides which renderer', () => {
  /**
   * The three renderers, by the name a file would have to write to use one.
   *
   * THE THIRD IS A FUNCTION THAT MAKES ONE rather than a value, and it belongs on this
   * list for exactly the reason the other two do: naming it is deciding how output looks,
   * and the decision is the caller's terminal's. A list of two would have let any module
   * reach for the fold without a case noticing — which is the shape of hole this whole
   * block exists to keep shut.
   */
  const RENDERERS = ['renderPlain', 'renderStyled', 'foldedAt'];

  /** Every module of a directory that ships, tests excluded. */
  const shipped = (dir: string): string[] =>
    readdirSync(join(HERE, dir))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();

  /** The modules of `dir` that name a renderer at all. */
  const naming = (dir: string): string[] =>
    shipped(dir).filter((file) => {
      const source = readFileSync(join(HERE, dir, file), 'utf-8');
      return RENDERERS.some((renderer) => source.includes(renderer));
    });

  it('is named in ONE file of the wiring: the one that chooses it', () => {
    // Every other verb takes a renderer off its `Wiring`. This is the rule that the
    // hundred and three call sites broke by existing: each of them said "the plain
    // one", so the answer was written at the call site and could not be given to it.
    expect(naming('wiring')).toEqual(['color.ts']);
  });

  it('and in `presentation/` only by the files that ARE one', () => {
    // The other half, and the one that rots first: six report builders composed a
    // whole report out of rendered strings, so a seventh would reach for a renderer
    // by hand and nothing outside this case would notice.
    //
    // THREE FILES NOW, and the third is the one that FOLDS: it names the loop it wraps
    // and the wiring names it, which is the same shape the painted one has. What would
    // be a defect is a fourth — a report builder deciding that its own lines break
    // differently from every other line of this product.
    expect(naming('presentation')).toEqual(['folded.ts', 'plain.ts', 'styled.ts']);
  });

  it('and not in the session, which is the newest thing that prints', () => {
    // A DIRECTORY THAT PRINTS AND IS NOT A VERB. The two cases above are the whole rule
    // as long as everything that reaches a stream is a verb or a composer; the
    // interactive session is neither — it prints a banner, a menu of what it runs and
    // its own refusals — and it is the one place on this surface where the renderer
    // could be resolved a SECOND time, because it is the one that lives long enough to
    // ask twice. It takes one, resolved at the entry for the whole session, and names
    // neither.
    // THE ONE MODULE HERE THAT HAS A REASON TO ASK is the opening panel, which chooses
    // between three drawings by whether each fits the terminal — and it asks how wide a
    // line is rather than rendering one, because `presentation/` is where that question is
    // answered (`plain.ts`, `widthOf`). It named a renderer on its first draft and this
    // case is what said so.
    expect(naming('repl')).toEqual([]);
    // Read, rather than absent: the directory exists and it does print.
    expect(shipped('repl')).toEqual([
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
      // IT NAMES NO RENDERER AND IT IS ABOUT COLOUR, which is exactly the distinction this
      // case draws: it hands the answer this wiring already reached to the layout library,
      // on the channel that library reads, and never asks the question itself
      // (`repl/painting.ts`, and `tests/one-authority-over-colour.test.ts` for the sites).
      'painting.ts',
      'palette.ts',
      'panel.ts',
      'pointing.ts',
      'region.ts',
      'scrolling.ts',
      'seen.ts',
      'session.ts',
      'standing.ts',
    ]);
    // AND THE WITNESS THAT IT PRINTS USED TO BE `writeLines(io,`, which was the report
    // `/help` wrote. That word is gone — the list under the prompt answers it now — so the
    // line it wrote is gone with it, and a witness left pointing at it would have made this
    // case red for a reason that has nothing to do with what it is about. What the session
    // still writes, and what it has always written more of, is refusals.
    expect(readFileSync(join(HERE, 'repl', 'session.ts'), 'utf-8')).toContain('reportUsage(');
  });

  it('read the modules it claims to have read', () => {
    // The vacuous form: a scan of an empty directory passes and says nothing.
    expect(shipped('wiring').length).toBeGreaterThan(20);
    for (const verb of ['key.ts', 'init.ts', 'verify.ts', 'show.ts', 'search.ts']) {
      expect(shipped('wiring')).toContain(verb);
    }
    expect(shipped('presentation').length).toBeGreaterThan(10);
  });

  it('would accuse a verb that named one', () => {
    // And the other vacuous form: a detector whose terms match nothing any more.
    // Composed against the line a careful author would write — the import AND the
    // call, so the build would not fail first and hide the accusation.
    const relapse = [
      "import { renderPlain } from '../presentation/plain.js';",
      "io.out(renderPlain(fact('identity: ' + result.anchor)));",
    ].join('\n');
    expect(RENDERERS.filter((renderer) => relapse.includes(renderer))).toEqual(['renderPlain']);
  });
});

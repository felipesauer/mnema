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
import { renderPlain } from './presentation/plain.js';
import type { Render } from './presentation/render.js';
import { renderStyled } from './presentation/styled.js';
import { type Capability, type ColorWhen, chooseRenderer } from './wiring/color.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

describe('the precedence is the conventional one', () => {
  /** One capability, with the terminal absent unless a case says otherwise. */
  const asked = (
    when: ColorWhen,
    env: Record<string, string | undefined> = {},
    isTty = false,
  ): Capability => ({ when, env, isTty });

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
      expect(chooseRenderer({ when, env, isTty }), JSON.stringify({ when, env })).toBe(expected);
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
            if (chooseRenderer({ when, env, isTty }) !== renderStyled) continue;
            styled++;
            const asked = when === 'always' || (forceColor !== undefined && forceColor !== '0');
            expect(asked || isTty, JSON.stringify({ when, env, isTty })).toBe(true);
          }
        }
      }
    }
    // And the enumeration reached the styled renderer often enough to be saying
    // something: an implication is satisfied for free by a renderer that never paints.
    expect(styled).toBeGreaterThan(20);
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
  /** The two renderers, by the name a file would have to write to use one. */
  const RENDERERS = ['renderPlain', 'renderStyled'];

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

  it('and in `presentation/` only by the two files that ARE one', () => {
    // The other half, and the one that rots first: six report builders composed a
    // whole report out of rendered strings, so a seventh would reach for a renderer
    // by hand and nothing outside this case would notice.
    expect(naming('presentation')).toEqual(['plain.ts', 'styled.ts']);
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
      'complete.ts',
      'console.ts',
      'editing.ts',
      'gate.ts',
      'leaving.ts',
      'page.ts',
      'panel.ts',
      'region.ts',
      'session.ts',
      'standing.ts',
    ]);
    expect(readFileSync(join(HERE, 'repl', 'session.ts'), 'utf-8')).toContain('writeLines(io,');
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

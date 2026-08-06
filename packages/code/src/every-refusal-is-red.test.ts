/**
 * EVERY NO IS RED, AND NOTHING IS RED ALONE.
 *
 * THE FIRST HALF USED TO BE NARROWER, AND THIS IS WHAT FALSIFIED IT. It read: *red
 * marks a TYPED refusal — the domain's own no — and a usage error does not paint,
 * because that one is the parser's channel*. The argument for it was that the rule
 * stayed sayable. What fell over it is a terminal: a person one argument short met
 * `error: missing required argument 'rationale'` — unpainted, lowercase, naming an
 * internal parameter — and a person one letter off met the same. The line was true
 * about where a no CAME FROM and false about what a reader does with it, because
 * "the gate said no" and "you typed it wrong" are one piece of news: the thing did
 * not happen. The rule now is A LINE IS RED WHEN THE COMMAND DID NOT DO WHAT YOU
 * ASKED, and the eighteen usage errors that used to go out unpainted go through the
 * same funnel as the rest (`wiring/report.ts`, `wiring/usage.ts`).
 *
 * What the rule still does NOT reach is an ANSWER that happens to be unwelcome, and
 * the boundary is worth stating because it is the one an adversary probes: `verify`
 * naming a broken tree DID what it was asked — it ruled — and its per-tree summary is
 * the chain's own sentence printed verbatim, with the tree's name in the label the
 * colour would land on. `guard`'s `REFUSED` is the one verdict that paints, and it
 * paints the word.
 *
 * Two halves of one promise, and they fail in opposite directions.
 *
 *   - A REFUSAL IS ONE SHAPE, WORDED IN ONE PLACE. The surface refuses from twenty-odd
 *     verbs and it says so through a single funnel, which is what lets the whole
 *     surface acquire a colour in one edit. The failure is a verb that words its own:
 *     it exits non-zero either way, so nothing breaks — a reader just meets one bad
 *     line that does not look like the other twenty. This file found one when it was
 *     written (`refs` re-typed the funnel's own `NO_PROJECT` sentence by hand), which
 *     is why the guard is a scan of the SOURCE and not a list of verbs. The scan now
 *     covers the OTHER way out too: a verb that hands its own sentence straight to
 *     the stream, which is how eighteen of them stayed unpainted while every case
 *     about the shape was green.
 *   - AND THE COLOUR ONLY REPEATS THE WORD. A refusal says `Refused`, a verdict says
 *     `ALLOWED` or `REFUSED`, and the hue is a second copy of that for an eye scanning
 *     a screen. The failure here is silent and it is the worse of the two: a line that
 *     drops the word because the colour "already says it" reads as a success in a
 *     pipe, in a CI log, on a monochrome terminal, and to the readers whose colour
 *     vision does not separate red from green.
 *
 * The vacuous form of the first is a scan that matched nothing, so the detector is
 * asserted to accuse a line someone would write. The vacuous form of the second is a
 * comparison between two identical plain strings, so every case that reads the words
 * is paired with one that reads the escapes.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from './cli.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Red, and the closer for it — what the refusal is painted with. */
const RED = '\u001b[31m';
const DEFAULT_HUE = '\u001b[39m';

/** Every module of `wiring/` that ships, tests excluded. */
const shipped = (): readonly string[] =>
  readdirSync(join(HERE, 'wiring'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();

/** One shipped module's source. */
const sourceOf = (file: string): string => readFileSync(join(HERE, 'wiring', file), 'utf-8');

/**
 * What WORDING a refusal looks like in source: the shape's own interpolation.
 *
 * Not the bare word `Refused`, which appears in two doc comments describing the shape
 * and in a dozen type names in `commands/`. The template hole is what only the code
 * that BUILDS the line has.
 */
const WORDS_A_REFUSAL = 'Refused (${';

describe('a refusal is worded in exactly one place', () => {
  it('is built by one module of the wiring, and no verb writes its own', () => {
    const wording = shipped().filter((file) => sourceOf(file).includes(WORDS_A_REFUSAL));
    expect(wording).toEqual(['report.ts']);
  });

  it('reaches the stream through a renderer at every one of its producers', () => {
    // The line is a `Line` now, so a producer that wrote it as bytes would not
    // compile — but a producer could still be ADDED with its own wording, and the case
    // above is what refuses that. This one names the ones that exist and asserts each
    // hands the line to a renderer rather than to `io.err` directly, because that is
    // what makes the colour reach it. `usage.ts` is the newest: the parser's no falls
    // back to this shape for a code nobody worded.
    const producers = shipped().filter((file) => sourceOf(file).includes('refusalLine('));
    expect(producers).toEqual(['report.ts', 'run-pin.ts', 'usage.ts']);
    for (const file of producers) {
      const source = sourceOf(file);
      expect(source, file).toMatch(/render\(\s*refusalLine\(|render\(line\)/);
    }
    // The third lives at the entry, outside `wiring/`: the throw for a machine whose
    // record names no single identity. It is a refusal like any other and it is
    // rendered like any other.
    const entry = readFileSync(join(HERE, 'cli.ts'), 'utf-8');
    expect(entry).toContain('render(refusalLine(');
    expect(entry).not.toContain(WORDS_A_REFUSAL);
  });

  it('and no verb hands the shared wording to a stream itself', () => {
    // The other half of "worded in one place", and the half the SHAPE detector above
    // cannot see: a verb does not have to rebuild `Refused (CODE)` to write a refusal
    // of its own — it can reach for the funnel's own sentence and print it. One did,
    // and its line was the only refusal on the surface that came out unpainted while
    // every case about the shape stayed green.
    const guilty = shipped().filter(
      (file) => file !== 'report.ts' && /io\.err\([^)]*NO_PROJECT/.test(sourceOf(file)),
    );
    expect(guilty).toEqual([]);
    // And the detector still matches the line it was written against.
    expect(/io\.err\([^)]*NO_PROJECT/.test('          io.err(NO_PROJECT);')).toBe(true);
  });

  it('and no verb writes a line to the error stream without a renderer', () => {
    // The half the two cases above cannot see, and the one the widened rule needs: a
    // verb does not have to REBUILD a shape or REUSE a sentence to leave a no
    // unpainted — it can word its own and hand it to `io.err` as a string. Eighteen
    // did, and every case in this file was green while they did it, because a plain
    // string on stderr breaks nothing: it exits non-zero, it says the right thing,
    // and it is the one line in the report a colour never reaches.
    //
    // Counted per SITE and not per file, so a module with one rendered call and one
    // raw one is still accused.
    const sites = (source: string): number => source.split('io.err(').length - 1;
    const rendered = (source: string): number =>
      source.match(/io\.err\(\s*(?:to\.)?render\(/g)?.length ?? 0;
    const guilty = shipped().filter((file) => sites(sourceOf(file)) !== rendered(sourceOf(file)));
    // ONE module writes to stderr without rendering, and it is not reporting a no:
    // `mcp` serves JSON-RPC on stdout, so the server's diagnostics go to the other
    // stream. A log line is not a refusal and painting it would say it was.
    expect(guilty).toEqual(['mcp.ts']);
    // The detector accuses the line a verb would actually write, and recognizes both
    // spellings of the rendered one. The relapse is assembled rather than typed, for
    // the reason the case below states: the lint refuses a template placeholder inside
    // a plain string, and this repository opens no exception to a rule for a test.
    const relapse = `io.err(\`No task $${'{'}id} here.\`);`;
    expect(sites(relapse)).toBe(1);
    expect(rendered(relapse)).toBe(0);
    expect(rendered('to.io.err(to.render(line));')).toBe(1);
    expect(rendered('io.err(\n  render(\n    fact(x),\n  ),\n);')).toBe(1);
    // And it read a surface that really writes. FEW modules reach the stream directly
    // now — that is the funnel working, not the scan missing — so the floor is over
    // the SITES, and a rewrite that emptied the corpus would fall through it.
    const total = shipped().reduce((count, file) => count + sites(sourceOf(file)), 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it('decides the severity in one place, and names the only other one', () => {
    // What makes "every no is red" one edit rather than a habit: the hue is a
    // consequence of `'bad'`, and `'bad'` is written where the shape is. A verb that
    // reached for it directly would be deciding its own severity, which is how a
    // surface ends up with two reds that mean different things.
    const deciding = shipped().filter((file) => sourceOf(file).includes("'bad'"));
    // `guard.ts` is the second, and it is a VERDICT rather than a refusal: the gate
    // ruled, the answer is REFUSED, and the word is what carries the news. It is
    // named here rather than folded into the funnel because folding it would make an
    // answer look like a failure to answer.
    expect(deciding).toEqual(['guard.ts', 'report.ts']);
    // And the funnel is where the parser's no gets it too — never at the call site.
    expect(sourceOf('usage.ts')).not.toContain("'bad'");
    expect(sourceOf('usage.ts')).toContain('refusalSentence(');
  });

  it('would accuse a verb that worded one itself', () => {
    // The other vacuous form: a detector whose term matches nothing any more. Composed
    // against the line the careful author would write — the one this guard actually
    // caught, which re-typed a sentence rather than inventing a new one.
    // The hole is assembled rather than typed because the lint refuses a template
    // placeholder inside a plain string, and this repository opens no exception to a
    // rule for the convenience of a test.
    const hole = `$${'{'}`;
    const relapse = `io.err(\`Refused (${hole}result.code}): ${hole}result.message}\`);`;
    expect(relapse.includes(WORDS_A_REFUSAL)).toBe(true);
    expect(shipped().length).toBeGreaterThan(20);
    expect(shipped()).toContain('report.ts');
  });
});

describe('every verb that can refuse routes through that one place', () => {
  /** The wiring modules that call the funnel — the verbs that CAN refuse. */
  const refusing = (): readonly string[] =>
    shipped().filter((file) => file !== 'report.ts' && sourceOf(file).includes('reportRefusal('));

  it('is most of the surface, counted from the source rather than listed here', () => {
    // The number is the argument for putting the colour in the funnel: one edit, this
    // many verbs. It is a floor rather than an equality, because a verb ADDED to the
    // surface should not turn this case red — the case below is the one that has to.
    const files = refusing();
    expect(files.length).toBeGreaterThanOrEqual(20);
    const sites = files.reduce(
      (total, file) => total + (sourceOf(file).split('reportRefusal(').length - 1),
      0,
    );
    expect(sites).toBeGreaterThanOrEqual(25);
  });

  it('names a command the program declares, for every one of them', () => {
    // What connects the scan to the surface: each of those modules is a verb, and the
    // file name IS the verb. A module that refuses and hangs itself on nothing would be
    // a refusal no caller can reach, and a verb renamed away from its file would leave
    // the scan enumerating a name the program does not answer to.
    const { program } = buildProgram({ out: () => {}, err: () => {}, fail: () => {} });
    const declared = new Set(program.commands.map((command) => command.name()));
    const orphaned = refusing()
      .map((file) => file.replace(/\.ts$/, ''))
      .filter((verb) => !declared.has(verb));
    expect(orphaned).toEqual([]);
    expect(declared.size).toBeGreaterThan(20);
  });
});

describe('and what it refuses comes out red, with the words still on the line', () => {
  let sandbox: string;
  let taskId: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  let lines: string[] = [];
  const io: CliIo = {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {},
  };

  /** Everything one invocation wrote, on either stream, as one string. */
  async function invoke(...argv: string[]): Promise<string> {
    lines = [];
    await run(argv, io);
    return lines.join(String.fromCharCode(10));
  }

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-refusal-'));
    const repo = join(sandbox, 'project');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.chdir(repo);
    await invoke('init');
    const created = await invoke('task', 'Write the deploy runbook');
    const id = /\(([^)]+)\)/.exec(created)?.[1];
    if (id === undefined) throw new Error(`fixture: no task id in ${created}`);
    taskId = id;
  }, 60_000);

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  /**
   * The ways this surface says no, one per producer and one per shape — and, since
   * the rule widened, one per ORIGIN as well.
   *
   * The gate's typed refusal and the run pin's are the `Refused (CODE)` shape from two
   * different producers; the unknown record and the bad direction are the WORDED shape,
   * the second of them from the verb this file's guard caught writing its own. The last
   * two are the ones the old rule left out on purpose: a value the SURFACE turns down
   * before any tree is opened, and a command line the PARSER turns down before the
   * surface sees it. All six are the same news.
   */
  const ways = (): readonly (readonly [string, readonly string[], string])[] => [
    ['the gate', ['task', 'move', 'complete', taskId], 'Refused (ILLEGAL_TRANSITION)'],
    ['an unknown record', ['show', 'nope'], 'No record nope here.'],
    ['a bad direction', ['refs', taskId, '--direction', 'sideways'], 'Not a direction: sideways'],
    ['a bad scope', ['task', 'nothing born', '--scope', 'elsewhere'], 'Invalid --scope'],
    ['a missing argument', ['decision', 'a title'], 'mnema decision needs <rationale>'],
    ['a word that names no verb', ['nope'], 'mnema has no command "nope".'],
  ];

  it('paints every one of them, and says the same thing with the paint off', async () => {
    for (const [what, argv, said] of ways()) {
      const plain = await invoke('--color=never', ...argv);
      const styled = await invoke('--color=always', ...argv);
      // Red is there.
      expect(styled, what).toContain(RED);
      expect(styled, what).toContain(DEFAULT_HUE);
      // And it is only a second copy of what the words already said: the plain line
      // carries the whole answer, and the painted one carries the same words.
      expect(plain, what).toContain(said);
      expect(styled, what).toContain(said);
      expect(plain, what).not.toContain('\u001b');
    }
  });

  it("paints the pin's refusal too, which no verb reports", async () => {
    // The producer that is not a verb: the session a write is pinned to is proven at
    // the transport, once, before any tree is opened — and its refusal is the same
    // shape and the same colour as the gate's.
    process.env.MNEMA_RUN = 'nope';
    const styled = await invoke('--color=always', 'memory', 'x');
    delete process.env.MNEMA_RUN;
    expect(styled).toContain(RED);
    expect(styled).toContain('Refused (UNKNOWN_RUN)');
  });

  it('says ALLOWED and REFUSED apart in words, not only in green and red', async () => {
    // The verdict is the one reading with two outcomes, so it is where losing the
    // colour would cost the most. Asked both ways, with the paint off: the two answers
    // are different lines, and each names itself.
    const allowed = await invoke('--color=never', 'guard', 'submit', taskId, '--actor', actor());
    const refused = await invoke('--color=never', 'guard', 'complete', taskId, '--actor', actor());
    expect(allowed).not.toBe(refused);
    expect(allowed).toContain('ALLOWED');
    expect(refused).toContain('REFUSED');
    // And with the paint on, the same two words are still there — the hue was added,
    // nothing was taken away.
    const painted = await invoke('--color=always', 'guard', 'submit', taskId, '--actor', actor());
    expect(painted).toContain('ALLOWED');
    expect(painted).toContain('\u001b[32m');
  });

  /** This machine's identity, as the record writes it. */
  let who = '';
  const actor = (): string => who;
  beforeAll(async () => {
    const account = await invoke('accountability', '--json');
    const found = /"who": "(mnid:[0-9a-z]+)"/.exec(account)?.[1];
    if (found === undefined) throw new Error(`fixture: no identity in ${account}`);
    who = found;
  }, 60_000);
});

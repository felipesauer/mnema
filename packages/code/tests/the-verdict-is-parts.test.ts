/**
 * `mnema verify` PAINTS its verdict now, and it still says exactly what the chain said.
 *
 * The verdict is the product's most important reading and it was the one reading whose
 * answer had no colour. The reason was not the chain: it was a STRING. The verdict
 * arrived as one pre-joined sentence with the word `verified` or `FAILED` in the middle
 * of it, so painting the answer would have meant matching text on a verdict — reading
 * the ruling out of a rendering of itself, and breaking the day a level was reworded.
 * The chain hands over the CLAUSES now, and the surface lays them out.
 *
 * WHICH MAKES THE DANGER THE OPPOSITE ONE. A surface that composes is a surface that
 * could compose something else: a clause of its own beside the chain's, a clause
 * dropped in the laying out, a guarantee quietly upgraded from "local integrity" to
 * "verified". So the assertion that carries this file is BYTES, and it is asserted
 * against a source the surface cannot influence — the chain's own `summary`, which is
 * the same clauses joined:
 *
 *     the unpainted line  ==  `<tree>: ` + the chain's summary
 *
 * A clause invented, a clause lost, a word changed, a separator moved: every one of
 * them moves those bytes. And the same comparison is what says `--color=never` is
 * unchanged from before any of this, because that string is what the surface printed
 * before it could paint at all.
 *
 * THE OTHER HALF IS THAT IT REALLY PAINTS, and that the hue lands where it belongs.
 * Three hues appear across these fixtures, the level's clause is the only part of the
 * line wearing one, and the LABEL — a tree's name — wears none: a red `private` would
 * say the tree was bad news rather than the verdict over it.
 *
 * Every fixture is built by the PRODUCT — `mnema init`, `mnema task` — and then edited
 * on disk the way an adversary would. Nothing writes an event by hand. The exit codes
 * and `--require` are not re-asserted here: `the-verdict-tells-the-truth.test.ts` and
 * `the-verdict-says-what-it-covered.test.ts` are the net under those, and this delivery
 * changed the verdict's TYPE, not one rule of what it decides.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listTails,
  meetsRequirement,
  orderedSegments,
  type ProvenLevel,
  requiredLevel,
} from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import {
  runVerify,
  type TreeReport,
  type TreeVerdict,
  type VerifyDone,
} from '../src/commands/verify.js';
import { SEVERITIES, type Severity } from '../src/presentation/line.js';
import { renderStyled } from '../src/presentation/styled.js';
import { clauseStatement } from '../src/presentation/verdict.js';
import { levelSeverity } from '../src/wiring/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The byte every escape below opens with. */
const ESC = '\u001b';

/** The escapes the styled renderer writes, as the reader of a terminal receives them. */
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const NORMAL = `${ESC}[22m`;
const DEFAULT_HUE = `${ESC}[39m`;

/**
 * The sequences this renderer writes, and only those — assembled from a constant, never
 * written as a literal, because a regular expression holding a control character is a
 * byte a reader of this file cannot see, and the lint refuses it for that reason.
 */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22|31|32|33|39)m`, 'g');

/**
 * What each severity looks like on the wire.
 *
 * Total over {@link SEVERITIES} by ASSERTION and not by type, because a type annotation
 * in a test file is not checked by anything here: a fourth severity has to fail this
 * file loudly rather than be silently absent from a table it was never added to.
 */
const HUE: Record<string, string> = {
  good: `${ESC}[32m`,
  warn: `${ESC}[33m`,
  bad: `${ESC}[31m`,
};

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;
let originalNoColor: string | undefined;
let originalForceColor: string | undefined;

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

/** Every line one `mnema verify [args]` invocation wrote on stdout, in order. */
async function verifyLines(...args: readonly string[]): Promise<string[]> {
  const c = capture();
  await run(['verify', ...args], c.io);
  return c.out;
}

/** The discovery environment the sandbox resolves trees in. */
function env(): { xdgDataHome: string; home: string } {
  return { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
}

/** Every tree the command reported on — a verdict, or the note that a tree holds nothing. */
function reports(): readonly TreeReport[] {
  const done = runVerify({ cwd: repo, env: env(), requirement: 'chained', global: false });
  if (!done.ok) throw new Error('fixture: no project in the sandbox');
  return (done as VerifyDone).trees;
}

/** What the CHAIN said, per tree — the source the printed lines are compared against. */
function verdicts(): readonly TreeVerdict[] {
  return reports().filter((tree): tree is TreeVerdict => tree.kind === 'verdict');
}

/** The public tree of the project in the sandbox. */
function chainRoot(): string {
  return resolveTrees(repo, env()).projectPublic as string;
}

/** The one tail's only segment file, and the checkpoints beside it. */
function storedFiles(): { segment: string; checkpoints: string } {
  const root = chainRoot();
  const tail = listTails({ root })[0] as string;
  const segment = orderedSegments({ root }, tail)[0] as string;
  return { segment, checkpoints: join(dirname(segment), 'checkpoints.jsonl') };
}

/** The stored lines of a file, without the empty tail element. */
function lines(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean);
}

/** Founds a project and records `count` tasks through the CLI — each one signed. */
async function record(count: number): Promise<void> {
  await run(['init'], capture().io);
  for (let i = 0; i < count; i += 1) {
    const c = capture();
    await run(['task', `task number ${i}`], c.io);
    if (c.failed()) throw new Error(`setup: task ${i} failed: ${c.err.join(' / ')}`);
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-parts-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  originalNoColor = process.env.NO_COLOR;
  originalForceColor = process.env.FORCE_COLOR;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  // The two conventional variables are cleared for the reason the golden clears them:
  // what is asserted is what the FLAG resolves to, and a developer's shell holding one
  // of them would answer the question before the flag did.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  for (const [name, value] of [
    ['XDG_DATA_HOME', originalXdg],
    ['HOME', originalHome],
    ['NO_COLOR', originalNoColor],
    ['FORCE_COLOR', originalForceColor],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * The records that reach a level, each made the way an adversary or a clock makes one.
 *
 * They are named by what was DONE to the record and never by the level it lands on: the
 * level is read back from the chain in every case, so a fixture that stopped reaching
 * the state it was written for cannot quietly assert the wrong thing.
 */
const RECORDS: readonly (readonly [string, () => Promise<void>])[] = [
  [
    'every event signed',
    async () => {
      await record(3);
    },
  ],
  [
    'the signatures deleted',
    async () => {
      await record(3);
      writeFileSync(storedFiles().checkpoints, '', 'utf-8');
    },
  ],
  [
    'the last checkpoint dropped',
    async () => {
      await record(3);
      const { checkpoints } = storedFiles();
      const stored = lines(checkpoints);
      if (stored.length < 2) throw new Error('fixture: only one checkpoint to drop');
      writeFileSync(checkpoints, `${stored.slice(0, -1).join('\n')}\n`, 'utf-8');
    },
  ],
  [
    'the tail truncated under its signatures',
    async () => {
      await record(3);
      const { segment } = storedFiles();
      writeFileSync(segment, `${lines(segment).slice(0, -2).join('\n')}\n`, 'utf-8');
    },
  ],
  [
    'a line that will not parse',
    async () => {
      await record(3);
      const { segment } = storedFiles();
      const stored = lines(segment);
      stored[1] = '{garbage not json';
      writeFileSync(segment, `${stored.join('\n')}\n`, 'utf-8');
    },
  ],
];

describe('the surface says exactly what the chain said', () => {
  for (const [what, build] of RECORDS) {
    it(`prints the label, a colon and the chain's own summary — ${what}`, async () => {
      await build();
      const printed = await verifyLines('--color=never');
      const said = verdicts();
      expect(said.length).toBeGreaterThan(0);
      for (const tree of said) {
        const line = printed.find((candidate) => candidate.startsWith(`${tree.scope}: `));
        // BYTES. A clause composed here, a clause lost in the laying out, a separator
        // moved, a word softened: each of them breaks this and nothing else has to.
        expect(line, `${what} / ${tree.scope}`).toBe(`${tree.scope}: ${tree.result.summary}`);
      }
      // And there is no line the command did not account for: one per tree it reported
      // on — a verdict, or the note that a tree holds nothing — so a sentence ADDED
      // beside them is caught too. There are more reports than verdicts here: a sandbox
      // that never wrote privately has a private tree with nothing to rule on, and that
      // note is not a verdict and is deliberately not composed of clauses.
      const scoped = printed.filter((line) => /^(public|private|global): /.test(line));
      expect(scoped).toHaveLength(reports().length);
      expect(reports().length).toBeGreaterThan(said.length);
    });

    it(`carries every clause the chain worded, and only those — ${what}`, async () => {
      await build();
      await verifyLines('--color=never');
      for (const tree of verdicts()) {
        // The other direction of the same promise, read from the clauses rather than
        // from the joined sentence: the summary IS the clauses, so a decomposition that
        // dropped one is visible in every reader that prints the sentence.
        expect(tree.result.summary, `${what} / ${tree.scope}`).toBe(
          tree.result.clauses.map((clause) => clause.text).join('; '),
        );
        // Exactly one clause is the answer. Two would be two hues on one line; none
        // would be a verdict with nothing to paint.
        expect(tree.result.clauses.filter((clause) => clause.of === 'level')).toHaveLength(1);
      }
    });
  }
});

describe('and it paints the clause that is the answer, and nothing else', () => {
  /** Every hue seen through the CLI across the fixtures — the non-vacuity of the set. */
  const seen = new Set<Severity>();

  for (const [what, build] of RECORDS) {
    it(`wears the level's hue and leaves the tree's name unpainted — ${what}`, async () => {
      await build();
      const painted = await verifyLines('--color=always');
      const plain = await verifyLines('--color=never');
      for (const tree of verdicts()) {
        const news = levelSeverity(tree.result.level);
        seen.add(news);
        const line = painted.find((candidate) =>
          candidate.startsWith(`${BOLD}${tree.scope}${NORMAL}: `),
        );
        // THE LABEL IS BOLD AND UNHUED. It is a tree's name: painting it would say the
        // tree was the bad news rather than the verdict over it, and it is the reason
        // this reading could not paint before the clauses existed.
        expect(line, `${what} / ${tree.scope}`).toBeDefined();
        const level = tree.result.clauses.find((clause) => clause.of === 'level');
        expect(level).toBeDefined();
        // The level's clause wears its hue, dimmed like every clause beside it, and
        // closed by the closer for a hue and the one for a weight.
        expect(line, `${what} / ${tree.scope}`).toContain(
          `${DIM}${HUE[news] as string}${level?.text}${DEFAULT_HUE}${NORMAL}`,
        );
        // ONE hue on the line, and it is that one: a second would be a surface judging
        // a qualification, which is how five hues in a row become no hue at all.
        expect((line as string).split(DEFAULT_HUE)).toHaveLength(2);
        for (const [name, hue] of Object.entries(HUE)) {
          if (name === news) continue;
          expect(line, `${what} / ${tree.scope} wears ${name}`).not.toContain(hue);
        }
      }
      // The words are the same words: this is the whole-surface promise, asserted here
      // on the one reading that gained a hue in this delivery.
      expect(painted.map((line) => line.replace(SGR, ''))).toEqual(plain);
    });
  }

  it('showed every hue there is across those records', async () => {
    // The vacuous form of the block above is a fixture set that only ever reaches one
    // level: every case would pass while two of the three hues had never been printed.
    // It runs last, on what the cases above observed.
    expect([...seen].sort()).toEqual([...SEVERITIES].sort());
  });
});

describe('every level the chain declares reads as news, and the table is total', () => {
  /**
   * The levels, read from the chain's own tuple.
   *
   * `PROVEN_LEVELS` is not on the chain's public surface and is not put there for this:
   * an exported value with no production caller is the shape the workspace's own guard
   * exists to accuse, and the table below is total over the union BY TYPE in production,
   * so nothing in the product needs the tuple at run time. What this file needs is the
   * enumeration, and the declaration is where it comes from — never a list kept here,
   * which is exactly what would go stale the day a rung is added.
   */
  function levelsTheChainDeclares(): readonly ProvenLevel[] {
    const source = readFileSync(
      join(HERE, '..', '..', 'chain', 'src', 'chain', 'level.ts'),
      'utf-8',
    );
    const tuple = /export const PROVEN_LEVELS = \[([^\]]*)\] as const;/.exec(source)?.[1];
    if (tuple === undefined) throw new Error('no PROVEN_LEVELS tuple in the chain source');
    const found = [...tuple.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] as ProvenLevel);
    if (found.length < 6) throw new Error(`only ${found.length} levels read from the tuple`);
    return found;
  }

  it('gives each of them the severity its own rank asks for', () => {
    // The expectation is DERIVED from the chain, never restated: `bad` is exactly what
    // fails the minimum a bare `verify` declares, `warn` is exactly the level that
    // minimum asks for — the rung where the hash chain held and nothing was signed — and
    // `good` is everything above it. So a rung inserted tomorrow gets an answer from the
    // chain's own order rather than from a list somebody forgot to extend.
    const floor = requiredLevel('chained');
    for (const level of levelsTheChainDeclares()) {
      const expected: Severity = !meetsRequirement(level, 'chained')
        ? 'bad'
        : level === floor
          ? 'warn'
          : 'good';
      expect(levelSeverity(level), level).toBe(expected);
    }
  });

  it('paints each of them, byte for byte, with the label left alone', () => {
    // All six, including the rung nothing can reach yet: no witness exists, so
    // `externally-witnessed` cannot be produced by any record on any disk, and a table
    // that only ever answered for the five reachable ones would be a table with an
    // unpainted entry nobody would find. The text is the level's name rather than its
    // sentence — the wording is the chain's business and `levelHeadline` never leaves it;
    // what is asserted here is the wrapping.
    for (const level of levelsTheChainDeclares()) {
      const news = levelSeverity(level);
      const line = clauseStatement('public', [{ text: level, severity: news }]);
      expect(renderStyled(line), level).toBe(
        `${BOLD}public${NORMAL}: ${DIM}${HUE[news] as string}${level}${DEFAULT_HUE}${NORMAL}`,
      );
    }
  });

  it('knows a hue for every severity there is', () => {
    // The table above is this file's, so it can rot: a fourth severity would leave the
    // per-level cases comparing against `undefined` and reading as an absence of paint.
    expect(Object.keys(HUE).sort()).toEqual([...SEVERITIES].sort());
  });
});

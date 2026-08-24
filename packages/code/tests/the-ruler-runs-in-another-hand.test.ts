/**
 * THE RULER RUNS IN ANOTHER HAND.
 *
 * `measurements/p1/` publishes numbers about this product and a pre-registration that fixes
 * what was promised before those numbers existed. Until this file was written it did not
 * publish the INSTRUMENT: the protocol's §"What a cell holds fixed" asserted an isolation, and
 * the code that implements it lived on a workbench git ignores. A published number whose
 * instrument is unpublished is our word about how it was obtained — the same shape as a format
 * whose "tamper-evident" claim is made only by the people who designed the attacks against it.
 *
 * The runner is at `measurements/p1/harness/` now, and this file is the link. It holds three
 * claims, each with the mutation that reddens it named beside it:
 *
 *   1. EVERY FLAG THE DOCUMENT NAMES IS IN THE ARGUMENT VECTOR THE CODE BUILDS. Drop
 *      `--strict-mcp-config` from `claudeArgv` and the document goes on asserting it; that is a
 *      failing test here rather than a paragraph nobody re-read.
 *   2. EVERY FLAG THE CODE PASSES IS DECLARED SOMEWHERE. The other direction, and the one that
 *      matters more: the protocol's whole §"What a cell holds fixed" exists because a published
 *      benchmark elsewhere was nearly invalidated by a baseline that ran the treatment in secret.
 *      An undeclared flag is that defect. Add one to `claudeArgv` and this goes red.
 *   3. THE ENVIRONMENT IS AN ALLOWLIST. The document's words are "never a denylist, because an
 *      allowlist is not defeated by a variable that does not exist yet". Asserted with a
 *      sentinel in `process.env` that must not come out the other side, so a spread of the
 *      parent environment is red without anybody maintaining a list of legal keys.
 *
 * AND A FOURTH THAT IS ABOUT PUBLISHING RATHER THAN ABOUT THE PROTOCOL: the runner imports
 * nothing outside `node:`. That is what makes it runnable by somebody who has our repository and
 * none of our machine, and it is a property that a single `import` deletes, so it is a guard and
 * not a habit.
 *
 * WHAT THIS DOES NOT COVER, said out loud. The tasks are held out, so nothing here runs a cell
 * or reads a task; and this file cannot check that the document's PROSE items — a fresh record
 * per cell, a clean tree asserted before the agent runs — do what they say. Those are the
 * runner's own suite's job (`measurements/p1/harness/tests/`), which needs the tasks and
 * therefore cannot run in CI. What this file covers is the part that can be checked from the
 * committed tree alone: the flags, the environment, and the absence of dependencies.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The published instrument. */
const HARNESS = join(ROOT, 'measurements/p1/harness');
/** The pre-registration whose prose the instrument answers for. */
const PROTOCOL = readFileSync(join(ROOT, 'measurements/p1/protocol.md'), 'utf-8');

type Isolation = {
  readonly MODEL: string;
  readonly PERMISSION_MODE: string;
  readonly APPEND_SYSTEM_PROMPT: string;
  readonly ISOLATION_CHECKLIST: readonly (readonly [string, string])[];
  readonly claudeArgv: (opts: {
    ticket: string;
    settingsPath: string;
    mcpPath: string;
    maxBudgetUsd?: number | null;
  }) => readonly string[];
};

type Sandbox = {
  readonly sandboxEnv: (
    sandbox: Record<string, string>,
    extra?: Record<string, string>,
  ) => Record<string, string>;
};

const isolation: Isolation = await import(join(HARNESS, 'lib/isolation.mjs'));
const sandbox: Sandbox = await import(join(HARNESS, 'lib/sandbox.mjs'));

/** The vector a cell actually runs with. The paths are a cell's; nothing here touches disk. */
const ARGV = isolation.claudeArgv({
  ticket: 'the frozen ticket of some task',
  settingsPath: '/nowhere/cell/settings.json',
  mcpPath: '/nowhere/cell/mcp.json',
});

/**
 * THE SECTION OF THE DOCUMENT THAT IS ABOUT A CELL, and only its BULLET LIST.
 *
 * The reading rule is written here because it decides what the test means. The section opens
 * with a paragraph about a flag FUTURE rounds are to capture (`--output-format stream-json`),
 * which is a rule for rounds that happen and not a claim about the cells that ran — read as a
 * claim it would demand a flag the code correctly does not pass. The bullets are the claims
 * about a cell, so the bullets are what the code answers for. Continuation lines are indented,
 * and an unindented line ends the list.
 */
function bulletsOfTheCellSection(): string {
  const from = PROTOCOL.indexOf('\n## What a cell holds fixed\n');
  expect(from, 'the protocol has no §"What a cell holds fixed"').toBeGreaterThan(-1);
  const rest = PROTOCOL.slice(from + 1);
  const to = rest.indexOf('\n## ', 1);
  const section = to === -1 ? rest : rest.slice(0, to);

  const kept: string[] = [];
  let inBullet = false;
  for (const line of section.split('\n')) {
    if (line.startsWith('- ')) inBullet = true;
    else if (line.trim() !== '' && !/^\s/.test(line)) inBullet = false;
    if (inBullet) kept.push(line);
  }
  return kept.join('\n');
}

/** Every backticked thing in that list that starts with `--`, e.g. `--model claude-…`. */
function declarationsInTheDocument(): readonly string[] {
  const found = [...bulletsOfTheCellSection().matchAll(/`(--[^`]+)`/g)].map((m) => m[1].trim());
  return [...new Set(found)];
}

/** Every `--flag` named anywhere in the runner's own printed checklist. */
function flagsInTheChecklist(): readonly string[] {
  const text = isolation.ISOLATION_CHECKLIST.map(([what]) => what).join('\n');
  return [...new Set([...text.matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]))];
}

/** Every `--flag` the vector carries. */
function flagsInTheVector(): readonly string[] {
  return [...new Set(ARGV.filter((a) => a.startsWith('--')))];
}

/** Whether `tokens` appear in `argv` in that order, next to each other. */
function contiguously(argv: readonly string[], tokens: readonly string[]): boolean {
  for (let i = 0; i + tokens.length <= argv.length; i += 1) {
    if (tokens.every((token, k) => argv[i + k] === token)) return true;
  }
  return false;
}

describe('the document and the instrument answer for each other', () => {
  it('names at least three flags in its cell section, or this file is measuring nothing', () => {
    // THE INSTRUMENT SAYS WHEN IT BROKE. If the heading is renamed or the bullets are rewritten
    // into prose, the extraction above quietly finds nothing and every case below passes over an
    // empty set — the vacuous ruler this bench has been burned by twice. One flag is named as a
    // literal so the failure is "the section stopped naming the flags" and not silence.
    const declared = declarationsInTheDocument();
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect(declared).toContain('--strict-mcp-config');
  });

  it('and every one of them is in the vector a cell runs with', () => {
    for (const declaration of declarationsInTheDocument()) {
      const tokens = declaration.split(/\s+/);
      expect(
        contiguously(ARGV, tokens),
        `the protocol asserts \`${declaration}\` and claudeArgv does not pass it: ${ARGV.join(' ')}`,
      ).toBe(true);
    }
  });

  it('and the model and the permission mode are the ones the document names', () => {
    // The two flags whose VALUE is the claim. A model swapped under a document that still names
    // the old one publishes a rate about a different model.
    expect(contiguously(ARGV, ['--model', isolation.MODEL])).toBe(true);
    expect(PROTOCOL).toContain(`\`--model ${isolation.MODEL}\``);
    expect(contiguously(ARGV, ['--permission-mode', isolation.PERMISSION_MODE])).toBe(true);
  });

  it('and the shared system prompt says how to work and never what to consult', () => {
    // THE ONE PROSE BULLET THIS FILE CAN ACTUALLY CHECK, and the one worth checking most. The
    // appended prompt is identical in every arm, so a sentence in it about records, memory or
    // decisions would nudge one arm's mechanism and become a second variable between arms — and
    // it would do it invisibly, because the flag would still be identical everywhere.
    expect(contiguously(ARGV, ['--append-system-prompt', isolation.APPEND_SYSTEM_PROMPT])).toBe(
      true,
    );
    expect(PROTOCOL).toContain('it says how to work, never what to consult');
    for (const nudge of ['memor', 'record', 'decision', 'mnema', 'consult']) {
      expect(
        isolation.APPEND_SYSTEM_PROMPT.toLowerCase().includes(nudge),
        `the prompt every arm shares mentions "${nudge}": ${isolation.APPEND_SYSTEM_PROMPT}`,
      ).toBe(false);
    }
    // Not vacuous: it is a real instruction and not an empty string.
    expect(isolation.APPEND_SYSTEM_PROMPT.length).toBeGreaterThan(80);
  });

  it('and every flag the code passes is declared, by the document or by the checklist', () => {
    // The direction that catches the treatment arriving in secret. `-p` is deliberately not in
    // scope: it is the ticket, which is the one argument that differs from cell to cell by
    // design, and every flag is what a cell holds FIXED.
    const declared = new Set([
      ...declarationsInTheDocument().map((d) => d.split(/\s+/)[0]),
      ...flagsInTheChecklist(),
    ]);
    for (const flag of flagsInTheVector()) {
      expect(declared.has(flag), `claudeArgv passes ${flag} and nothing declares it`).toBe(true);
    }
  });

  it('and the one flag that is conditional is declared too', () => {
    // `--max-budget-usd` is pushed only when a ceiling is given, so the vector above does not
    // carry it and the case before this one cannot see it.
    const withCeiling = isolation.claudeArgv({
      ticket: 't',
      settingsPath: '/nowhere/s.json',
      mcpPath: '/nowhere/m.json',
      maxBudgetUsd: 1.5,
    });
    expect(contiguously(withCeiling, ['--max-budget-usd', '1.5'])).toBe(true);
    expect(flagsInTheChecklist()).toContain('--max-budget-usd');
  });
});

describe('the environment of a cell is an allowlist', () => {
  /** A sandbox's paths, without making one: nothing here writes. */
  const CELL = {
    home: '/nowhere/cell/home',
    tmp: '/nowhere/cell/tmp',
    xdg: '/nowhere/cell/xdg',
    config: '/nowhere/cell/config',
    cache: '/nowhere/cell/cache',
  };

  it('lets nothing through from the environment it was launched in', () => {
    // A SENTINEL rather than a list of legal keys. A list would be a second declaration to
    // maintain, and it would go green the day somebody added a legitimate variable to both.
    // The sentinel cannot be legitimate, so a spread of `process.env` is the only way it
    // arrives — which is exactly the mutation this case exists for.
    const name = 'MNEMA_BENCH_A_VARIABLE_NO_CELL_MAY_SEE';
    process.env[name] = 'if this reaches a cell, the allowlist is a denylist';
    try {
      const env = sandbox.sandboxEnv(CELL);
      expect(Object.keys(env)).not.toContain(name);
      // And NOT vacuous: the one pass-through the document allows is there, so an empty
      // object would not pass this case.
      expect(env.PATH).toBe(process.env.PATH ?? '');
    } finally {
      delete process.env[name];
    }
  });

  it('pins the timezone and the three directories the document names', () => {
    const env = sandbox.sandboxEnv(CELL);
    expect(env.TZ).toBe('UTC');
    expect(env.HOME).toBe(CELL.home);
    expect(env.TMPDIR).toBe(CELL.tmp);
    expect(env.XDG_DATA_HOME).toBe(CELL.xdg);
    // The document's own words, so a rewrite of the bullet is visible here.
    expect(PROTOCOL).toContain('the environment is an **allowlist**');
    expect(PROTOCOL).toContain('`TZ=UTC` pinned');
  });
});

/** Every `.mjs` of the published instrument, found rather than listed. */
function everyModule(dir: string = HARNESS): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const where = join(dir, name);
    if (statSync(where).isDirectory()) return everyModule(where);
    return name.endsWith('.mjs') ? [where] : [];
  });
}

/**
 * Every module specifier of one file.
 *
 * MATCHED AT THE IMPORT, not at the word `from`: a multi-line `import { … }` puts its `from` on
 * a line that does not start with `import`, so a pattern anchored to the statement's first line
 * misses it — and a guard that misses an import is a guard that clears a dependency. All four
 * shapes are read, including the two that would arrive at runtime.
 */
function specifiersIn(text: string): readonly string[] {
  const found = [
    // `\s+` AND NOT `\s*`, which is a defect this scanner had and a case below holds it to.
    // `from` followed immediately by a quote is prose, not an import: the test name *"and a
    // capture it cannot read is refused rather than resumed from"* ends in that word, so
    // `from', () => {` matched and the scanner reported the whole of the next two lines as an
    // import specifier — accusing a file whose imports are all `node:`. An import written
    // `from'x'` is legal JavaScript and is the false negative this accepts; it cannot survive
    // this tree's own formatter, which is what makes the trade a safe one HERE and not a rule
    // about scanners in general.
    ...[...text.matchAll(/\bfrom\s+'([^']+)'/g)],
    ...[...text.matchAll(/^\s*import\s*'([^']+)'/gm)],
    ...[...text.matchAll(/\bimport\(\s*'([^']+)'/g)],
    ...[...text.matchAll(/\brequire\(\s*'([^']+)'/g)],
  ].map((m) => m[1]);
  return found;
}

describe('the instrument runs in a hand that has none of this machine', () => {
  const MODULES = everyModule();

  it('is the whole runner, so this is not a walk over three files', () => {
    // The floor is a literal, and it is BELOW what is there: it exists to catch a walk that
    // silently found nothing, not to freeze a file count that is free to grow.
    expect(MODULES.length).toBeGreaterThanOrEqual(30);
  });

  it('reads a real specifier and does not read prose that ends in the word from', () => {
    // THE TEETH OF THE SCANNER ITSELF. Over the real files the case below only ever says
    // "nothing is accused", so it has never shown it can tell an import from a sentence. It
    // could not: `\s*` made `resumed from', () => {` a specifier, and the accusation named a
    // file whose every import is `node:`. An instrument that accuses is as bad as one that
    // cannot say it broke, and a new form of either needs its own case.
    expect(specifiersIn("import { join } from 'node:path'")).toEqual(['node:path']);
    expect(specifiersIn("} from '../lib/split.mjs'")).toEqual(['../lib/split.mjs']);
    expect(specifiersIn("const m = await import('./run.mjs')")).toEqual(['./run.mjs']);
    expect(specifiersIn("const p = require('node:path')")).toEqual(['node:path']);
    expect(specifiersIn("import 'node:assert'")).toEqual(['node:assert']);
    // And the prose, which is what this file's own tree contains:
    expect(
      specifiersIn("test('a capture it cannot read is refused rather than resumed from', () => {"),
    ).toEqual([]);
    expect(specifiersIn("// where the tasks come from', and the answer")).toEqual([]);
  });

  it('imports nothing outside node: and its own tree', () => {
    let counted = 0;
    for (const where of MODULES) {
      for (const specifier of specifiersIn(readFileSync(where, 'utf-8'))) {
        counted += 1;
        expect(
          specifier.startsWith('node:') ||
            specifier.startsWith('./') ||
            specifier.startsWith('../'),
          `${relative(ROOT, where)} imports ${specifier}, which is neither node: nor relative`,
        ).toBe(true);
      }
    }
    // Two values, so the loop above cannot be green because it never ran. The floor is well
    // under the real count for the same reason as the one above.
    expect(counted).toBeGreaterThanOrEqual(150);
  });

  it('and carries no path off this machine', () => {
    // A published instrument with somebody's home directory in it is one a stranger cannot run
    // and, worse, one whose results nobody can place. Every path the runner needs is either
    // found by marker (`findWorkspaceRoot`), given by the environment (`tasksRoot`), or made
    // fresh (`mkdtemp`).
    for (const where of MODULES) {
      const text = readFileSync(where, 'utf-8');
      // ONE escaped backslash for the Windows shape, not two: `/[A-Z]:\\\\/` reads as a letter, a
      // colon and TWO literal backslashes, which no path has — a pattern that looks like coverage
      // and matches nothing.
      for (const shape of [/\/home\/[a-z]/i, /\/Users\/[A-Za-z]/, /[A-Z]:\\/]) {
        expect(shape.test(text), `${relative(ROOT, where)} carries an absolute path`).toBe(false);
      }
    }
  });
});

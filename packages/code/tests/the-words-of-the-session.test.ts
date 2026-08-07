/**
 * THE WORDS A SESSION ANSWERS TO ITSELF — one source, one spelling, and no site that
 * types them.
 *
 * A session runs the verbs of this product and answers to a few words of its own, and
 * those words are the one vocabulary of this surface that has no declaration behind it:
 * commander knows nothing about them, so nothing of commander's can say whether the help
 * that lists them and the gate that answers to them agree. They did not — the verb's help
 * SPELLED THEM OUT, and it did so for a reason that is still true (the declaration is
 * built before the session is loaded, and it may not reach it), which is why the fix is a
 * module above both rather than an import.
 *
 * Three things are asserted here, and they are different:
 *
 *   - NOBODY TYPES ONE. Every word is built from the prefix, so a session word inside a
 *     string literal anywhere in `src` is a second spelling waiting to drift. The scan is
 *     over the SOURCE and it excludes nothing, because the module that owns the words
 *     does not hold one either — it composes them.
 *   - THE OLD SPELLING IS GONE, EVERYWHERE. A rename that leaves a copy behind leaves a
 *     reader typing something the product refuses, and the copies were never all in
 *     `src`: they were in the tests that drive a terminal, in the fixtures of two
 *     renderers, and in the golden. The scan therefore covers the tests and the goldens
 *     too, and the discriminant is the SPELLING rather than the symbol — there is no
 *     symbol to grep for at a site that typed the word.
 *   - THE HELP AND THE GATE SAY THE SAME LIST. The elo, over the real `--help` of the
 *     real program and the real disposition: every word the session answers to is listed
 *     with something said about it, and every word the help lists is a word the gate
 *     answers to. Neither half is compared to a list written in this file.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { dispositionOf } from '../src/repl/gate.js';
import { PREFIX, SESSION_WORDS, WHAT_EACH_WORD_DOES } from '../src/session-words.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import type { Declared } from '../src/wiring/verb.js';

/** `packages/code/src`, where the production sources and the goldens are. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** `packages/code/tests`, which drives the surface and therefore types what a caller types. */
const TESTS = fileURLToPath(new URL('.', import.meta.url));

/**
 * The spelling these words used to have, as the accusation it makes.
 *
 * A dot before the word and a word boundary after it, and the two lookarounds are what
 * keep it from reading ordinary code as a relapse: `process.exit`, `program.help()` and
 * `.helpInformation` all have a word character on one side or the other, and every one of
 * them is in this repository.
 */
const THE_OLD_SPELLING = /(?<![\w$/])\.(help|exit)(?![\w-])/;

/**
 * What the prefix used to be, and the words as they used to be spelled.
 *
 * ASSEMBLED RATHER THAN TYPED, and not out of tidiness: the scan below reads this file
 * too, so a case that spelled the old word out would be the one file in the corpus that
 * fails it. Derived from the words themselves, so a word added tomorrow is covered by the
 * same two lines.
 */
const WAS = '.';
const theOldSpellings = (): string[] =>
  SESSION_WORDS.map((word) => WAS + word.slice(PREFIX.length));

/** Every file under a directory whose name ends in one of `kinds`, recursively. */
function filesUnder(directory: string, kinds: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, kinds));
    else if (kinds.some((kind) => entry.endsWith(kind))) found.push(path);
  }
  return found;
}

/** Every production source of the surface: `src`, tests excluded. */
const production = (): string[] =>
  filesUnder(SRC, ['.ts']).filter((file) => !file.endsWith('.test.ts'));

/** Everything a reader of this surface could find the words in: sources, tests, goldens. */
const everywhere = (): string[] => [
  ...filesUnder(SRC, ['.ts', '.txt']),
  ...filesUnder(TESTS, ['.ts', '.txt']),
];

/** A source with its comments taken out, so prose cannot be read as code. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every string a source writes, quotes included. */
function literalsOf(code: string): string[] {
  return code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/** Which of the session's words a source TYPES, rather than composing. */
function typesAWord(source: string): string[] {
  const literals = literalsOf(withoutComments(source));
  return SESSION_WORDS.filter((word) => literals.some((literal) => literal.includes(word)));
}

describe('the words the session answers to are composed, never typed', () => {
  it('is true of every production source of this surface', () => {
    for (const file of production()) {
      expect(typesAWord(readFileSync(file, 'utf-8')), file).toEqual([]);
    }
    // The corpus is real, and it really holds the words — they are built from the prefix
    // in the one module that owns them, which is why not one file above spells one.
    expect(production().length).toBeGreaterThan(50);
    expect(SESSION_WORDS.length).toBeGreaterThan(1);
    for (const word of SESSION_WORDS) expect(word.startsWith(PREFIX)).toBe(true);
  });

  it('would accuse the line an author would write', () => {
    // The vacuous form is a scan whose pattern stopped matching. Composed against the two
    // shapes the defect took: a word typed into a help string, and a word typed into a
    // comparison.
    const relapse = [
      `const help = '  ${SESSION_WORDS[0] as string}   what this session runs';`,
      `if (first === "${SESSION_WORDS[1] as string}") return { does: 'leave' };`,
    ].join('\n');
    expect(typesAWord(relapse).sort()).toEqual([...SESSION_WORDS].sort());
    // And it accuses neither prose nor the composition the module really uses.
    expect(typesAWord(`/* type ${SESSION_WORDS[0] as string} to see them */`)).toEqual([]);
    // Nor the composition the module really uses. The placeholder is assembled, because
    // the lint refuses one inside a plain string and this repository opens no exception
    // to a rule for the convenience of a test.
    const hole = `$${'{'}`;
    expect(typesAWord(`export const LEAVE = \`${hole}PREFIX}exit\`;`)).toEqual([]);
  });
});

describe('the spelling these words used to have is gone', () => {
  it('is nowhere in the sources, the tests or the goldens', () => {
    for (const file of everywhere()) {
      const said = THE_OLD_SPELLING.exec(readFileSync(file, 'utf-8'));
      expect(said?.[0], `${file}: ${said?.[0] ?? ''}`).toBeUndefined();
    }
    // Not vacuous, in both halves. The corpus really was read…
    expect(everywhere().length).toBeGreaterThan(60);
    // …and the words really are in it, under the spelling they have now.
    const all = everywhere()
      .map((file) => readFileSync(file, 'utf-8'))
      .join('\n');
    for (const word of SESSION_WORDS) expect(all).toContain(word);
  });

  it('would accuse the spelling, and does not accuse the code that reads like it', () => {
    // Each shape the old spelling really took in this repository — a help line, a
    // keystroke a test typed, and a sentence about the word — for every word there is.
    for (const old of theOldSpellings()) {
      expect(THE_OLD_SPELLING.test(`  ${old}   what this session runs`), old).toBe(true);
      expect(THE_OLD_SPELLING.test(`terminal.type('${old}\\r');`), old).toBe(true);
      expect(THE_OLD_SPELLING.test(`leaves on \`${old}\`, after answering`), old).toBe(true);
    }
    expect(theOldSpellings().length).toBe(SESSION_WORDS.length);
    // Every one of these is really in this repository, and none of them is the word.
    expect(THE_OLD_SPELLING.test('process.exit(1);')).toBe(false);
    expect(THE_OLD_SPELLING.test('program.helpInformation();')).toBe(false);
    expect(THE_OLD_SPELLING.test("const NAMES = ['commander.help'];")).toBe(false);
    expect(THE_OLD_SPELLING.test('result.exitCode === 0')).toBe(false);
    expect(THE_OLD_SPELLING.test('`cli.help.golden.txt` pins the wording')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The elo: the help lists what the gate answers to
// ---------------------------------------------------------------------------

/** What `mnema repl --help` really printed, line by line. */
async function helpOfTheVerb(): Promise<string[]> {
  const said: string[] = [];
  const io: CliIo = {
    out: (line) => said.push(line),
    err: (line) => said.push(line),
    fail: () => undefined,
  };
  await run([REPL_VERB, '--help'], io);
  // One write, many rows: commander hands its help over as a block, and what this
  // asserts about is a line of it.
  return said.join('\n').split('\n');
}

/** A surface of one read, so a disposition can be asked for without a project. */
const VERBS: readonly Declared[] = [
  { command: new Command('look').description('a read'), effect: 'reads' },
];

describe('the verb’s help lists the words the gate answers to, and says what each does', () => {
  it('names every one of them, with a gloss, and nothing else that looks like one', async () => {
    const help = await helpOfTheVerb();
    // Every word is on a line of its own, with something said after it. A word listed
    // bare is the defect the table this comes from cannot have — the words ARE its keys.
    for (const word of SESSION_WORDS) {
      const line = help.find((said) => said.trim().startsWith(word));
      expect(line, `${word} is not in the help`).toBeDefined();
      expect((line as string).trim().slice(word.length).trim().length, word).toBeGreaterThan(0);
      expect(line as string).toContain(WHAT_EACH_WORD_DOES[word] as string);
    }
    // And the help lists no word the gate does not answer to: every line of it that
    // begins with the prefix is one of them.
    const listed = help
      .map((said) => said.trim())
      .filter((said) => said.startsWith(PREFIX))
      .map((said) => said.split(/\s+/)[0] as string);
    expect([...listed].sort()).toEqual([...SESSION_WORDS].sort());
  }, 60_000);

  it('and the gate really answers to each of them', () => {
    // The other end of the elo. A help that listed a word nothing answered to would
    // satisfy the case above; this is what says the list is the session's own.
    for (const word of SESSION_WORDS) {
      expect(dispositionOf(word, VERBS, REPL_VERB).does, word).not.toBe('refuse');
    }
    // Not vacuous: the gate refuses a word of the same shape that is not one of them.
    expect(dispositionOf(`${PREFIX}nonesuch`, VERBS, REPL_VERB).does).toBe('refuse');
  });
});

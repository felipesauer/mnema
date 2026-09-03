/**
 * THE FLAT LOOKUPS, asked directly — the rows, not the script three shells write.
 *
 * This module was at full line coverage and no test named it. What executes it is
 * `tests/the-shell-knows-the-verbs.test.ts`, and that file asks the SCRIPT: it
 * re-parses `'<key>') echo '<words>' ;;` out of the generated bash with a regex of its
 * own and drives a real shell. Its reader only ever looks up a row keyed `path` or
 * `path + ':'`, so every `<path>:<flag>` row this file produces is invisible to it
 * except through two hand-written `toContain` strings and the three byte-for-byte
 * goldens — which a regenerating hand quietly rewrites. So the tables ran and nobody
 * looked at them.
 *
 * WHAT THAT LEFT UNHELD, measured rather than supposed. Each of these was applied to
 * `lookups.ts` and the whole suite stayed green:
 *   - dropping `flag.short` from `valueRows` (an enumerated flag loses its short row),
 *   - reversing `spellingsOf` to long-before-short (only the goldens noticed),
 *   - `continue` to `break` on a flag that enumerates nothing (a level keeps only the
 *     enumerated flags declared ahead of the first free-text one),
 *   - keying the positional row by `path` instead of `path + ':'`.
 * The first and third are silent on the product's own surface today because no mnema
 * flag carries BOTH a short spelling and a set — which is exactly why the program below
 * is this file's own and not `buildProgram`'s. A guard that could only see the shapes
 * the surface happens to have today would go quiet the day one is added.
 *
 * THE ONE CASE THAT DOES TAKE THE REAL PROGRAM is the last, and it is there because the
 * others cannot be non-vacuous about scale: a walker that returned two rows would satisfy
 * every count below.
 */

import { Command, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';
import { enumeratedArgument, enumeratedOption } from '../wiring/enumerated.js';
import type { CliIo } from '../wiring/io.js';
import { commandRows, flagRows, spellingsOf, valueRows } from './lookups.js';
import { type CompletionTree, completionTree } from './tree.js';

/** A surface that says nothing, for the one case that builds the real program. */
const silent: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/**
 * A program of this file's own, carrying the four shapes the product does not have.
 *
 * `--kind` is the one that matters most: a flag with a short spelling AND a declared set.
 * mnema has none today, so the `flag.short` half of `valueRows` never produces a row on
 * the real surface and could be deleted without a red. `--plain` sits BEFORE `--kind` and
 * enumerates nothing, which is the arrangement a `break` would eat. `move` is a level with
 * exactly one subcommand; `leaf` has none.
 */
function tree(): CompletionTree {
  const program = new Command('tool');
  program.addOption(new Option('-c, --color <when>', 'when').choices(['auto', 'never']));
  const stage = program.command('stage').description('a level with one child');
  stage.option('--plain', 'no colour');
  stage.addOption(enumeratedOption('-k, --kind <kind>', 'which kind (a, b)', ['a', 'b']));
  stage
    .command('move')
    .description('the only child')
    .addArgument(enumeratedArgument('<action>', 'the move', ['start', 'stop']));
  program.command('leaf').description('a level with no children').option('--only-long', 'no short');
  return completionTree(program);
}

/** The rows of a table, as the map a shell's `case` is. */
const asMap = (rows: readonly (readonly [string, string])[]): Map<string, string> =>
  new Map(rows.map(([key, words]) => [key, words]));

describe('valueRows — one key a shell can ask with', () => {
  it('gives an enumerated flag a row under BOTH spellings, with the same words', () => {
    const values = asMap(valueRows(tree()));
    // The short row is the half no mnema flag exercises. Both keys, and the same answer
    // under each — a caller types whichever spelling they know, and the shell looks up
    // what is in front of it.
    expect(values.get('stage:-k')).toBe('a b');
    expect(values.get('stage:--kind')).toBe('a b');
    // The pair, not one of them: an implementation that emitted only the long spelling
    // would satisfy either line above on its own.
    expect(values.get('stage:-k')).toBe(values.get('stage:--kind'));
  });

  it('keeps an enumerated flag declared behind one that enumerates nothing', () => {
    // `--plain` takes no set and is declared FIRST. A loop that stopped at it rather
    // than stepping over it would drop every enumerated flag after it — and at the root
    // of the real program `-V` comes first, so this is the arrangement the surface has.
    const values = asMap(valueRows(tree()));
    expect(values.has('stage:--plain')).toBe(false);
    expect(values.has('stage:--kind')).toBe(true);
    // Non-vacuity of the ordering claim: the flag that enumerates nothing really is in
    // scope at that level, so its absence above is a skip and not a walk that missed it.
    const inScope = tree().nodes.find((node) => node.path === 'stage')?.flags ?? [];
    expect(inScope.map((flag) => flag.long)).toContain('--plain');
  });

  it('keys a positional set with an empty flag half, and nothing else with it', () => {
    // Both shells look this up literally as `_mnema_values "$path:"`. Drop the colon and
    // every enumerated positional stops completing while the script still parses, which
    // is the failure this table exists to make impossible.
    const values = asMap(valueRows(tree()));
    expect(values.get('stage move:')).toBe('start stop');
    expect(values.has('stage move')).toBe(false);
    // A level that enumerates no positional has neither spelling of the key.
    expect(values.has('leaf:')).toBe(false);
    expect(values.has('leaf')).toBe(false);
  });

  it('never issues one key twice', () => {
    // A repeated key is a `case` arm the shell can never reach — dead text in a
    // generated file nobody reads. The colon is what keeps the two halves apart, and
    // the claim is that it succeeds.
    const keys = valueRows(tree()).map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe('commandRows and flagRows — a row per level, keyed by the path alone', () => {
  it('emits a row for exactly the levels that have children, and none of them empty', () => {
    const rows = commandRows(tree());
    // The set, both ways: the levels with children and the levels with rows are the same
    // levels. A walk that skipped one, or invented one, moves one of these two lists.
    const withChildren = tree()
      .nodes.filter((node) => node.commands.length > 0)
      .map((node) => node.path);
    expect(rows.map(([key]) => key)).toEqual(withChildren);
    expect(rows.every(([, words]) => words !== '')).toBe(true);
    // A LEAF gets no row at all, which is the half the guard on the walk is for: an arm
    // that echoed nothing is dead shell, and `leaf` is the level that would produce one.
    expect(rows.map(([key]) => key)).not.toContain('leaf');
    // The words are the level's children in the order the help lists them, and the
    // implicit `help` commander hangs on any level with children is one of them — a Tab
    // offers what can be TYPED there, and `stage help` can.
    expect(asMap(rows).get('stage')).toBe('move help');
    // The program itself is the row keyed by the empty string — the whole top-level Tab.
    expect(asMap(rows).get('')).toBe('stage leaf help');
  });

  it('carries no colon in a key, which is what lets the value table hold both questions', () => {
    expect(commandRows(tree()).every(([key]) => !key.includes(':'))).toBe(true);
    expect(flagRows(tree()).every(([key]) => !key.includes(':'))).toBe(true);
  });

  it('answers a level with every flag in scope there, its own and its ancestors’', () => {
    const flags = asMap(flagRows(tree())).get('stage')?.split(' ') ?? [];
    // Its own, then the program's — an option travels down because the parser accepts it
    // there, and a menu that hid it would leave an absence unreadable.
    expect(flags).toContain('--plain');
    expect(flags).toContain('-k');
    expect(flags).toContain('--kind');
    expect(flags).toContain('-c');
    expect(flags).toContain('--color');
  });
});

describe('spellingsOf — short before long, per flag, in flag order', () => {
  it('pairs each flag and drops the half a declaration does not have', () => {
    const leaf = tree().nodes.find((node) => node.path === 'leaf');
    expect(leaf).toBeDefined();
    // The whole array, not a `toContain`: the order IS the promise, and it is what a
    // reader sees in the generated `_mnema_flags` table. `--only-long` has no short half
    // and contributes one word, not an undefined.
    expect(spellingsOf(leaf as NonNullable<typeof leaf>)).toEqual([
      '--only-long',
      '-h',
      '--help',
      '-c',
      '--color',
    ]);
  });

  it('is the one answer both the script and the console read', () => {
    // The file's stated reason for existing: `repl/complete.ts` calls this same function
    // to answer a Tab after a dash inside the session. Asserted as agreement between the
    // two tables rather than by calling the function twice, which would prove nothing.
    const node = tree().nodes.find((one) => one.path === 'stage');
    const fromTable = (asMap(flagRows(tree())).get('stage') ?? '').split(' ');
    expect(fromTable).toEqual([...spellingsOf(node as NonNullable<typeof node>)]);
  });
});

describe('the real surface, for scale', () => {
  it('walks the whole program, not a corner of it', () => {
    // Every count above is over a four-node tree of this file's own; a walker that
    // returned two rows would satisfy all of them. This is the floor that says the same
    // functions answer over the surface a person actually types at.
    const real = completionTree(buildProgram(silent).program);
    expect(real.nodes.length).toBeGreaterThan(30);
    expect(flagRows(real)).toHaveLength(real.nodes.length);
    expect(commandRows(real).length).toBeGreaterThan(5);
    const keys = valueRows(real).map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    // The domain's own sets reach the table through the channel that enumerates without
    // validating, so a positional that lost its row would show here.
    expect(asMap(valueRows(real)).get('task move:')).toContain('submit');
  });
});

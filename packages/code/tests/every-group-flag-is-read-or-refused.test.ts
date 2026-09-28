/**
 * EVERY FLAG A GROUP DECLARES IS READ BY THE SUBCOMMAND IT REACHES, OR REFUSED THERE — never dropped.
 *
 * commander hands a group every flag it declares, wherever the flag is written, and what runs is the
 * subcommand. So a flag of the group that the subcommand did not read was accepted with exit 0 and
 * thrown away: `decision move accept <id> --alternatives x` recorded the verdict and not the
 * alternatives, and `witness stamp --global` stamped every tree but the one asked for. Measured on
 * the binary before the repair, eight of the twenty-one pairs the program holds were dropped that
 * way. `wiring/from-the-group.ts` is where each subcommand now declares what it reads, and the one
 * function that refuses the rest.
 *
 * WHAT IS ASSERTED, over every pair the program holds — every option of every group against every
 * subcommand of that group, enumerated from the tree and not listed here:
 *
 *   - written after the subcommand, the flag is refused by name or it is not, and which is
 *     {@link WHAT_A_SUBCOMMAND_READS} — reconciled both ways, so a subcommand added under a group
 *     with options is red until somebody writes down what it reads;
 *   - written BEFORE the subcommand, a flag it declares itself is refused and pointed after it, the
 *     rule `decision import` had first; one it takes from the group is read in either place; and one
 *     it does not read is refused wherever it is;
 *   - the completion offers the flag at that subcommand exactly when the line is not refused. That
 *     is asked of the completion tree and of the program's answer, not of the declaration the two
 *     share, which would agree with itself.
 *
 * HOW A LINE RUNS AND DOES NOTHING: in a directory that is not a project, under a HOME of its own,
 * every subcommand here stops before it could write or reach anybody — `NO_PROJECT`, a value the
 * adapter refuses, or `witness`'s `NO_TAIL` over trees that hold none. So "takes no" is said by one
 * function and nothing else, and a subcommand that dropped the flag answers with one of the others.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, Option } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { completionTree } from '../src/completion/tree.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';
import { WHAT_A_SUBCOMMAND_READS } from './support/what-a-subcommand-reads.js';

const silent: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-every-group-flag-'));
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  mkdirSync(join(sandbox, 'nowhere'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(join(sandbox, 'nowhere'));
});

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** One invocation, both streams captured. */
async function invoke(argv: readonly string[]): Promise<{ said: string; failed: boolean }> {
  const lines: string[] = [];
  let failed = false;
  await run(['--color=never', ...argv], {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { said: lines.join('\n'), failed };
}

/** One flag of a group, and one subcommand of that group it can be written on. */
interface Pair {
  readonly group: Command;
  readonly sub: Command;
  readonly option: Option;
  /** `decision move --alternatives`. */
  readonly name: string;
}

const PROGRAM = buildProgram(silent).program;

/** Every pair, off the tree: a group is a command with subcommands that is not the program. */
const PAIRS: readonly Pair[] = everyCommandOf(PROGRAM)
  .filter((command) => command.parent !== null && command.commands.length > 0)
  .flatMap((group) =>
    group.commands.flatMap((sub) =>
      group.options.map((option) => ({
        group,
        sub,
        option,
        name: `${pathOf(sub).join(' ')} ${flagOf(option)}`,
      })),
    ),
  );

/** A flag by its long spelling, or as declared. */
function flagOf(option: Option): string {
  return option.long ?? option.flags;
}

/** The words that satisfy a subcommand's required operands — nothing here gets that far. */
function operandsOf(sub: Command): string[] {
  return sub.registeredArguments.filter((argument) => argument.required).map(() => 'x');
}

/** The flag as typed, with a value when it takes one. */
function typed(option: Option): string[] {
  return option.required || option.optional ? [flagOf(option), 'x'] : [flagOf(option)];
}

/** What the program answers with the flag written AFTER the subcommand. */
async function after(pair: Pair): Promise<{ said: string; failed: boolean }> {
  return invoke([...pathOf(pair.sub), ...operandsOf(pair.sub), ...typed(pair.option)]);
}

/** What the program answers with the flag written BEFORE the subcommand. */
async function before(pair: Pair): Promise<{ said: string; failed: boolean }> {
  return invoke([
    ...pathOf(pair.group),
    ...typed(pair.option),
    pair.sub.name(),
    ...operandsOf(pair.sub),
  ]);
}

/** Whether the answer is the refusal of this very flag, as the one function words it. */
function refusesTheFlag(pair: Pair, said: string): boolean {
  return said.includes(`\`${pathOf(pair.sub).join(' ')}\` takes no ${flagOf(pair.option)}: `);
}

/** Whether a subcommand reads this flag, by the table. */
function readsIt(pair: Pair): boolean {
  return (WHAT_A_SUBCOMMAND_READS[pathOf(pair.sub).join(' ')] ?? []).includes(flagOf(pair.option));
}

describe('every group flag, on every subcommand of its group', () => {
  it('found the pairs by walking the program, and a row for every subcommand that has any', () => {
    // Not vacuous: the eight that were dropped are among them, by name.
    const names = PAIRS.map((pair) => pair.name);
    for (const dropped of [
      'decision move --alternatives',
      'decision supersede --alternatives',
      'decision import --alternatives',
      'skill move --body',
      'witness stamp --global',
      'witness stamp --json',
      'witness upgrade --global',
      'witness upgrade --json',
    ]) {
      expect(names).toContain(dropped);
    }
    // Both ways: a subcommand under a group with options needs a row, and a row needs one.
    const subs = [...new Set(PAIRS.map((pair) => pathOf(pair.sub).join(' ')))].sort();
    expect(subs).toEqual(Object.keys(WHAT_A_SUBCOMMAND_READS).sort());
    // And every flag a row names is one its group declares.
    for (const [path, flags] of Object.entries(WHAT_A_SUBCOMMAND_READS)) {
      const declared = PAIRS.filter((pair) => pathOf(pair.sub).join(' ') === path).map((pair) =>
        flagOf(pair.option),
      );
      for (const flag of flags) expect(declared, `${path} ${flag}`).toContain(flag);
    }
  });

  it('is refused by name exactly where the subcommand does not read it, written after it', async () => {
    const refused: string[] = [];
    for (const pair of PAIRS) {
      const { said, failed } = await after(pair);
      if (refusesTheFlag(pair, said)) {
        expect(failed, pair.name).toBe(true);
        refused.push(pair.name);
      }
    }
    expect(refused.sort()).toEqual(
      PAIRS.filter((pair) => !readsIt(pair))
        .map((pair) => pair.name)
        .sort(),
    );
  });

  it('written before the subcommand, is refused unless the subcommand takes it from the group', async () => {
    for (const pair of PAIRS) {
      const { said, failed } = await before(pair);
      const path = pathOf(pair.sub).join(' ');
      const own = pair.sub.options.some((mine) => flagOf(mine) === flagOf(pair.option));
      if (!readsIt(pair)) {
        expect(refusesTheFlag(pair, said), pair.name).toBe(true);
      } else if (own) {
        // Its own flag, in the group's place: pointed to where it belongs.
        expect(said, pair.name).toContain(
          `\`${path}\` takes its own ${flagOf(pair.option)}: put it after \`${pair.sub.name()}\`, not before.`,
        );
        expect(failed, pair.name).toBe(true);
      } else {
        // A flag it takes from the group is the group's to place, and is read in either place.
        expect(said, pair.name).not.toContain('takes no');
        expect(said, pair.name).not.toContain('takes its own');
      }
    }
  });

  it('is offered by the completion exactly where it is not refused', async () => {
    const offered = new Map(
      completionTree(PROGRAM).nodes.map((node) => [
        node.path,
        node.flags.flatMap((flag) => [flag.long, flag.short]),
      ]),
    );
    const disagree: string[] = [];
    for (const pair of PAIRS) {
      const { said } = await after(pair);
      const refused = refusesTheFlag(pair, said);
      const menu = offered.get(pathOf(pair.sub).join(' ')) ?? [];
      if (menu.includes(flagOf(pair.option)) === refused) {
        disagree.push(`${pair.name}: ${refused ? 'refused and offered' : 'read and not offered'}`);
      }
    }
    expect(disagree).toEqual([]);
  });
});

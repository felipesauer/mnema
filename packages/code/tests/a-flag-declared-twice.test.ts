/**
 * A FLAG A GROUP AND ITS SUBCOMMAND BOTH DECLARE — where it was written, and who reads it.
 *
 * commander parses a group's options out of the whole rest of the line, the part after a
 * subcommand's name included, because this program does not turn positional options on. So when
 * a group and one of its subcommands declare the same flag, the GROUP receives it wherever it is
 * written, and the subcommand's own declaration receives nothing: it lists the flag in `--help`
 * and that is all it does. `wiring/options.ts` already said this about the moves, and it is why
 * they take `--which` from their group instead of declaring it. Three subcommands declared their
 * group's flag anyway and read their own copy: `decision import` its `--scope` and `--which`, and
 * the two `witness` acts their `--global`. All three read the group's value now, through
 * `wiring/from-the-group.ts`, and refuse the flag written before their name.
 *
 * Two things are asserted here.
 *
 * WHERE A FLAG WAS WRITTEN — `wiring/written-before.ts`, over the real `decision` group, with the
 * import's action swapped for a capture so a line costs no process and touches no record. The
 * lines are the spellings a second tokenizer would have had to get right: `--flag=value`, a value
 * that is the verb's own name, a flag only the group declares, the program's own flag in between,
 * and `--`. What the import then DOES with the answer is `the-flags-reach-the-import.test.ts`, on
 * the binary.
 *
 * EVERY PAIR THE TREE HOLDS, each with how its subcommand reads the flag, enumerated from the
 * program itself: a subcommand that starts declaring its group's flag is red here until somebody
 * says which of the two it is. There are four today, and all four are read where they were
 * written. Two of them were a FINDING until they were repaired (see {@link DECLARED_TWICE}).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';
import { ownFlagsWrittenBefore } from '../src/wiring/written-before.js';
import { codeOnly } from './support/reading-source.js';

const silent: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

// The program hangs a hook before every action that reads the trees where it stands, so the
// in-process lines below stand in a directory of their own, under a HOME of their own.
let sandbox: string;
const cwdBefore = process.cwd();
const homeBefore = process.env.HOME;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-a-flag-declared-twice-'));
  process.env.HOME = sandbox;
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(cwdBefore);
  if (homeBefore === undefined) delete process.env.HOME;
  else process.env.HOME = homeBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The subcommand of `command` with this name. */
function childNamed(command: Command, name: string): Command {
  const found = command.commands.find((child) => child.name() === name);
  expect(found, `${command.name()} ${name}`).toBeDefined();
  return found as Command;
}

/** What `ownFlagsWrittenBefore` answers inside `decision import` for one line. */
async function writtenBeforeImport(
  argv: readonly string[],
): Promise<readonly string[] | 'never ran'> {
  const { program } = buildProgram(silent, argv);
  const importing = childNamed(childNamed(program, 'decision'), 'import');
  let answer: readonly string[] | 'never ran' = 'never ran';
  importing.action(() => {
    answer = ownFlagsWrittenBefore(importing);
  });
  await program.parseAsync([...argv], { from: 'user' });
  return answer;
}

describe('where a flag was written is what commander read before the verb', () => {
  // [the line, the import's own flags written before `import`].
  const LINES: readonly (readonly [readonly string[], readonly string[]])[] = [
    [['decision', 'import', 'docs/adr', '--which', 'ci'], []],
    [['decision', 'import', 'docs/adr', '--which=ci'], []],
    [['decision', 'import', '--which', 'ci', 'docs/adr'], []],
    [['decision', 'import', 'docs/adr', '--scope', 'private', '--which', 'ci', '--write'], []],
    [['decision', '--which', 'ci', 'import', 'docs/adr'], ['--which']],
    [['decision', '--which=ci', 'import', 'docs/adr'], ['--which']],
    [['decision', '--scope', 'private', 'import', 'docs/adr', '--which', 'ci'], ['--scope']],
    [
      ['decision', '--which', 'ci', '--scope', 'private', 'import', 'docs/adr'],
      ['--scope', '--which'],
    ],
    // An agent called "import": the word after the flag is its value, and the verb is the next.
    [['decision', '--which', 'import', 'import', 'docs/adr'], ['--which']],
    [['decision', 'import', 'docs/adr', '--which', 'import'], []],
    // A flag only the group declares is not the import's, and does not hide one that is.
    [['decision', '--alternatives', 'import', 'import', 'docs/adr', '--which', 'ci'], []],
    [['decision', '--alternatives', 'x', '--which', 'ci', 'import', 'docs/adr'], ['--which']],
    // The program's own flag is out of the line the group read, wherever it was written.
    [['--color=never', 'decision', 'import', 'docs/adr', '--which', 'ci'], []],
    [['decision', '--color', 'never', 'import', 'docs/adr', '--which', 'ci'], []],
    [['decision', 'import', 'docs/adr', '--color', 'never', '--which', 'ci'], []],
    // After `--` nothing is a flag.
    [['decision', 'import', '--', 'docs/adr'], []],
  ];

  for (const [line, before] of LINES) {
    it(`${line.join(' ')} → ${JSON.stringify(before)}`, async () => {
      expect(await writtenBeforeImport(line)).toEqual(before);
    });
  }

  it('holds for a flag that takes no value, the shape `witness` declares twice', async () => {
    // Built here rather than borrowed, and it said why: no group of the product declared a bare
    // flag its subcommand read through this function, and `--global` was the one that would. It
    // is one now — the two `witness` acts read it this way, and
    // `the-witness-acts-cover-the-tree-asked-for.test.ts` runs them on the binary. The case stays
    // for what the product does not have: the short spelling, and a flag named by it.
    const answer = async (argv: string[]): Promise<readonly string[]> => {
      const root = new Command('tool').exitOverride();
      const group = root.command('group').option('--global').option('-q');
      const act = group.command('act').option('--global').option('-q');
      let found: readonly string[] = [];
      act.action(() => {
        found = ownFlagsWrittenBefore(act);
      });
      await root.parseAsync(argv, { from: 'user' });
      return found;
    };
    expect(await answer(['group', '--global', 'act'])).toEqual(['--global']);
    expect(await answer(['group', 'act', '--global'])).toEqual([]);
    // A flag with no long spelling is named as it was declared.
    expect(await answer(['group', '-q', 'act', '--global'])).toEqual(['-q']);
  });

  it('never prints and never ends the process, even over a line no group could have read', () => {
    // Unreachable through a real parse — a group's flag with nothing after it stops the line
    // before any subcommand runs — so the line is handed over by hand, the way commander keeps it.
    const root = new Command('tool');
    const group = root.command('group').option('--opt <value>');
    const act = group.command('act').option('--opt <value>');
    root.args = ['group', '--opt'];
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(() => ownFlagsWrittenBefore(act)).toThrow(CommanderError);
      expect(written).not.toHaveBeenCalled();
    } finally {
      written.mockRestore();
    }
  });

  it('answers nothing for the program, or for a verb whose only group is the program', () => {
    // Above a verb there is no group line to read, only the program's whole argv. No verb
    // declares a flag the program does — the table below holds every pair, the program's
    // included — so this nothing is true today, and it is the limit the module states.
    const { program } = buildProgram(silent);
    expect(ownFlagsWrittenBefore(program)).toEqual([]);
    expect(ownFlagsWrittenBefore(childNamed(program, 'decision'))).toEqual([]);
  });
});

/** How a subcommand reads a flag its group also declares. */
type Reading = 'where it was written' | 'its own copy, which the group takes';

/**
 * Every flag a subcommand declares that an ancestor declares too, and how the subcommand reads it.
 *
 * THE TWO `witness` ROWS WERE A FINDING, NOT A DESIGN, and this said so while they read `its own
 * copy, which the group takes`. Each act read its own `opts.global`, which commander never sets,
 * because `witness` declares `--global` too and takes it. Measured on the binary, outside a project
 * and with one tail in the machine-global tree: `mnema witness --global` listed that tail, `mnema
 * witness stamp --global` answered `there is no tail here to witness`, and `mnema witness upgrade
 * --global` said `No tail holds events in any tree here — looked in .` — two sentences false for
 * the tree that was asked for. It was recorded here and not repaired, because making the flag
 * reach the acts changes which tails the one verb that speaks to a public calendar sends out, and
 * whether the spelling before the act is honoured or refused was not this file's to decide.
 *
 * It was decided: the flag is honoured after the act and refused before it, as `decision import`
 * refuses it, and both rows turned when the acts began reading it where it was written.
 */
const DECLARED_TWICE: Readonly<Record<string, Reading>> = {
  'decision import --scope': 'where it was written',
  'decision import --which': 'where it was written',
  'witness stamp --global': 'where it was written',
  'witness upgrade --global': 'where it was written',
};

/**
 * Every such flag in the program, read off the tree and off each action's own source.
 *
 * A subcommand reads one where it was written when its action asks `fromTheGroup` — the one reader
 * that puts the question to `ownFlagsWrittenBefore` and then reads the value off the group. It
 * asked `ownFlagsWrittenBefore` in its own source, once; the question moved into that reader when
 * a second verb needed it.
 */
function declaredTwice(): Record<string, Reading> {
  const handlers = new Map<Command, string>();
  const real = Command.prototype.action;
  // Intercepted rather than read out of a private field, as `every-option-feeds-something` does:
  // the handler's source is the only place that says what the subcommand reads.
  Command.prototype.action = function action(this: Command, fn: (...args: never[]) => unknown) {
    handlers.set(this, fn.toString());
    return real.call(this, fn as Parameters<typeof real>[0]);
  } as typeof real;
  let program: Command;
  try {
    program = buildProgram(silent).program;
  } finally {
    Command.prototype.action = real;
  }
  const found: Record<string, Reading> = {};
  for (const command of everyCommandOf(program)) {
    // `(0, __vi_import_n__.fromTheGroup)(…)` is what the test runner makes of an imported binding,
    // so the call is matched with the parenthesis that closes that rewrite as well as without it.
    const reads = /\bfromTheGroup\)?\s*\(/.test(codeOnly(handlers.get(command) ?? ''));
    for (let above = command.parent; above !== null; above = above.parent) {
      for (const own of command.options) {
        const shared = above.options.some(
          (theirs) =>
            (own.long !== undefined && theirs.long === own.long) ||
            (own.short !== undefined && theirs.short === own.short),
        );
        if (!shared) continue;
        found[`${pathOf(command).join(' ')} ${own.long ?? own.flags}`] = reads
          ? 'where it was written'
          : 'its own copy, which the group takes';
      }
    }
  }
  return found;
}

describe('a flag declared on a group and on its subcommand', () => {
  it('is one of the pairs accounted for, each read the way the table says', () => {
    expect(declaredTwice()).toEqual(DECLARED_TWICE);
  });
});

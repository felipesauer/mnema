/**
 * `from-the-group.ts` over programs of this file's own — the shapes the product does not have.
 *
 * The product's subcommands are run pair by pair in `tests/every-group-flag-is-read-or-refused.test.ts`,
 * and every one of their refusals declares its own reason, so the DEFAULT sentence is said by nothing
 * that ships; neither is a group nested under another group. Both are asked here, on programs built
 * for it, with each action swapped for a capture so a line costs no process.
 */

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { renderPlain } from '../presentation/plain.js';
import {
  fromTheGroup,
  optionsTakenFromTheGroup,
  REFUSED,
  takesFromItsGroup,
} from './from-the-group.js';
import type { Reporter } from './report.js';

/** A reporter that keeps what was said, and whether it failed. */
function listening(): Reporter & { said: string[]; failed: boolean } {
  const said: string[] = [];
  const reporter = {
    said,
    failed: false,
    io: {
      out: (line: string) => said.push(line),
      err: (line: string) => said.push(line),
      fail: () => {
        reporter.failed = true;
      },
    },
    render: renderPlain,
  };
  return reporter;
}

/** `tool group act`, the group declaring three flags, the act one of them too. */
function program(): { root: Command; group: Command; act: Command } {
  const root = new Command('tool').exitOverride().option('--loud');
  const group = root
    .command('group')
    .option('--mine <value>')
    .option('--shared')
    .option('--theirs <value>')
    .action(() => undefined);
  const act = group.command('act').option('--shared');
  return { root, group, act };
}

/** What `fromTheGroup` answers inside `act` for one line. */
async function answer(
  argv: readonly string[],
  declare: (act: Command) => void = () => undefined,
): Promise<{ given: unknown; said: string[]; failed: boolean }> {
  const { root, act } = program();
  declare(act);
  const to = listening();
  let given: unknown = 'never ran';
  act.action(async () => {
    given = await fromTheGroup(act, to);
  });
  await root.parseAsync([...argv], { from: 'user' });
  return { given, said: to.said, failed: to.failed };
}

describe('fromTheGroup', () => {
  it('refuses a flag of the group the act does not read, in the default sentence', async () => {
    const { given, said, failed } = await answer(['group', 'act', '--theirs', 'x']);
    expect(given).toBe(REFUSED);
    expect(failed).toBe(true);
    expect(said.join('\n')).toContain(
      '`group act` takes no --theirs: it is an option of `group` itself, which `group act` does ' +
        'not read.',
    );
  });

  it('refuses it with the reason declared for it, and wherever it was written', async () => {
    const declare = (act: Command): void =>
      takesFromItsGroup(act, { refuses: { '--theirs': 'it is somebody else’s.' } });
    for (const line of [
      ['group', 'act', '--theirs', 'x'],
      ['group', '--theirs', 'x', 'act'],
    ]) {
      const { given, said } = await answer(line, declare);
      expect(given).toBe(REFUSED);
      expect(said.join('\n')).toContain('`group act` takes no --theirs: it is somebody else’s.');
    }
  });

  it('hands over the flags it takes, read off the group, wherever a taken one was written', async () => {
    const declare = (act: Command): void => takesFromItsGroup(act, { takes: ['--mine'] });
    expect((await answer(['group', 'act', '--mine', 'x'], declare)).given).toEqual({
      mine: 'x',
      shared: undefined,
    });
    expect((await answer(['group', '--mine', 'x', 'act'], declare)).given).toEqual({
      mine: 'x',
      shared: undefined,
    });
  });

  it('reads its own flag off the group after its name, and refuses it before', async () => {
    expect((await answer(['group', 'act', '--shared'])).given).toEqual({ shared: true });
    const early = await answer(['group', '--shared', 'act']);
    expect(early.given).toBe(REFUSED);
    expect(early.said.join('\n')).toContain(
      '`group act` takes its own --shared: put it after `act`, not before.',
    );
  });

  it('names a flag with no long spelling as it was declared', async () => {
    const root = new Command('tool').exitOverride();
    const group = root
      .command('group')
      .option('-q')
      .action(() => undefined);
    const act = group.command('act');
    const to = listening();
    let given: unknown;
    act.action(async () => {
      given = await fromTheGroup(act, to);
    });
    await root.parseAsync(['group', 'act', '-q'], { from: 'user' });
    expect(given).toBe(REFUSED);
    expect(to.said.join('\n')).toContain(
      '`group act` takes no -q: it is an option of `group` itself',
    );
  });

  it('leaves the program’s own flags to the program', async () => {
    expect((await answer(['--loud', 'group', 'act'])).given).toEqual({ shared: undefined });
    expect((await answer(['group', 'act', '--loud'])).given).toEqual({ shared: undefined });
  });

  it('reaches every group above a subcommand, however deep it is hung', async () => {
    const root = new Command('tool').exitOverride();
    const outer = root.command('outer').option('--far <value>');
    const inner = outer.command('inner').option('--near <value>');
    const leaf = inner.command('leaf');
    takesFromItsGroup(leaf, { takes: ['--near'] });
    const to = listening();
    let given: unknown;
    leaf.action(async () => {
      given = await fromTheGroup(leaf, to);
    });
    await root.parseAsync(['outer', 'inner', 'leaf', '--near', 'n'], { from: 'user' });
    expect(given).toEqual({ near: 'n' });
    await root.parseAsync(['outer', 'inner', 'leaf', '--far', 'f'], { from: 'user' });
    expect(given).toBe(REFUSED);
    expect(to.said.join('\n')).toContain(
      '`outer inner leaf` takes no --far: it is an option of `outer` itself',
    );
    expect(optionsTakenFromTheGroup(leaf).map((option) => option.long)).toEqual(['--near']);
  });
});

describe('optionsTakenFromTheGroup', () => {
  it('is what the act declares too and what it declares it takes — nothing of the program', () => {
    const { root, group, act } = program();
    takesFromItsGroup(act, { takes: ['--mine'] });
    expect(optionsTakenFromTheGroup(act).map((option) => option.long)).toEqual([
      '--mine',
      '--shared',
    ]);
    // The group is a verb of the program, and the program is not a group.
    expect(optionsTakenFromTheGroup(group)).toEqual([]);
    expect(optionsTakenFromTheGroup(root)).toEqual([]);
  });
});

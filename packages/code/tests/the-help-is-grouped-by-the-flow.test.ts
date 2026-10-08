/**
 * THE HELP IS GROUPED BY THE FLOW OF THE WORK — and a verb cannot arrive without a group.
 *
 * `mnema --help` lists every verb, and a list of fifty-odd names in one block is read by
 * nobody. The page is cut into groups in the order a person meets them: what is recorded,
 * what is handed over, what is verified, what is read, the git log, this machine, and what a
 * host calls. The verbs a host calls stay VISIBLE, because two of them write, and a help that
 * hid them would stop showing where the record can change.
 *
 * WHAT IS PINNED AND WHAT IS DERIVED. The words of the page are `cli.help.golden.txt`'s. What
 * is held here is the shape that does not depend on any one sentence: no verb is left under
 * commander's own `Commands:` heading (which is where a verb registered outside the groups
 * would land), the groups come in the order of the flow, the column holds names and not
 * usage, and the program option that is not for a person is not on the page.
 */

import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/program.js';

const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

const GROUPS_IN_ORDER = [
  'Record:',
  'Hand over:',
  'Verify:',
  'Read:',
  'The git log:',
  'This machine:',
  'Called by a host:',
  'Help:',
] as const;

/** What `mnema --help` prints, split by heading: the first word of each indented line. */
function rootHelp(): { readonly text: string; readonly groups: Map<string, string[]> } {
  const { program } = buildProgram(silent);
  const text = program.helpInformation();
  const groups = new Map<string, string[]>();
  let heading: string | undefined;
  for (const line of text.split('\n')) {
    if (/^\S.*:$/.test(line)) {
      heading = line;
      groups.set(heading, []);
    } else if (heading !== undefined && /^ {2}\S/.test(line)) {
      groups.get(heading)?.push(line.trim().split(/\s+/)[0] ?? '');
    }
  }
  return { text, groups };
}

describe('the help is grouped by the flow of the work', () => {
  it('has the groups in the order of the flow, and no verb under the bare heading', () => {
    const { groups } = rootHelp();
    expect([...groups.keys()].filter((heading) => heading !== 'Options:')).toEqual([
      ...GROUPS_IN_ORDER,
    ]);
  });

  it('lists every registered verb exactly once, each under one group', () => {
    const { program } = buildProgram(silent);
    const { groups } = rootHelp();
    const listed = [...groups.entries()]
      .filter(([heading]) => heading !== 'Options:')
      .flatMap(([, names]) => names);
    const registered = program.commands.map((command) => command.name());
    expect([...listed].sort()).toEqual([...registered, 'help'].sort());
  });

  it('keeps the verbs a host calls visible, under their own heading', () => {
    const { groups } = rootHelp();
    expect(groups.get('Called by a host:')).toEqual([
      'mcp',
      'run',
      'before-a-write',
      'tally',
      'corrections',
    ]);
    expect(groups.get('Help:')).toEqual(['help']);
  });

  it('puts only the name in the column, and keeps the plugin’s question off the page', () => {
    const { text } = rootHelp();
    expect(text).not.toMatch(/^ {2}[a-z][\w-]* +[[<]/m);
    expect(text).not.toContain('--identify');
  });

  it('still shows the arguments on the page of a verb that has subcommands', () => {
    const { program } = buildProgram(silent);
    const decision = program.commands.find((command) => command.name() === 'decision');
    expect(decision?.helpInformation()).toMatch(/^ {2}\S+ \[options\] <\S+>/m);
  });
});

/**
 * EIGHT VERBS WENT UNDER THE NOUN THEY BELONG TO, and the old names are gone with no alias: the
 * program is pre-release, so a name that is still answered is a second spelling nobody asked for.
 *
 * Each row says where the verb went. The program is asked two things: the old name is not a
 * command of the root (a verb hung back on the program under its old name turns this red), and
 * the new path is one a person can type, in the group the table names. What the verbs print is
 * held by the goldens and by the cases that run them; this holds the NAMES.
 */

import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/program.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';

/** Old root name, and the path it became. `focus` became part of `resume`, so it has none of its own. */
const WENT_UNDER: Readonly<Record<string, string>> = {
  skills: 'skill provenance',
  focus: 'resume',
  accountability: 'audit accountability',
  antipatterns: 'audit antipatterns',
  exposure: 'audit exposure',
  handoff: 'task handoff',
  'next-actions': 'task next',
  guard: 'task guard',
};

const quiet = { out: () => undefined, err: () => undefined, fail: () => undefined };

describe('a verb that went under a noun is not a verb any more', () => {
  const { program } = buildProgram(quiet);
  // EVERY SPELLING A COMMAND ANSWERS TO, at any depth: its name and its aliases. A `.alias('focus')`
  // on `resume` keeps the old verb alive under another command, and `name()` alone would not see it.
  const spellings = everyCommandOf(program).flatMap((command) => [
    command.name(),
    ...command.aliases(),
  ]);
  const root = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
  const paths = everyCommandOf(program).map((command) => pathOf(command).join(' '));

  it.each(Object.keys(WENT_UNDER))(
    '%s is not a command of the root, nor an alias of any',
    (old) => {
      expect(root).not.toContain(old);
    },
  );

  it('is not the name or alias of any command at any depth, unless it is the new one’s own', () => {
    // `focus` and `skills` and the rest answer to nothing; the only old name that is also a
    // new command's own name is `guard`/`exposure`/`accountability`/`antipatterns`, which are
    // the LAST word of a path under their group, and that is allowed — what is not is a spelling
    // that routes to a different place than the table says.
    for (const [old, now] of Object.entries(WENT_UNDER)) {
      const where = everyCommandOf(program)
        .filter((command) => [command.name(), ...command.aliases()].includes(old))
        .map((command) => pathOf(command).join(' '));
      expect(
        where.filter((path) => path !== now),
        old,
      ).toEqual([]);
    }
    expect(spellings).not.toContain('focus');
    expect(spellings).not.toContain('skills');
    expect(spellings).not.toContain('next-actions');
  });

  it.each(Object.entries(WENT_UNDER))('%s is typed as `%s`', (_old, now) => {
    expect(paths).toContain(now);
  });

  it('left the root with the groups and nothing else of those names', () => {
    expect(root).toEqual(expect.arrayContaining(['audit', 'resume', 'skill', 'task']));
    // The pairs that stayed, said once so a later fold of them is a decision and not a drift.
    expect(root).toEqual(expect.arrayContaining(['brief', 'recall', 'rules', 'rules-file']));
  });
});

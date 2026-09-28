/**
 * What each subcommand of a group READS of its group's flags — written here, by hand, as the
 * statement a reviewer reads, and held to the program's behaviour rather than to its declaration.
 *
 * The declaration is `wiring/from-the-group.ts`, and the refusal and the completion both read it.
 * A table that asked the declaration what it says would agree with it by construction, so this one
 * is checked against what the program DOES: `every-group-flag-is-read-or-refused.test.ts` runs every
 * flag of every group on every subcommand of it and asserts that the ones listed here are the ones
 * not refused, in both directions — a subcommand added under a group with options is red there
 * until it has a row here. `the-shell-knows-the-verbs.test.ts` reads the same rows for what the
 * three scripts must offer.
 *
 * A subcommand of a group that declares no options has no row: there is nothing for it to read or
 * to refuse. The program is not a group — its own flags are read by the program, for every verb.
 */
export const WHAT_A_SUBCOMMAND_READS: Readonly<Record<string, readonly string[]>> = {
  // The moves name the agent that executed them, and follow the entity to its tree.
  'task move': ['--which'],
  'decision move': ['--which'],
  'decision supersede': ['--which'],
  'skill move': ['--which'],
  // A birth over one tree fewer: its own two, read off the group where commander put them.
  'decision import': ['--scope', '--which'],
  // Nothing is born, moved or recorded, so there is nothing to scope or to credit.
  'skill export': [],
  // The tree an act covers; the reading's `--json` is the reading's.
  'witness stamp': ['--global'],
  'witness upgrade': ['--global'],
};

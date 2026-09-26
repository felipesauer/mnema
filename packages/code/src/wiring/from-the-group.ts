/**
 * Which of its group's flags a subcommand READS — declared once, beside the subcommand, and asked
 * by the three places that have to agree about it: the action, for the values; the refusal, for
 * every other flag the line gave the group; and the completion, for what to offer.
 *
 * A GROUP RECEIVES EVERY FLAG IT DECLARES, WHEREVER THE FLAG IS WRITTEN. commander parses a group's
 * options out of the whole rest of the line, the part after a subcommand's name included, because
 * this program does not turn positional options on (`written-before.ts` says why it must not). So
 * `mnema decision move accept <id> --alternatives x` hands `--alternatives` to `decision`, and what
 * runs is `decision move`, not the group's own action, which is the one that reads it. Every flag of
 * a group that its subcommand did not read was accepted with exit 0 and dropped without a word:
 * `--alternatives` on the three subcommands of `decision`, `--body` on `skill move`, `--json` on
 * both `witness` acts. Two had a check of their own for part of it — the moves for `--scope`, `skill
 * export` for its group's three flags — each a copy of one rule, and the rest had none.
 *
 * A FLAG THE SUBCOMMAND DECLARES TOO LANDS ON THE GROUP AS WELL, and the subcommand's own copy is
 * never filled. The two `witness` acts read their own `--global`, and so never saw one: outside a
 * project, with a tail in the machine-global tree, `mnema witness stamp --global` answered that
 * there was no tail to witness. Such a flag is read here off the group, where commander put it, and
 * written BEFORE the subcommand's name it is refused, the way `decision import` refused it first:
 * the flag belongs to the verb it follows, and honouring both places would teach two spellings of
 * one option.
 *
 * ONE ANSWER, THEN: every flag the line gave a group is either one its subcommand takes, and
 * {@link fromTheGroup} returns it, or it is refused by name before the subcommand does anything.
 * `every-group-flag-is-read-or-refused.test.ts` runs every pair the program holds and holds the
 * completion to the same set; `the-witness-acts-cover-the-tree-asked-for.test.ts` and
 * `a-refused-group-flag-leaves-the-record.test.ts` run the two halves on the binary.
 */

import type { Command, Option } from 'commander';
import { pathOf } from './misuse.js';
import { type Reporter, reportUsage } from './report.js';

/** What one subcommand declares about its group's flags. */
export interface FromItsGroup {
  /**
   * The group's flags it reads besides the ones it declares itself, by long spelling — the moves'
   * `--which`. A flag it declares itself is read without being listed.
   */
  readonly takes?: readonly string[];
  /** Why it refuses a flag, by long spelling, where there is more to say than the default. */
  readonly refuses?: Readonly<Record<string, string>>;
}

const DECLARED = new WeakMap<Command, FromItsGroup>();

/** Declares, where the subcommand is registered, what it takes from its group. */
export function takesFromItsGroup(sub: Command, declared: FromItsGroup): void {
  DECLARED.set(sub, declared);
}

/** Returned by {@link fromTheGroup} once it has said why the line is refused. */
export const REFUSED = Symbol('refused-group-flag');

/**
 * The options of the groups above `sub` that `sub` reads: the ones it declares itself too, and the
 * ones it declares it takes. The program is not a group here — its own flags are read by the
 * program, for every verb — so a verb of the program takes nothing, and needs nothing.
 */
export function optionsTakenFromTheGroup(sub: Command): readonly Option[] {
  const takes = DECLARED.get(sub)?.takes ?? [];
  return groupsAbove(sub).flatMap((group) =>
    group.options.filter(
      (option) =>
        takes.includes(nameOf(option)) || sub.options.some((own) => sharesASpelling(own, option)),
    ),
  );
}

/**
 * The values of the group flags `sub` takes, by attribute — or {@link REFUSED}, once it has said
 * why, when the line gave the group a flag `sub` does not read, or one of `sub`'s own written
 * before its name.
 *
 * It runs first in the action, so a refused line has done nothing at all. The value of a flag `sub`
 * declares itself is the group's, because the group is what commander handed it to.
 */
export async function fromTheGroup<Values extends object>(
  sub: Command,
  to: Reporter,
): Promise<Values | typeof REFUSED> {
  const path = pathOf(sub).join(' ');
  const taken = optionsTakenFromTheGroup(sub);
  if (taken.some((option) => sub.options.some((own) => sharesASpelling(own, option)))) {
    // Loaded only here: the question is put to a parser of its own, and only a subcommand that
    // declares its group's flag has it to ask.
    const { ownFlagsWrittenBefore } = await import('./written-before.js');
    const [early] = ownFlagsWrittenBefore(sub);
    if (early !== undefined) {
      reportUsage(
        to,
        `\`${path}\` takes its own ${early}: put it after \`${sub.name()}\`, not before.`,
      );
      return REFUSED;
    }
  }
  const values: Record<string, unknown> = {};
  for (const group of groupsAbove(sub)) {
    for (const option of group.options) {
      const attribute = option.attributeName();
      if (taken.includes(option)) {
        values[attribute] = group.getOptionValue(attribute);
      } else if (group.getOptionValueSource(attribute) === 'cli') {
        const flag = nameOf(option);
        const why = DECLARED.get(sub)?.refuses?.[flag] ?? notRead(group, path);
        reportUsage(to, `\`${path}\` takes no ${flag}: ${why}`);
        return REFUSED;
      }
    }
  }
  return values as Values;
}

/**
 * Why a subcommand refuses a flag of its group that it declares nothing particular about. The
 * group is named by its path, as the subcommand is — the way every refusal of this kind names them.
 */
function notRead(group: Command, path: string): string {
  const owner = pathOf(group).join(' ');
  return `it is an option of \`${owner}\` itself, which \`${path}\` does not read.`;
}

/** The commands above `sub` that hand it a line, nearest first — every ancestor but the program. */
function groupsAbove(sub: Command): readonly Command[] {
  const groups: Command[] = [];
  for (let at = sub.parent; at !== null && at.parent !== null; at = at.parent) groups.push(at);
  return groups;
}

/** A flag by its long spelling, or as declared when it has none. */
function nameOf(option: Option): string {
  return option.long ?? option.flags;
}

/** Whether two declarations answer to one spelling on the line. */
function sharesASpelling(one: Option, other: Option): boolean {
  const spellings = [other.long, other.short].filter((spelling) => spelling !== undefined);
  return [one.long, one.short].some(
    (spelling) => spelling !== undefined && spellings.includes(spelling),
  );
}

/**
 * Which of a subcommand's own flags were written BEFORE its name — read off the line, not off
 * which command commander handed the value to.
 *
 * THE TWO ARE DIFFERENT QUESTIONS, and a group that declares a flag its subcommand also declares
 * is where they part. commander parses a group's options out of the WHOLE rest of the line, the
 * part after the subcommand's name included, unless positional options are on — and this program
 * does not turn them on. So `mnema decision import docs/adr --which ci` hands `--which` to
 * `decision`, and `decision import` receives nothing of its own. Asking "did the group get a
 * value?" answers the same for a flag written before the verb and for one written after it, and
 * `decision import` asked exactly that: it refused every `--scope` and every `--which` it was
 * given, in either place, while its `--help` listed both. `the-flags-reach-the-import.test.ts`
 * runs both places on the binary.
 *
 * WHERE A FLAG WAS WRITTEN IS ANSWERED BY COMMANDER'S OWN PARSER, not by a second one. A walk over
 * the tokens here would have to know what commander knows — which flags take a value, the
 * `--flag=value` spelling, a value that happens to be a subcommand's name (`--which import` is an
 * agent called "import") — and a second reading of a rule is how two readings come to disagree.
 * So the question is put to a throwaway command holding the group's option table and its
 * subcommands' names, with positional options on: commander then stops at the subcommand's name,
 * and what that command took is exactly what was written before it. Each of those spellings is a
 * case in `a-flag-declared-twice.test.ts`, over the real `decision` group.
 *
 * THE THROWAWAY IS NEVER PART OF THE PROGRAM, and that is the only reason positional options may
 * be turned on here. On the program they would decide this for every verb at once: a group's flag
 * written after its subcommand would stop reaching the group, and that is how the moves take
 * their executor today (`task move submit <id> --which …` is refused by the GROUP's parser when
 * the value names nobody — `cli-e2e.test.ts`). That would change what other verbs accept, which is
 * not a repair of this one. `the-command-handed-over-runs-as-handed.test.ts` holds the program to
 * that, and names this file as the one place the setting appears.
 *
 * It reads the line the group received as its parent kept it (`Command.args`): the program's own
 * flags are already out of it, so a `--color` written anywhere is not taken for the group's. On a
 * line that reached the subcommand, everything between the group's name and the subcommand's is
 * one of the group's options or an option's value — any other word stops the dispatch before a
 * subcommand runs — so the throwaway sees what the group saw there, and nothing else.
 */

import { Command, Option } from 'commander';

/**
 * The flags `sub` declares for itself that were written before its name, in the order `sub`
 * declares them: `['--scope']` for `mnema decision --scope private import docs/adr`, and nothing
 * for the same flag written after `import`. A flag only the group declares is not `sub`'s, and is
 * not reported.
 */
export function ownFlagsWrittenBefore(sub: Command): readonly string[] {
  const group = sub.parent;
  const line = group?.parent?.args;
  if (group === null || line === undefined) return [];
  const probe = new Command().enablePositionalOptions().helpCommand(false).exitOverride();
  probe.configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: () => {} });
  for (const option of group.options) probe.addOption(new Option(option.flags));
  for (const command of group.commands) probe.command(command.name());
  // The first word the parent kept is the group's own name; what follows is what the group read.
  probe.parseOptions(line.slice(1));
  return sub.options
    .filter((own) => probe.getOptionValueSource(own.attributeName()) === 'cli')
    .map((own) => own.long ?? own.flags);
}

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
 * So the question is put to throwaway commands holding the group's option table, parsed by
 * commander's DEFAULT rules, over growing prefixes of the line: the first prefix whose parse leaves
 * an operand ends at the subcommand's name — every word before it was an option or an option's
 * value, as commander read them — and what a parse of the words before it took is exactly what was
 * written before the subcommand. Each of those spellings is a case in
 * `a-flag-declared-twice.test.ts`, over the real `decision` group.
 *
 * IT TURNS NO PARSE SETTING ON, and it did. It asked a throwaway with positional options on, so
 * commander would stop at the subcommand's name itself; that made this file the one exception to
 * the guard that the program uses no setting its mirror cannot copy
 * (`the-command-handed-over-runs-as-handed.test.ts`), argued as harmless because the throwaway was
 * never registered. The prefixes give the same answer with no setting at all, and the guard has
 * no exception now. Positional options on the PROGRAM would decide this for every verb at once: a
 * group's flag written after its subcommand would stop reaching the group, which is how the moves
 * take their executor today (`task move submit <id> --which …` is refused by the GROUP's parser
 * when the value names nobody — `cli-e2e.test.ts`).
 *
 * It is asked by `from-the-group.ts`, for every subcommand that declares a flag its group declares
 * too — `decision import`'s two, and the two `witness` acts' `--global`.
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
 * not reported. A flag is named by its long spelling, or as declared when it has none.
 *
 * A verb of the program itself is answered with nothing, and so is the program: there is no group
 * line to read above a verb, only the program's whole argv. That nothing is true today because no
 * verb declares a flag the program declares — `a-flag-declared-twice.test.ts` enumerates every
 * pair, the program's included, and holds both answers.
 */
export function ownFlagsWrittenBefore(sub: Command): readonly string[] {
  const group = sub.parent;
  const line = group?.parent?.args;
  if (group === null || line === undefined) return [];
  // The first word the parent kept is the group's own name; what follows is what the group read.
  const before = wordsBeforeTheSubcommand(group, line.slice(1), sub.name());
  if (before === undefined) return [];
  const probe = probeOf(group);
  probe.parseOptions([...before]);
  return sub.options
    .filter((own) => probe.getOptionValueSource(own.attributeName()) === 'cli')
    .map((own) => own.long ?? own.flags);
}

/**
 * The words the group read before the subcommand's name, found by commander: the shortest prefix
 * whose parse leaves an operand ends at it. A prefix that stops inside an option — its value not
 * yet written — is refused by the parse, and the next one is asked. Undefined when the first word
 * commander takes as an operand is not the subcommand's name, which no line that reached the
 * subcommand can be.
 */
function wordsBeforeTheSubcommand(
  group: Command,
  words: readonly string[],
  name: string,
): readonly string[] | undefined {
  for (let end = 1; end <= words.length; end++) {
    let operands: readonly string[];
    try {
      operands = probeOf(group).parseOptions(words.slice(0, end)).operands;
    } catch {
      continue;
    }
    if (operands.length > 0) return operands[0] === name ? words.slice(0, end - 1) : undefined;
  }
  return undefined;
}

/**
 * A throwaway holding the group's option table and nothing else — commander's default parse, no
 * setting turned on. It may never speak or end the process: it runs inside somebody's command.
 * A line no group could have read throws here, silently, and the caller asks the next prefix.
 */
function probeOf(group: Command): Command {
  const probe = new Command().helpCommand(false).exitOverride();
  probe.configureOutput({ outputError: () => {}, writeErr: () => {}, writeOut: () => {} });
  for (const option of group.options) probe.addOption(new Option(option.flags));
  return probe;
}

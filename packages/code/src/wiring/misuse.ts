/**
 * The parser's no, said in the product's voice — one wording, for every verb there
 * is and every verb there will be.
 *
 * The surface used to answer with TWO VOICES. Its own is a sentence about this
 * project ("No mnema project here. Run `mnema init` first."); commander's is
 * `error: missing required argument 'rationale'` — the internal name of a parameter,
 * lowercase, saying neither what the argument means nor what to type, and it is
 * exactly the one a person meets on their first command. Both exit non-zero and both
 * are a no, so a reader has no reason to be told them by two different products.
 *
 * NOTHING HERE IS NEW TEXT. Every command already declares what its arguments and
 * options mean, because `--help` prints it: `argument('<title>', 'the task title')`,
 * `option('--which <agent>', WHICH_HELP)`. The wording below is that description put
 * after a sentence naming what is missing, and under it the line to type, which is
 * the `usage()` commander composes for the same help. So the message cannot drift
 * from the help — there is one text and it is the declaration's — and a verb whose
 * help improves says the better thing here on the same day.
 *
 * IT IS INSTALLED BY WALKING THE COMMAND TREE, once, after every verb is registered.
 * commander reports a usage error from the command that FAILED — that is the only
 * object that knows which argument was missing — and `configureOutput` is per-command
 * too, so a translation wired verb by verb would be FORTY-THREE sites today and the
 * forty-fourth command added tomorrow would come out in the other voice. The walk is
 * one site, and the verb added tomorrow is covered by construction.
 *
 * (The count is what `everyCommandOf` reaches, re-measured whenever it is read: it said
 * thirty-eight when this was written and nothing checks it, so it had drifted by four
 * before the verb that made it drift by a fifth was noticed.)
 *
 * THE CODE IS THE DISCRIMINANT, NEVER THE MESSAGE. commander's sentences are a
 * dependency's English: matching one with `includes('missing required')` would go on
 * passing while quietly matching nothing after an upgrade, which is the failure this
 * product refuses by principle. What is read here is {@link CommanderError.code} and
 * the command's own declarations. The codes are STRINGS and not a union, so the
 * compiler cannot check the table is total — `one-voice-for-a-no.test.ts` enumerates
 * what is worded, and the code nobody worded still comes out through the product's
 * funnel, in the shape the surface already uses for a refusal it has no wording for.
 *
 * AND `--help` AND `--version` ARE NOT TOUCHED. They arrive here as a `CommanderError`
 * like everything else — commander throws to leave, and the entry catches it — but
 * they are the caller getting exactly what they asked for. Rewriting or painting them
 * would turn a success into bad news, so the three codes that mean "already answered"
 * are named and skipped. The discriminant is the code and not the exit status: a
 * `mnema help <unknown>` prints the whole help and exits 1, and it is still the help.
 */

import type { Argument, Command, CommanderError, Option } from 'commander';
import { fact } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';
import { type Reporter, refusalLine, refusalSentence } from './report.js';

/**
 * The codes that mean commander already printed what was asked for.
 *
 * Two of them are `--help` and `--version` on their way out; the third is the help
 * shown INSTEAD of an error (`mnema` with no verb, `mnema help nothing`), which exits
 * non-zero and has still answered the question a lost caller has.
 */
export const ALREADY_ANSWERED: readonly string[] = [
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
];

/** A usage error, and everything there is to know about it that is not English. */
export interface Misuse {
  /** The command that refused — the only thing that knows what it declared. */
  readonly command: Command;
  /** What commander threw: its code, and the sentence this file does not read. */
  readonly error: CommanderError;
  /** What the caller typed, as the entry received it. */
  readonly typed: readonly string[];
}

/** How one usage error is said, or `undefined` when this file cannot tell. */
type Wording = (misuse: Misuse) => Line | undefined;

/**
 * Every usage error the parser can raise, and the sentence the product says for it.
 *
 * Keyed by commander's code, which is the one part of a `CommanderError` that is an
 * identifier rather than prose. A wording returns `undefined` when it cannot derive
 * what it needs from the declarations — an honest failure that falls through to the
 * shape below rather than guessing at which flag or which argument the caller meant.
 */
const SAID: Readonly<Record<string, Wording>> = {
  'commander.missingArgument': missingArgument,
  'commander.missingMandatoryOptionValue': missingOption,
  'commander.optionMissingArgument': optionNeedsValue,
  'commander.unknownOption': unknownOption,
  'commander.unknownCommand': unknownCommand,
  'commander.excessArguments': excessArguments,
  'commander.invalidArgument': invalidValue,
};

/** The codes this file words, for a guard that counts them. */
export const WORDED: readonly string[] = Object.keys(SAID).sort();

/**
 * What the surface says about one usage error: the sentence, then the line to type.
 *
 * The second line is the `usage()` the help prints, indented — the shape `git` and
 * `gh` answer a misuse with, and the half a reader acts on. It is composed HERE and
 * not by each wording, so the form cannot differ between two codes.
 *
 * A code with no wording falls back to the shape the surface already uses for a
 * refusal nobody worded: the code, then the message it came with. That is the
 * product's own honest default (see `report.ts`) — it never invents a sentence for a
 * no it does not understand, and it never lets one out unframed either.
 */
export function misuseReport(misuse: Misuse): readonly Line[] {
  const said = SAID[misuse.error.code]?.(misuse);
  return said === undefined
    ? [refusalLine(misuse.error.code, misuse.error.message)]
    : [said, fact(usageOf(misuse.command))];
}

/**
 * Gives every command of the program the one voice, and returns the commands it
 * reached.
 *
 * Two things per command, and they are two because commander does them in that
 * order: `outputError` is where its own sentence would reach the stream, and the
 * exit callback is where the CODE finally exists. Swallowing the first and wording
 * the second is what replaces the voice instead of adding a second one.
 *
 * The callback rethrows, so the entry still turns the error into an honest exit code
 * — nothing here decides the exit, and `--help` leaves by the same door it always
 * did.
 */
export function speakUsageErrors(
  program: Command,
  to: Reporter,
  typed: readonly string[],
): readonly Command[] {
  const reached = everyCommandOf(program);
  for (const command of reached) {
    command.configureOutput({ outputError: () => {} });
    command.exitOverride((error) => {
      if (!ALREADY_ANSWERED.includes(error.code)) {
        for (const line of misuseReport({ command, error, typed })) to.io.err(to.render(line));
      }
      throw error;
    });
  }
  return reached;
}

/** The program and every command under it, however deep they are hung. */
export function everyCommandOf(program: Command): readonly Command[] {
  const found: Command[] = [];
  const walk = (command: Command): void => {
    found.push(command);
    for (const child of command.commands) walk(child);
  };
  walk(program);
  return found;
}

// ---------------------------------------------------------------------------
// The wordings — each one reads a declaration, and none reads a message
// ---------------------------------------------------------------------------

/**
 * A required argument was not given: which one, and what the declaration says it is.
 *
 * The missing one is found the way commander finds it — the first required argument
 * with nothing in its position — rather than by reading the name out of the sentence
 * it wrote.
 */
function missingArgument({ command }: Misuse): Line | undefined {
  const missing = command.registeredArguments.find(
    (argument, index) => argument.required && command.args[index] === undefined,
  );
  return missing === undefined
    ? undefined
    : needs(command, spelledArgument(missing), missing.description);
}

/** A `requiredOption` was not given. Its flags and its help are on the declaration. */
function missingOption({ command }: Misuse): Line | undefined {
  const missing = command.options.find(
    (option) => option.mandatory && command.getOptionValue(option.attributeName()) === undefined,
  );
  return missing === undefined ? undefined : needs(command, missing.flags, missing.description);
}

/**
 * A flag that takes a value was given none.
 *
 * commander raises this only when NOTHING followed the flag, so the flag is the last
 * thing on the line — which is what makes it derivable without reading the sentence.
 */
function optionNeedsValue({ command, typed }: Misuse): Line | undefined {
  const last = typed.at(-1);
  const option = last === undefined ? undefined : declaredOption(command, last);
  return option === undefined
    ? undefined
    : needs(command, `a value after ${option.flags}`, option.description);
}

/** A flag no declaration knows. Named from the caller's own line, not from the message. */
function unknownOption({ command, typed }: Misuse): Line | undefined {
  const flag = undeclaredFlag(command, typed);
  return flag === undefined
    ? undefined
    : refusalSentence(`${spoken(command)} does not take ${quoted(flag)}.`);
}

/**
 * A word in the verb's position that names no command.
 *
 * It points at `--help` rather than listing the verbs, which is the sentence the
 * surface already uses when it has somewhere to send the reader ("No mnema project
 * here. Run `mnema init` first.").
 */
function unknownCommand({ command }: Misuse): Line | undefined {
  const asked = command.args[0];
  const name = spoken(command);
  return asked === undefined
    ? undefined
    : refusalSentence(
        `${name} has no command ${quoted(asked)}. Run \`${name} --help\` to see what it does.`,
      );
}

/** More arguments than the command declares. The extra ones are the news. */
function excessArguments({ command }: Misuse): Line | undefined {
  const extra = command.args.slice(command.registeredArguments.length);
  return extra.length === 0
    ? undefined
    : refusalSentence(`${spoken(command)} does not take ${extra.map(quoted).join(', ')}.`);
}

/**
 * A value a declared parser refused: an OPTION's first, then a positional ARGUMENT's.
 *
 * One code, two shapes, and the second only became reachable when a verb declared an
 * argument with `.choices()` (`mnema completion <shell>`). Until then the fall-through
 * was invisible, and what came out of it was commander's own sentence with `error:` still
 * on it — the second voice this file exists to remove, on a brand new verb's only
 * refusal.
 */
function invalidValue(misuse: Misuse): Line | undefined {
  return refusedOptionValue(misuse) ?? refusedArgumentValue(misuse);
}

/**
 * A value an OPTION's parser refused — and the parser's own reason for refusing it.
 *
 * This is the one shape whose message the PRODUCT wrote: `--which " "` is refused by
 * `declaredAgent`, which throws a paragraph explaining that an unset variable would
 * otherwise credit a person for an agent's work, and commander only frames it. Losing
 * that paragraph to a generic sentence would be the one place this file made the
 * surface worse.
 *
 * So the paragraph is recovered from the DECLARATION rather than from the frame: the
 * option's parser is a pure function hanging off the option, and calling it again with
 * the value the caller typed produces the same refusal it produced during the parse.
 * That is also what identifies WHICH option failed when more than one on the line has
 * a parser — the one that throws is the one that threw.
 */
function refusedOptionValue({ command, typed }: Misuse): Line | undefined {
  for (const option of unsetParsers(command)) {
    const value = valueGiven(typed, option);
    if (value === undefined) continue;
    const why = whyRefused(option, value);
    if (why === undefined) continue;
    return refusalSentence(
      `${spoken(command)} does not accept ${quoted(value)} for ${option.flags}`,
      why,
    );
  }
  return undefined;
}

/**
 * A value a positional ARGUMENT's parser refused, and what the help says that argument is.
 *
 * The failing argument is identified the way the option above is — the parser is a pure
 * function on the declaration, so calling it again with what the caller typed reproduces
 * the refusal — but the DETAIL is the declaration's text rather than the thrown message,
 * and that is the one difference. An option's parser here is the product's own and throws
 * a paragraph worth keeping; a `.choices()` parser is commander's and throws commander's
 * English. What the caller has already read is `--help`, which prints the description with
 * the choices after it, so that is what the refusal says: one text, as everywhere else in
 * this file, and the term (`<shell>`) is the help's own too.
 */
function refusedArgumentValue({ command }: Misuse): Line | undefined {
  const help = command.createHelp();
  for (const [index, argument] of command.registeredArguments.entries()) {
    const value = command.args[index];
    if (value === undefined) continue;
    if (whyRefused(argument, value) === undefined) continue;
    return refusalSentence(
      `${spoken(command)} does not accept ${quoted(value)} for ${spelledArgument(argument)}`,
      help.argumentDescription(argument),
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// What the declarations say
// ---------------------------------------------------------------------------

/**
 * `<the command> needs <the thing>: <what the declaration says it is>`.
 *
 * The description is the detail after the colon because that is where the evidence
 * for a statement goes on this surface, and it is omitted where a declaration carries
 * none — an empty half after a colon would be the surface saying it knows something
 * it does not.
 */
function needs(command: Command, what: string, description: string): Line {
  const label = `${spoken(command)} needs ${what}`;
  return description === '' ? refusalSentence(label) : refusalSentence(label, description);
}

/**
 * How the command line spells an argument: `<id>` when it is required, `[id]` when it is
 * not.
 *
 * One site, because two wordings say it — the argument that was missing and the value one
 * refused — and commander's own formatter for it is not public. It is the spelling of the
 * `usage()` printed under both of them, so a reader sees the same token twice.
 */
function spelledArgument(argument: Argument): string {
  return argument.required ? `<${argument.name()}>` : `[${argument.name()}]`;
}

/** The name a caller types to reach this command: `mnema task move`. */
function spoken(command: Command): string {
  const names: string[] = [];
  for (let at: Command | null = command; at !== null; at = at.parent) names.unshift(at.name());
  return names.join(' ');
}

/** The line to type, exactly as this command's own `--help` prints it. */
function usageOf(command: Command): string {
  return command.createHelp().commandUsage(command);
}

/** The option a token names, wherever on the line it is declared. */
function declaredOption(command: Command, token: string): Option | undefined {
  const flag = flagOf(token);
  for (let at: Command | null = command; at !== null; at = at.parent) {
    const found = at.options.find((option) => option.short === flag || option.long === flag);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The first thing on the line that looks like a flag and matches no declaration. */
function undeclaredFlag(command: Command, typed: readonly string[]): string | undefined {
  for (const token of typed) {
    // Everything after `--` is an operand, however it is spelled.
    if (token === '--') return undefined;
    if (!token.startsWith('-') || token === '-') continue;
    if (declaredOption(command, token) === undefined) return token;
  }
  return undefined;
}

/**
 * The options in scope that HAVE a parser and never got a value from the line — the
 * candidates for a value the parser threw on.
 */
function unsetParsers(command: Command): readonly Option[] {
  const found: Option[] = [];
  for (let at: Command | null = command; at !== null; at = at.parent) {
    for (const option of at.options) {
      const unset = at.getOptionValueSource(option.attributeName()) !== 'cli';
      if (option.parseArg !== undefined && unset) found.push(option);
    }
  }
  return found;
}

/** What the caller wrote after a flag, in either spelling (`--x v` or `--x=v`). */
function valueGiven(typed: readonly string[], option: Option): string | undefined {
  for (const [index, token] of typed.entries()) {
    if (token === '--') return undefined;
    const flag = flagOf(token);
    if (flag !== option.short && flag !== option.long) continue;
    const attached = token.slice(flag.length + 1);
    return token.length > flag.length ? attached : typed[index + 1];
  }
  return undefined;
}

/** The flag part of a token, with any attached value cut off. */
function flagOf(token: string): string {
  const cut = token.indexOf('=');
  return cut === -1 ? token : token.slice(0, cut);
}

/**
 * What an option and an argument have in common here: a parser that may refuse.
 *
 * Structural rather than a union of the two classes, because the only thing read is the
 * parser — and a rule written over what is actually used cannot drift from what it needs.
 */
interface Parses {
  readonly parseArg?: <T>(value: string, previous: T) => T;
}

/** Why a declared parser refuses this value, in the parser's own words. */
function whyRefused(declared: Parses, value: string): string | undefined {
  const parse = declared.parseArg;
  if (parse === undefined) return undefined;
  try {
    parse(value, undefined);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : undefined;
  }
}

/**
 * A value the CALLER typed, put on the line safely.
 *
 * Not decoration: it is JSON and not a pair of quotes because a token arrives from
 * a shell and may hold anything. A newline in it would end the refusal and start a
 * line of the reader's own, and an escape byte would style the rest of the report —
 * both of which a no is exactly the wrong line to be exposed to. JSON escapes every
 * control byte, so the value is shown as written and stays on one line.
 */
function quoted(value: string): string {
  return JSON.stringify(value);
}

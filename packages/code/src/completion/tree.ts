/**
 * THE COMMAND TREE, read off the declarations — the one datum three shells render.
 *
 * A completion script is a copy of the command tree written in a shell's dialect, and
 * a copy is the whole difficulty: hand-written, it would list twenty-six verbs and
 * thirty-odd subcommands, and the first pull request to add a verb would leave the
 * script a version behind with nothing failing — a completion that quietly omits a
 * word is indistinguishable from a shell that does not know the word exists. So
 * nothing here is typed twice. The tree is WALKED, once, and what the walk finds is
 * this value.
 *
 * IT IS THE SAME WALK THE PARSER'S REFUSALS USE. `everyCommandOf` (see
 * `wiring/usage.ts`) is what gave every command of the program one voice for a no, and
 * it is what enumerates the commands here — one recursion in this product, not two
 * that could disagree about what a command is. A verb registered tomorrow arrives in
 * all three scripts for the same reason its misuse already answers in the product's
 * voice: nobody has to remember it.
 *
 * WHAT EACH LEVEL OFFERS COMES FROM `--help`'s OWN LISTS. `visibleCommands` and
 * `visibleOptions` are the public accessors commander's help composes from, so the
 * words a Tab offers are the words the help prints — including `-h, --help` and the
 * implicit `help` command, which are accepted everywhere and live in neither
 * `.options` nor `.commands`. A hidden option stays hidden by the same construction.
 *
 * AN OPTION TRAVELS DOWN, because the PARSER lets it: commander accepts an ancestor's
 * option anywhere below the command that declares it (`mnema task move --which …`,
 * which `task`'s help documents in prose precisely because its own option list does
 * not show it). What is offered at a level is therefore what can be TYPED there, not
 * what that level declares — and the rule is that and nothing narrower. Subsetting it
 * by taste (the program's `--color` is noise under a verb, and it is) would leave a
 * reader unable to read an absence: a flag missing from the menu would sometimes mean
 * "not accepted here" and sometimes mean "we thought you would not want it".
 *
 * AND A VALUE IS OFFERED ONLY WHERE THE DECLARATION ENUMERATES IT. That used to mean
 * `--color`'s three whens and this verb's three shells, because a `.choices()` was the
 * only way a declaration could name a set — so the ten workflow actions, the three
 * scopes and the three levels were offered nowhere: they existed as a sentence typed by
 * hand in the help, and reading a sentence to complete a word would be building on the
 * defect. They are now DECLARED (`wiring/vocabulary.ts`) without being validated by the
 * parser, and this file reads both channels ({@link enumeratedBy}). What is still never
 * offered is an ID: it is in no declaration, and the only way to know one is to run
 * mnema, whose floor is ~95 ms on this machine. A Tab that cost more than the command it
 * is helping you type would be a worse defect than the one this file exists to fix.
 *
 * NOTHING HERE IS SHELL. The three renderers own the quoting, and a value is a value
 * until one of them writes it out — which is what lets the same tree be asserted once
 * and rendered three ways (the shape `presentation/` already uses for a line).
 */

import type { Argument, Command, Help, Option } from 'commander';
import { everyCommandOf } from '../wiring/usage.js';
import { valuesDeclaredOn } from '../wiring/vocabulary.js';

/** One flag, in every spelling the parser answers to, and what may follow it. */
export interface CompletionFlag {
  /** The short spelling (`-h`), when the declaration has one. */
  readonly short: string | undefined;
  /** The long spelling (`--help`), when the declaration has one. */
  readonly long: string | undefined;
  /** Whether the parser expects a value after it. */
  readonly takesValue: boolean;
  /** The values the declaration enumerates. Empty when it enumerates none. */
  readonly choices: readonly string[];
}

/** One word a caller can type, and the one-line description of what it does. */
export interface CompletionWord {
  /** The word itself — a verb, a subcommand. */
  readonly word: string;
  /** What the declaration says it does, on one line. Empty when it says nothing. */
  readonly description: string;
}

/** One command of the program, and everything that can be typed after it. */
export interface CompletionNode {
  /** The words that reach it, joined by a space. Empty for the program itself. */
  readonly path: string;
  /** The subcommands offered here, in the order the help lists them. */
  readonly commands: readonly CompletionWord[];
  /** Every flag the parser accepts here — this command's, and its ancestors'. */
  readonly flags: readonly CompletionFlag[];
  /** The values a positional argument enumerates, when one does. */
  readonly values: readonly string[];
}

/** The whole tree: the command it completes, and every node under it. */
export interface CompletionTree {
  /** The name a caller types — `mnema`. */
  readonly command: string;
  /** Every command, the program first, then depth-first in declaration order. */
  readonly nodes: readonly CompletionNode[];
}

/** Reads the tree off a configured program. Pure: it parses nothing and runs nothing. */
export function completionTree(program: Command): CompletionTree {
  return {
    command: program.name(),
    nodes: everyCommandOf(program).map((command) => nodeOf(command)),
  };
}

/** What can be typed after one command. */
function nodeOf(command: Command): CompletionNode {
  const help = command.createHelp();
  return {
    path: pathOf(command).join(' '),
    commands: help.visibleCommands(command).map((child) => ({
      word: child.name(),
      description: oneLine(child.description()),
    })),
    flags: flagsInScopeOf(command),
    values: command.registeredArguments.flatMap((argument) => enumeratedBy(argument)),
  };
}

/**
 * The values a declaration enumerates, from BOTH channels — and there are two because
 * they mean two different things.
 *
 * `argChoices` is commander's own, and it comes with validation: the parser refuses
 * anything else before an action runs. That is right for a vocabulary the SURFACE owns
 * (`--color`, `completion <shell>`) and wrong for one the DOMAIN owns, where the gate
 * is what refuses and answers with a typed code (`UNKNOWN_ACTION`). So the domain's sets
 * arrive through `wiring/vocabulary.ts` instead, declared and never validated.
 *
 * A Tab cannot tell the difference and should not: both are "the words the declaration
 * says go here". A declaration has one channel or the other, never both — the union is
 * written this way so that a day it has both, the offer is still everything it accepts.
 */
function enumeratedBy(declaration: Argument | Option): readonly string[] {
  return [...(declaration.argChoices ?? []), ...valuesDeclaredOn(declaration)];
}

/** The words that reach a command, without the program's own name. */
function pathOf(command: Command): readonly string[] {
  const names: string[] = [];
  for (let at: Command | null = command; at.parent !== null; at = at.parent) {
    names.unshift(at.name());
  }
  return names;
}

/**
 * Every flag the parser accepts at a command: its own first, then each ancestor's.
 *
 * The nearest declaration wins a name, which matters for exactly one flag today —
 * `-h, --help` is declared by every command — and would matter for any other the day
 * a subcommand narrowed one.
 */
function flagsInScopeOf(command: Command): readonly CompletionFlag[] {
  const found: CompletionFlag[] = [];
  const seen = new Set<string>();
  for (let at: Command | null = command; at !== null; at = at.parent) {
    for (const option of visibleOptionsOf(at)) {
      const name = option.long ?? option.short ?? option.flags;
      if (seen.has(name)) continue;
      seen.add(name);
      found.push({
        short: option.short,
        long: option.long,
        takesValue: option.required || option.optional,
        choices: enumeratedBy(option),
      });
    }
  }
  return found;
}

/** The options one command's own help would print. */
function visibleOptionsOf(command: Command): readonly Option[] {
  const help: Help = command.createHelp();
  return help.visibleOptions(command);
}

/**
 * A declaration's text on one line.
 *
 * It is NOT the `oneLine` of `served-patterns.ts`, and the difference is the threat,
 * not the mechanism: there, a newline inside RECORDED text forges an item in a list of
 * records, and the helper carries the argument for why that class is the class. Here a
 * newline would end a line of shell and start one the shell would try to run. They are
 * also two modules with different budgets — that one reaches `@mnema/copilot`, and this
 * one may not load the domain at all: the script it writes is generated on every
 * interactive shell start.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

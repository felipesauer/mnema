/**
 * WHO THE SESSION IS ASKING AS — the identity it already knows, typed into the line for
 * the caller.
 *
 * IT CAME OUT OF USE. Somebody typed `status` at the prompt and was told the verb needs
 * `--actor <id>`, with a box two rows above it naming the identity in question. The
 * console was asking for what it had just printed.
 *
 * WHY THE VERB ASKS AT ALL IS A GOOD ARGUMENT AND IT IS UNTOUCHED. The record carries no
 * notion of a "current actor" — a `who` is only ever stamped on past events — and the
 * only way to derive this machine's `who` from nothing is to open a WRITER, which founds
 * a tree and mints a key on a machine that has none. That is a write door, an invocation
 * of this CLI has no session to read an identity from, and so the flag is required (see
 * `commands/focus.ts`, where the argument is written out in full). None of that changes
 * here: the declaration is the same declaration, and `mnema status` at a shell refuses
 * exactly as it did.
 *
 * WHAT CHANGES IS THAT A SESSION IS NOT AN INVOCATION. The console resolved this
 * identity when it opened, from LOCAL MATERIAL and without opening a writer — the key
 * this installation holds, and the anchor it recorded for this tree (`standing.ts`) —
 * because the opening panel says where the session is standing. So the value is already
 * in hand, it cost what it cost once, and a prompt that then demanded it be typed back
 * would be a surface asking a question it had already answered.
 *
 * IT IS A DEFAULT AND NEVER A DECISION. What the caller typed WINS, always: asking
 * about another identity is a legitimate thing to do at an audit prompt, and the value
 * here only fills the silence. And when the session knows nobody — outside a project, or
 * on a machine whose key root names no single key — nothing is filled and the verb asks
 * the way it always has, in the same words. Inventing an identity would be worse than
 * the question.
 *
 * AND IT TYPES WHAT THE PAGE SHOWS, byte for byte: the short form the panel is drawn
 * with. That is the whole of why it needs no rule of its own about what a good value is —
 * the line it produces is the line the caller would have typed by copying what was in
 * front of them, so it earns the same answer, including the refusals. A prefix two
 * identities of the record share is refused, by name, with both candidates in the
 * sentence (`anchors.ts`), which is the product's existing answer and not a new one.
 *
 * NOTHING HERE READS ANYTHING. It is a function from a typed line and the declarations
 * to the line that runs, and the identity arrives as a value the session already had —
 * the count that says this surface reads once, when it opens, is what holds that
 * (`tests/the-name-and-the-hints.test.ts`).
 */

import type { Command } from 'commander';
import type { Declared } from '../wiring/verb.js';

/**
 * The flag a verb asks the asker's identity with.
 *
 * ONE SPELLING, and the rule is about the DECLARATION rather than about this string: what
 * is filled is a MANDATORY option by this name, so a flag that merely takes an identity —
 * `accountability --who`, which filters an audit by one — is left alone. That one has a
 * default and the default is everybody, and a console that quietly turned "who authorized
 * these facts" into "which of them are mine" would be answering a different question in
 * the caller's name.
 */
const ASKS_WHO_IS_ASKING = '--actor';

/** Where a caller stops the parser reading flags. Everything after it is a word. */
const END_OF_THE_FLAGS = '--';

/**
 * The line that runs, given what the caller typed, what the verbs of THIS program
 * declared, and who the session is — which is `undefined` when it cannot say.
 *
 * ONE FUNCTION FOR EVERY VERB THAT ASKS, and the verbs are found by the declaration
 * rather than named here. Four of them require an identity today
 * (`tests/the-session-knows-who-you-are.test.ts` enumerates them off the program and
 * holds each one to this), and a fifth added tomorrow is served the day it declares.
 */
export function asTheSession(
  argv: readonly string[],
  verbs: readonly Declared[],
  identity: string | undefined,
): readonly string[] {
  if (identity === undefined) return argv;
  // Where the parser stops reading flags. What comes after `--` is a word, so an
  // `--actor` typed there is not the caller naming an identity, and a value put there
  // would not be read as one either — which is why it is both where the line is READ for
  // one and where the filled one goes.
  const at = endOfTheFlags(argv);
  if (argv.slice(0, at).some(names)) return argv;
  if (!asksWhoIsAsking(reached(argv, verbs))) return argv;
  return [...argv.slice(0, at), ASKS_WHO_IS_ASKING, identity, ...argv.slice(at)];
}

/** Where the flags end: at `--`, or at the end of the line when there is none. */
function endOfTheFlags(argv: readonly string[]): number {
  const at = argv.indexOf(END_OF_THE_FLAGS);
  return at === -1 ? argv.length : at;
}

/** Whether a word IS the flag — either spelling commander accepts for one. */
function names(word: string): boolean {
  return word === ASKS_WHO_IS_ASKING || word.startsWith(`${ASKS_WHO_IS_ASKING}=`);
}

/**
 * The commands this line reaches: the verb it begins with, and each subcommand under it
 * the words then name.
 *
 * BOTH ENDS ARE ASKED because commander declares an option on either. A group's option is
 * given to the group wherever it appears on the line (`wiring/options.ts` says so where
 * the reminder for one is written), and a subcommand's is the subcommand's — so a line
 * that reaches a level requires whatever any level of it requires. Walking DOWN rather
 * than over every command there is is what keeps a flag declared on one subcommand from
 * being typed into its sibling, which the parser would then refuse as a flag it does not
 * take.
 *
 * A word that names no subcommand ends the walk, and a flag is stepped over — the same
 * shape the completer walks the same tree with (`complete.ts`). It is not a parse: a
 * VALUE that happens to spell a subcommand's name would be walked into, which costs
 * nothing today (no verb that asks for an identity has a subcommand at all) and is the
 * honest limit of reading a line without parsing it.
 */
function reached(argv: readonly string[], verbs: readonly Declared[]): readonly Command[] {
  const verb = verbs.find((declared) => declared.command.name() === argv[0])?.command;
  if (verb === undefined) return [];
  const commands = [verb];
  let at = verb;
  for (const word of argv.slice(1)) {
    if (word.startsWith('-')) continue;
    const next = at.commands.find(
      (child) => child.name() === word || child.aliases().includes(word),
    );
    if (next === undefined) break;
    commands.push(next);
    at = next;
  }
  return commands;
}

/** Whether any command the line reached REQUIRES the identity of whoever is asking. */
function asksWhoIsAsking(commands: readonly Command[]): boolean {
  return commands.some((command) =>
    command.options.some((option) => option.mandatory && option.long === ASKS_WHO_IS_ASKING),
  );
}

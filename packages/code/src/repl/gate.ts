/**
 * WHAT A SESSION DOES WITH A TYPED LINE — the whole language of the read-only
 * session, decided by one total function over the verbs' own declarations.
 *
 * THE RULE IS DEFAULT-DENY AND IT IS NOT A LIST. A line runs only when the word it
 * begins with names a verb that declared `reads` (`wiring/verb.ts`). Everything else is
 * refused: a verb that declared `mutates`, a word no verb answers to, a command hung on
 * the program by some path that carries no declaration, a line that is nothing but
 * flags. A list of allowed verbs kept here would be the thing that goes stale the one
 * time it matters — somebody adds a write, nobody remembers this file, and a session
 * advertised as read-only records something. Reading the declaration means the verb
 * added tomorrow is refused because nobody classified it as a read, which is the
 * property this had to have before it could be built at all.
 *
 * WHICH IS WHY THE DECLARATIONS ARRIVE FROM THE PROGRAM THAT WILL PARSE THE LINE. The
 * session hands over what `buildProgram` returned for THIS line, so what is decided
 * about and what is run are the same registration. Registering the verbs into a program
 * of its own would answer about a program nobody runs — and a command that reached the
 * real one by another path would carry no declaration, fall on the deny side, and be
 * refused rather than quietly executed. Both halves of that come from the same sentence.
 *
 * NOTHING HERE PARSES A LINE IT HAS NOT ALLOWED. The disposition is decided from the
 * first word alone; commander never sees a refused line. That is deliberate: "commander
 * would have thrown before dispatch anyway" is an argument about somebody else's code,
 * and a session that leaned on it would be one dependency upgrade away from being wrong
 * about the only thing it promises.
 *
 * IT IS NOT A SHELL, and the tokenizer below is the whole of what it understands:
 * whitespace separates, quotes group, a backslash escapes. No expansion, no globbing,
 * no pipes, no redirection — a `|` is a word like any other and the verb refuses it as
 * an argument it does not take. Anything more would be a second way to run a command,
 * which is the shape this series exists to remove.
 */

import type { Declared } from '../wiring/verb.js';

/** The prefix that tells a word of the SESSION from a verb of the product. */
const DOT = '.';

/** Leave the session. The spelling `node`, `python` and `psql` all answer to. */
export const LEAVE = `${DOT}exit`;

/** What this session runs, and how to leave it. Named the same way, for the same reason. */
export const ABOUT = `${DOT}help`;

/**
 * The words the session answers to itself, in the order {@link ABOUT} lists them.
 *
 * Two, and the dot is what makes them un-collidable: every verb of the product is
 * lowercase letters and dashes, so no word here can ever shadow one, and no verb added
 * later can shadow one of these. A session that had to disambiguate its own commands
 * from the product's would be a session with a precedence rule nobody asked for.
 */
export const SESSION_WORDS: readonly string[] = [ABOUT, LEAVE];

/** Whether the session goes on after a line, or closes. */
export type AfterLine = 'go on' | 'leave';

/** What the session does with one typed line. Closed, and total over what can be typed. */
export type Disposition =
  /** The line was blank. Nothing happened and nothing is said about it. */
  | { readonly does: 'nothing' }
  /** The line names a read. It is parsed, by the program the declarations came from. */
  | { readonly does: 'run'; readonly argv: readonly string[] }
  /** `.exit`, or the end of input. The session closes. */
  | { readonly does: 'leave' }
  /** `.help`. The session says what it runs. */
  | { readonly does: 'about' }
  /** Anything else, worded for the caller. `detail` is the half after the colon. */
  | { readonly does: 'refuse'; readonly sentence: string; readonly detail?: string };

/**
 * The verbs a session OFFERS: everything declared `reads`, minus the session's own verb.
 *
 * One function, because two consumers ask the same question and a second derivation
 * would be a menu that disagrees with the gate — a Tab offering what the next line
 * refuses. The completer reads it to decide what to offer ({@link
 * completerFor}); {@link dispositionOf} reads it to decide what to run.
 *
 * THE SESSION'S OWN VERB IS EXCLUDED, and it is the one exclusion here that is not the
 * declaration's. `repl` declares `reads` and it is telling the truth — it records
 * nothing — but opening a session inside a session hands one terminal to two readers of
 * the same keystrokes. It is excluded by IDENTITY (the caller passes the name it was
 * registered under) rather than by a literal, so a rename cannot leave the exclusion
 * pointing at nothing.
 */
export function verbsOffered(verbs: readonly Declared[], self: string): readonly string[] {
  return verbs
    .filter((verb) => verb.effect === 'reads' && verb.command.name() !== self)
    .map((verb) => verb.command.name());
}

/**
 * What the session does with `line`, given what the verbs of THIS program declared and
 * the name the session itself was registered under.
 *
 * Total: every string reaches exactly one arm. The refusals are worded here rather than
 * at the loop, because the loop's job is to read a line and print one, and a rule about
 * what a session accepts that lived next to a `while` would be a rule nobody could test
 * without a terminal.
 */
export function dispositionOf(line: string, verbs: readonly Declared[], self: string): Disposition {
  if (line.trim().length === 0) return { does: 'nothing' };

  const argv = argvOf(line);
  if (argv === undefined) {
    return {
      does: 'refuse',
      sentence: 'This line has a quote that is never closed',
      detail: 'Close it, or drop it — the session groups words with quotes and nothing else.',
    };
  }

  // Nothing survived the tokenizer, which a line of quotes alone can do.
  const first = argv[0];
  if (first === undefined) return { does: 'nothing' };
  if (first === LEAVE) return excess(first, argv) ?? { does: 'leave' };
  if (first === ABOUT) return excess(first, argv) ?? { does: 'about' };

  const offered = verbsOffered(verbs, self);
  if (offered.includes(first)) return { does: 'run', argv };

  // The deny side, worded from what the declarations say about the word that was typed.
  // The DECISION was made above and it is one membership test; what follows only
  // chooses which true sentence to say, so a wording that fell through could never
  // widen what the session runs.
  const declared = verbs.find((verb) => verb.command.name() === first);
  if (declared?.effect === 'mutates') {
    return {
      does: 'refuse',
      sentence: `\`${first}\` can change the record, and this session only reads it`,
      detail: `Leave with \`${LEAVE}\` and run \`mnema ${first}\` from your shell.`,
    };
  }
  if (first === self) {
    return {
      does: 'refuse',
      sentence: 'A session is already open here',
      detail: `Leave this one with \`${LEAVE}\` before opening another.`,
    };
  }
  return {
    does: 'refuse',
    sentence: `This session does not run \`${first}\``,
    detail: `It runs the reads of the record — \`${ABOUT}\` lists them.`,
  };
}

/** A word of the session's own with anything after it: refused, rather than ignored. */
function excess(word: string, argv: readonly string[]): Disposition | undefined {
  return argv.length === 1
    ? undefined
    : {
        does: 'refuse',
        sentence: `\`${word}\` takes nothing after it`,
        detail: 'Type it on its own.',
      };
}

/**
 * A typed line as the argv a parser receives, or `undefined` when a quote is left open.
 *
 * Whitespace separates a word, `'` and `"` group one, and a backslash outside quotes
 * escapes the next character. That is the whole grammar, and the omissions are the
 * point: no variable is expanded, no glob is matched, no `|` redirects anything. A
 * session that expanded `$HOME` would be answering with a value the caller's shell
 * chose, in a product whose every other line is a fact read off a record.
 *
 * An unclosed quote is `undefined` rather than a best guess, because the two ways to
 * guess are both wrong in a way the caller cannot see: closing it silently runs a
 * command with an argument they did not finish typing, and dropping the quote runs one
 * with a different argument.
 */
export function argvOf(line: string): readonly string[] | undefined {
  const argv: string[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let at = 0; at < line.length; at++) {
    const char = line[at] as string;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === '\\' && at + 1 < line.length) {
      word += line[++at] as string;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) argv.push(word);
      word = '';
      started = false;
      continue;
    }
    word += char;
    started = true;
  }
  if (quote !== undefined) return undefined;
  if (started) argv.push(word);
  return argv;
}

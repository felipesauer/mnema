/**
 * THE COMMAND HANDED OVER RUNS AS HANDED — every `mnema …` the product gives a person to type, in
 * a sentence it prints or on a page it publishes, passes the parser once its markers are filled,
 * with nothing added.
 *
 * WHAT WAS WRONG, AND WHAT HID IT. The refusal of a key the record proves in two identities, and
 * the page beside it, handed a person `mnema key revoke <fingerprint>` as the way out. The verb
 * requires `--reason`, so the words, copied as they stood, were refused by the parser (exit 1,
 * `mnema key revoke needs --reason <text>`). Three readings stood near it and none could see it:
 * the case that ran the way out appended `--reason` before running it; the guard over published
 * shell (`the-shell-a-page-publishes-is-the-shell-that-runs.test.ts`) asks whether a verb and a
 * flag EXIST, never whether a line is WHOLE, and it read fenced blocks only, on the premise that a
 * span inside a sentence is a reference rather than a line to type; and nothing read the
 * sentences the product itself prints.
 *
 * THE CLASS HAD MORE SITES THAN THE ONE THAT WAS FOUND, and the discriminant found them — a
 * backtick followed by `mnema `, over every literal of the source and every tracked page, tests
 * included in the sweep. `run end` requires `--which <agent>` and was handed without it in four
 * places: the sentence `run start` prints, the runs contract four tool descriptions carry to the
 * agent, a sentence on the page, and a BLOCK on the page — the one a reader copies to close the
 * session the block opened. And the discriminant has a blind spot of its own: the product also
 * hands commands over WITHOUT backticks. `key request` prints `mnema key enroll <the line>` alone
 * on a line, the `--help` pages print examples, and `status` prints `— mnema decision import
 * <dir>`. Those are read here too.
 *
 * WHAT IS CHECKED. Each command is read the way the shell reads it
 * (`support/reading-a-shell-line.ts`), with every MARKER — `<id>`, `<the line>`, `"<why>"`, a
 * template's `${…}` — filled with a value and nothing else changed, and it is then one of four
 * things:
 *   - a LINE, which hands the verb something. It must pass commander's own parser WHOLE: every
 *     argument and option the verb requires is there, and nothing the verb does not take.
 *   - a verb's NAME: its path and nothing more (`mnema verify`, `mnema key revoke`). It names a
 *     verb this program has, or it would have been read as a line and refused.
 *   - a flag's NAME: a path and one option that takes a value, with none (`mnema mcp --project`).
 *     The option exists where it was typed, or the same.
 *   - a command whose VERB IS NOT WRITTEN (`mnema <verb>`, a template's `mnema ${first}`). Nothing
 *     can be checked, so each such site is on {@link THE_VERB_IS_NOT_WRITTEN}, reconciled with
 *     the corpus in both directions.
 *
 * THE PARSER IS COMMANDER'S, OVER THE PROGRAM'S DECLARATIONS AND NOTHING ELSE. A line is parsed by
 * a MIRROR of the program `buildProgram` builds: the same commands, arguments and options, with
 * no action body and no hook — so nothing here opens a record, reads a home or runs a verb — and
 * with no value parser, because a value is exactly what a marker does not know. Where the real
 * program refuses a line before anything runs, the mirror is asked to refuse it with the same
 * code, and a case below holds that.
 *
 * WHAT IT DOES NOT CHECK IS WRITTEN DOWN, in {@link NOT_CHECKED}, one entry per class with the
 * reason on it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Argument, Command, CommanderError, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { everyCommandOf } from '../src/wiring/misuse.js';
import { ROOT } from './support/published-examples.js';
import { invocationsIn, linesOf, trackedPages, unquoted } from './support/reading-a-shell-line.js';
import { codeOnly, INTERPOLATED, LITERAL_EDGE, literalsOnly } from './support/reading-source.js';

/** A silent port: nothing here runs a verb, it only reads what they declare. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

// ---------------------------------------------------------------------------
// Where a command is handed over
// ---------------------------------------------------------------------------

/** A command the product hands a person, and where it was found. */
interface Handed {
  /** `path:line`, so a failure is clickable. */
  readonly where: string;
  /** A code span in a page's prose, a line in one of its blocks, or a literal of the source. */
  readonly from: 'span' | 'block' | 'source';
  /** The command as it is handed over, markers and all. */
  readonly text: string;
}

/** A command a reading could not take whole: a span that opens and never closes. */
interface Unreadable {
  readonly where: string;
  readonly text: string;
}

/**
 * The pages that are EVIDENCE rather than documentation. What their commands say is what was typed
 * in a round that already ran, so rewriting one rewrites the evidence. See
 * {@link NOT_CHECKED}`.MEASUREMENTS_ARE_EVIDENCE`.
 */
const EVIDENCE = 'measurements/';

/** A code span that opens with the program's name. */
const SPAN = /`(mnema [^`]*)`/g;

/** A backtick that opens `mnema ` and is still open — what is left once {@link SPAN} is removed. */
const OPENS = /`mnema /;

/**
 * Every command a page hands over: the code spans of its prose, and the command lines of its blocks.
 *
 * PROSE IS READ BY THE PARAGRAPH, NOT BY THE LINE, because that is how Markdown reads a code span:
 * one may run across a line break — which a reader sees as a space — and never across a blank
 * line. Read by the line, `plugin/README.md` hands over `mnema switch off` and loses the
 * `brief-document` on the next line; the first run of this guard found that, as a span it could
 * not close.
 *
 * A pipe inside a code span in a TABLE is written `\|`, which is how Markdown keeps it from ending
 * the cell; a reader sees `|`, so that is what is read.
 */
export function handedOnPage(
  page: string,
  markdown: string,
): { handed: Handed[]; unreadable: Unreadable[] } {
  const handed: Handed[] = [];
  const unreadable: Unreadable[] = [];
  let paragraph: { at: number; source: string }[] = [];
  const readTheParagraph = (): void => {
    const [first] = paragraph;
    if (first === undefined) return;
    const text = paragraph.map((line) => line.source).join('\n');
    const lineOf = (index: number): string =>
      `${page}:${first.at + text.slice(0, index).split('\n').length - 1}`;
    for (const match of text.matchAll(SPAN)) {
      const words = (match[1] as string).replace(/\s*\n\s*/g, ' ').replaceAll('\\|', '|');
      handed.push({ where: lineOf(match.index), from: 'span', text: words });
    }
    const open = OPENS.exec(text.replace(SPAN, (span) => ' '.repeat(span.length)));
    if (open !== null) unreadable.push({ where: lineOf(open.index), text: shown(text) });
    paragraph = [];
  };
  for (const { at, fence, source } of linesOf(markdown)) {
    if (fence !== null) {
      readTheParagraph();
      // The LINE, not the words the shell reading takes from it: a marker is filled before the
      // line is read, and a `<id>` read first would be a redirection that hides what it stands for.
      if (invocationsIn(source).length > 0) {
        handed.push({ where: `${page}:${at}`, from: 'block', text: source.trim() });
      }
      continue;
    }
    if (source.trim() === '') readTheParagraph();
    else paragraph.push({ at, source });
  }
  readTheParagraph();
  return { handed, unreadable };
}

/** A command at the head of a line of literal text — one the product prints with no backtick. */
const AT_THE_HEAD = /^\s*(mnema ([a-z][a-z-]*)[^`\n]*)/;

/** …or after the dash `status` puts between a thing and the command that reads it. */
const AFTER_A_DASH = /— (mnema ([a-z][a-z-]*)[^`\n]*)/;

/**
 * Every command a source file hands over, read off what its string and template literals SAY
 * (`literalsOnly`) — never off its comments, which are handed to nobody.
 *
 * A literal is one piece of text: a span has to open and close inside one, and a span that runs
 * into the edge of its literal is reported as unreadable rather than guessed at — the words on
 * the other side of a `+` are the program's to choose, and a reading that joined them would be
 * reading a line nobody can see in the source.
 *
 * A command with no backtick is read only where it cannot be prose: at the head of a line of text,
 * or after `status`'s dash, and only when the word after `mnema` is one of the program's verbs —
 * which is what keeps `mnema is append-only`, a sentence about the product, out of it.
 */
export function handedInSource(
  file: string,
  source: string,
  verbs: ReadonlySet<string>,
): { handed: Handed[]; unreadable: Unreadable[] } {
  const handed: Handed[] = [];
  const unreadable: Unreadable[] = [];
  let line = 1;
  for (const piece of literalsOnly(source).split(LITERAL_EDGE)) {
    const firstLine = line;
    line += piece.split('\n').length - 1;
    if (!piece.includes('mnema ')) continue;
    const lineOf = (index: number): string =>
      `${file}:${firstLine + piece.slice(0, index).split('\n').length - 1}`;
    for (const match of piece.matchAll(SPAN)) {
      handed.push({ where: lineOf(match.index), from: 'source', text: match[1] as string });
    }
    const left = piece.replace(SPAN, (span) => ' '.repeat(span.length));
    const open = OPENS.exec(left);
    if (open !== null) unreadable.push({ where: lineOf(open.index), text: shown(piece.trim()) });
    let at = 0;
    for (const line of left.split('\n')) {
      for (const shape of [AT_THE_HEAD, AFTER_A_DASH]) {
        const found = shape.exec(line);
        if (found === null || !verbs.has(found[2] as string)) continue;
        const command = (found[1] as string).split(/\s{2,}/)[0] as string;
        handed.push({ where: lineOf(at + line.indexOf(command)), from: 'source', text: command });
      }
      at += line.length + 1;
    }
  }
  return { handed, unreadable };
}

/**
 * A command as a failure prints it: whitespace collapsed, and what the program interpolates shown
 * as `{}` — the spelling `the-phrase-the-domain-words-is-one-line.test.ts` already gives a hole.
 */
function shown(text: string): string {
  return text.replaceAll(INTERPOLATED, '{}').replace(/\s+/g, ' ').trim();
}

/** The source that ships and speaks: every package's `src`, tests out, and the plugin's hooks. */
function speakingSources(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'packages/*/src/*.ts', 'plugin/*.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path !== '' && !path.endsWith('.test.ts'))
    .sort();
}

// ---------------------------------------------------------------------------
// What a command is, once its markers are filled
// ---------------------------------------------------------------------------

/** A marker for what a person fills in: `<id>`, `<the line>`, `<path...>`. */
const MARKER = /<[a-z][a-z0-9 .-]*>/g;

/** One word standing where a marker or an interpolation was — no shell reads it as anything. */
const FILLED = '‹filled›';

/** What a reading of one command said it is. */
type Reading =
  | { readonly kind: 'line'; readonly argv: readonly string[] }
  | { readonly kind: 'name'; readonly path: readonly string[] }
  | { readonly kind: 'flag'; readonly path: readonly string[]; readonly flag: string }
  | { readonly kind: 'unwritten' };

/** The option a flag names at `command` — looked up the way commander looks it up, up the chain. */
function optionAt(command: Command, flag: string): Option | undefined {
  for (let at: Command | null = command; at !== null; at = at.parent) {
    const found = at.options.find((one) => one.long === flag || one.short === flag);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Every `mnema` invocation a command text holds, each read as one of the four things the header
 * names. The markers are filled BEFORE the shell reads the text, as a person types them: a quoted
 * marker is one word, and `<` in a marker is never read as a redirection.
 */
export function readingsOf(program: Command, text: string): readonly Reading[] {
  const filled = text.replace(MARKER, FILLED).replaceAll(INTERPOLATED, FILLED);
  return invocationsIn(filled).map((words): Reading => {
    const [first] = words;
    if (first?.includes(FILLED)) return { kind: 'unwritten' };
    let command = program;
    const path: string[] = [];
    for (const word of words) {
      const child = command.commands.find((one) => one.name() === word);
      if (child === undefined) break;
      command = child;
      path.push(word);
    }
    const rest = words.slice(path.length);
    if (rest.length === 0 && path.length > 0) return { kind: 'name', path };
    const [flag] = rest;
    if (rest.length === 1 && flag !== undefined && flag.startsWith('-') && !flag.includes('=')) {
      const option = optionAt(command, flag);
      if (option !== undefined && (option.required || option.optional)) {
        return { kind: 'flag', path, flag };
      }
    }
    return { kind: 'line', argv: words.map((word) => unquoted(word).replaceAll(FILLED, 'x')) };
  });
}

// ---------------------------------------------------------------------------
// The parser, over the declarations alone
// ---------------------------------------------------------------------------

/**
 * The commands of the program that were handed an action of their own — read by watching the
 * public `action()` while the program is built, and not out of commander's private field.
 *
 * It is the one thing the mirror cannot read back from a declaration: `witness` and `switch` act
 * AND hold subcommands, while `key` only holds its verbs, and a mirror that gave both the same
 * answer would either refuse a bare `mnema switch` or accept a bare `mnema key`. This read
 * `_actionHandler`, which commander does not publish and may rename in any release; the method
 * that sets it is published, so the watch is on that.
 */
const ACTING = new WeakSet<Command>();

/** Builds the program with every `action()` it declares seen, so {@link actsOnItsOwn} can ask. */
function watchedProgram(): Command {
  const real = Command.prototype.action;
  Command.prototype.action = function action(this: Command, fn: (...args: never[]) => unknown) {
    ACTING.add(this);
    return real.call(this, fn as Parameters<typeof real>[0]);
  } as typeof real;
  try {
    return buildProgram(silent).program;
  } finally {
    Command.prototype.action = real;
  }
}

/** Whether a command runs an action of its own. */
function actsOnItsOwn(command: Command): boolean {
  return ACTING.has(command);
}

/** How commander spells an argument it declares: `<id>`, `[id]`, `<path...>`. */
function spelled(argument: Argument): string {
  const name = `${argument.name()}${argument.variadic ? '...' : ''}`;
  return argument.required ? `<${name}>` : `[${name}]`;
}

/**
 * The program as its declarations describe it, and no more: every command, argument and option,
 * whether an option is mandatory and what it defaults to, the version, and whether a command acts
 * — with an empty body where it does, no hook anywhere, and no parser on any value.
 */
export function mirrorOf(real: Command): Command {
  const copy = new Command(real.name());
  copy.exitOverride();
  copy.configureOutput({ writeOut: () => {}, writeErr: () => {}, outputError: () => {} });
  const version = real.version();
  if (version !== undefined) copy.version(version);
  for (const argument of real.registeredArguments)
    copy.addArgument(new Argument(spelled(argument)));
  for (const option of real.options) {
    if (version !== undefined && option.attributeName() === 'version') continue;
    const copied = new Option(option.flags);
    if (option.mandatory) copied.makeOptionMandatory();
    if (option.defaultValue !== undefined) copied.default(option.defaultValue);
    copy.addOption(copied);
    // ANSWERED LIKE THE VERSION: the program answers `--identify` from a listener of its own and
    // ends with exit 0 before any verb (`cli.ts`), which no declaration can be read back as.
    if (option.attributeName() === 'identify') {
      copy.on('option:identify', () => {
        throw new CommanderError(0, 'mnema.identify', '');
      });
    }
  }
  if (actsOnItsOwn(real)) copy.action(() => {});
  for (const child of real.commands) copy.addCommand(mirrorOf(child));
  return copy;
}

/**
 * What commander says about a line: nothing when it takes it whole — which includes asking for
 * help or for the version, the two answers that end with exit 0 — and its own refusal otherwise.
 * The mirror is built fresh for every line, so no option a line set can satisfy the next one.
 */
export function refusalOf(program: Command, argv: readonly string[]): CommanderError | undefined {
  try {
    mirrorOf(program).parse([...argv], { from: 'user' });
    return undefined;
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    return error.exitCode === 0 ? undefined : error;
  }
}

// ---------------------------------------------------------------------------
// The limits, written down
// ---------------------------------------------------------------------------

/**
 * Every site whose command does not write its verb, and why nothing is lost by not checking it.
 * Keyed by the file and the command as the source spells it — never by line, which moves.
 */
export const THE_VERB_IS_NOT_WRITTEN: Readonly<Record<string, string>> = {
  'packages/code/src/repl/gate.ts: mnema {}':
    'The console refuses a verb that writes and says to run it from the shell instead. The verb is the word the person typed, which the console has just matched against the declarations — it names a verb of this program by construction, and what it takes is what the person already typed.',
  'packages/code/src/repl/session.ts: mnema {}':
    'The console asked for with no terminal names itself: the interpolation is the console’s own verb, read from the declaration that registered it, so it is a verb of this program by construction and it takes nothing.',
  'packages/code/src/repl/session.ts: mnema <verb>':
    'The same refusal tells a person with a pipe to run the verb itself — any verb. `<verb>` stands for the whole program, and there is no single line to parse: every verb’s own line is checked where that verb is handed over.',
};

/** What a handed-over command carries that this guard does NOT rule on, and why each one. */
export const NOT_CHECKED: Readonly<Record<string, string>> = {
  MEASUREMENTS_ARE_EVIDENCE:
    'Pages under `measurements/` are the protocols and results of rounds that already ran. What their commands say is what was typed then — `round-3/arms.md` publishes `mnema switch --off edit-rules-push`, which the program never had — and rewriting one rewrites the evidence of what was measured.',
  A_NAME_IS_NOT_A_LINE:
    'A verb’s bare path is read as its NAME, and a name is checked only for naming a verb — the reading cannot tell a name from an instruction to type a bare line (one of the first twenty WAS one: `run start`’s "`mnema run end` closes it", a line now). So every name whose verb requires more than its path is on {@link NAMES_THAT_NEED_MORE}, looked at one by one with the reason it is a name, and reconciled with the corpus both ways: a new one is red until somebody says which it is.',
  A_VALUE_IS_NOT_A_NAME:
    'A marker is filled with a value nothing checks, and the mirror carries no value parser: which actions `task move` has, which shells `completion` knows and which scopes exist are the gate’s and the declaration’s answers about a value, and a marker is exactly what does not know it. `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts` declares the same for the pages.',
  A_LINE_HEADED_BY_ANOTHER_PROGRAM:
    'Without a backtick, a command is read only at the head of a line of text or after `status`’s dash. `source <(mnema completion bash)` in the completion help is a shell line whose head is `source`, and the reading does not look past it — a miss rather than an accusation, and the pages’ blocks, where the same line is published, are read by the shell reading.',
  THE_SETTINGS_A_DECLARATION_DOES_NOT_SHOW:
    'The mirror copies what commander lets a declaration be read back as: commands, arguments, options, mandatoriness, defaults, the version, and whether a command acts. A setting commander keeps with no getter — excess arguments, unknown options, positional or pass-through options, conflicts, implications, environment variables — is not copied. The program uses none of them, and a case below reads the source to keep that true.',
  RUNNING_IS_NOT_READING:
    'Whether a line SUCCEEDS against a record: the roster that decides a revocation, the gate that decides a move, the run a close names. Parsing is what a line must pass before any of that is asked, and `the-refusal-names-the-way-out.test.ts` runs the one line whose success the words promise, in git clones, end to end.',
  TESTS_HAND_NOTHING_OVER:
    'The corpus is what the product delivers: its sources and its pages. The sweep that found the class read the tests too, and the tests that pin the form of a handed-over command changed with it; but a string in a test is handed to nobody, and reading one as a command would accuse fixtures that are exactly right.',
};

/**
 * Every NAME in the corpus whose verb requires more than its path, keyed by the file and the
 * command, with how many times the file names it and why it is a name and not a line to type.
 *
 * It used to be a count inside a sentence — "nineteen names" — and a count cannot tell the next
 * instruction to type a bare line from the next mention of a verb. Each was read in its sentence
 * (29/09/2026): the ones below NAME a verb — to say what it does, what its output is for, or to
 * answer a line the person already typed whole — and none tells a person to type the verb alone.
 */
export const NAMES_THAT_NEED_MORE: Readonly<
  Record<string, { readonly times: number; readonly why: string }>
> = {
  'packages/action/README.md: mnema rules': {
    times: 2,
    why: 'the read named in prose, as what the Action asks about each changed file; the same page hands the whole line over, with its path and `--json`',
  },
  'packages/code/README.md: mnema tail prune': {
    times: 3,
    why: 'the verb named in prose, as the one that cuts a tail (and, beside the CI recipe, as the cut that recipe fails on by design); its own section hands the line over',
  },
  'packages/code/README.md: mnema key restore': {
    times: 1,
    why: 'the verb named in the table row; the same row hands the whole restore over as a line',
  },
  'packages/code/README.md: mnema skill export': {
    times: 1,
    why: 'the verb named in the sentence about what leaves the record as a file',
  },
  'packages/code/README.md: mnema show': {
    times: 4,
    why: 'the read named in sentences about what it serves; its lines are in the reading section',
  },
  'packages/code/README.md: mnema memory': {
    times: 1,
    why: 'a verb named in a list of what a session’s facts are written with',
  },
  'packages/code/README.md: mnema retract': {
    times: 1,
    why: 'the verb named in a sentence about taking a note back, with the id and the reason it takes',
  },
  'packages/code/README.md: mnema observe': {
    times: 1,
    why: 'a verb named beside `mnema memory`, in the same list',
  },
  'packages/code/README.md: mnema decision import': {
    times: 1,
    why: 'the verb named in the sentence about reading decision files; its block has the line',
  },
  'packages/code/src/edit-refuses-a-write.ts: mnema show': {
    times: 1,
    why: 'the read named in the sentence a refusal ends with when several rules refuse, beside the id each rule line carries; with one rule the same sentence hands `mnema show <id>` over whole',
  },
  'packages/code/src/wiring/decision.ts: mnema decision record': {
    times: 1,
    why: 'names the verb a move’s `--alternatives` belongs to, and says the rest of the line in words',
  },
  'packages/code/src/wiring/key.ts: mnema key restore': {
    times: 1,
    why: 'answers a line typed outside a project, whole, by naming the verb to run inside one',
  },
  'packages/code/src/wiring/key.ts: mnema key github': {
    times: 1,
    why: 'answers a line typed outside a project, whole, by naming the verb to run inside one',
  },
  'packages/code/src/wiring/key.ts: mnema key request': {
    times: 1,
    why: 'the help of `key enroll`, naming the verb whose output its argument is',
  },
  'packages/code/src/wiring/key.ts: mnema key enroll': {
    times: 1,
    why: 'answers a line typed outside a project, whole, by naming the verb to run inside one',
  },
  'packages/code/src/wiring/key.ts: mnema key revoke': {
    times: 1,
    why: 'answers a line typed outside a project, whole, by naming the verb to run inside one',
  },
  'packages/code/src/wiring/verify.ts: mnema key github': {
    times: 1,
    why: 'the line saying an identity has no account linked, naming the verb that links one',
  },
  'packages/code/src/wiring/run.ts: mnema run end': {
    times: 1,
    why: 'the usage refusal of that very verb, naming it before saying what it needs',
  },
  'packages/code/src/wiring/run.ts: mnema run start': {
    times: 1,
    why: 'names the verb whose printed id the variable holds',
  },
  'packages/code/src/wiring/skill.ts: mnema skill create': {
    times: 1,
    why: 'the usage refusal of that very verb, naming it before saying what it requires',
  },
  'packages/code/src/wiring/tail.ts: mnema tail prune': {
    times: 1,
    why: 'the help that says what each line of the listing is for, naming the verb the id is for',
  },
  'packages/context/src/intelligence/pattern-moves.ts: mnema show': {
    times: 1,
    why: 'names the read a person uses, in the sentence about what nothing records',
  },
};

/**
 * How many commands each part of the corpus hands over today, by what they are.
 *
 * NOT A FLOOR, AND NOT A FILTER. It is compared with what the readings found, exactly: a command
 * that starts being handed over moves a number here until somebody has looked at it, and a reading
 * that quietly stopped reading empties a row — which is how a sweep that broke is told apart from a
 * product that stopped handing commands over.
 *
 * THE WAY OUT OF AN IDENTITY WHOSE ONLY KEY IT IS moved two rows, each command looked at, and run
 * to the letter by `the-refusal-names-the-way-out.test.ts`: in the source, the refusal of a key in
 * two identities hands over the three steps of that way out that were never handed over — `key
 * enroll <the line>` in the checkout the key founded from, the `key request --anchor` that prints
 * that line where the other key lives, and `key restore "<the key file>"` there — and the
 * revocation of a machine's own key hands over the same restore, with the file it takes (23 → 27
 * lines); on the page, the row that says so names the enrollment and the restore (21 → 23).
 *
 * A SUBCOMMAND THAT REFUSES ITS GROUP'S FLAG SAYS WHERE THE FLAG IS READ, and that moved two rows
 * of the source, each looked at: the two `witness` acts refuse `--json` by handing over `mnema
 * witness --json`, the reading that has it (27 → 28 lines), and the two moves of a decision refuse
 * `--alternatives` by naming `mnema decision record`, the verb that records it (41 → 42 names).
 *
 * A CHECKOUT THE KEY LEFT IS REFUSED, AND TOLD THE RESTORE, and the way out learned the copy this
 * machine keeps: four lines of the source and one of the page, each looked at and run to the
 * letter by `the-refusal-names-the-way-out.test.ts` and `the-checkout-a-key-left.test.ts`. The
 * refusal of a write from a checkout whose recorded identity no longer counts its key hands over
 * `key restore "<the key file>"` where the record proves the key in one other identity, and where
 * it proves it in none, on the condition a pull meets; the revocation of this machine's own key
 * hands over the same restore on that condition where it used to warn; and the way out hands over
 * `key request --anchor … --key "<its file>"` for a copy of a key this machine keeps (28 → 32
 * lines); on the page, the row that says so names that request (23 → 24).
 *
 * THE FRONT PAGE SAYS WHAT LEAVES A MACHINE, and that moved one row of the pages, looked at: the
 * line saying what a privately recorded fact never sends anywhere names `mnema witness stamp`, the
 * one verb that sends a checkpoint's digest, and only when it is run (63 → 64 names).
 *
 * THE CHANGELOG ARRIVED, and it names three verbs a reader of it would go and type: the server
 * an agent writes through, `verify`, and `witness stamp` (64 → 67 names).
 *
 * THE OPENING TEXTS ARE ASKED FOR WITH `--hook`, and that moved rows of the pages and of the
 * source, each looked at. The plugin's page names what its two handlers run as `mnema brief
 * --hook` and `mnema recall --hook` — a bare name became a line in four spans (67 → 63 names)
 * and the package's page says the hook's copy is `mnema brief --hook` (24 → 29 lines); the two
 * blocks a person runs to see what a session is handed carry the flag too (20 → 18 names,
 * 33 → 35 lines). In the source, the table of what
 * `channel.served` does not count names the two reads that print the opening texts, `mnema
 * brief` and `mnema recall` (42 → 44 names).
 *
 * A `mnema` OLDER THAN THE FLAG IS ASKED AGAIN WITHOUT IT, and the plugin's page says what that
 * looks like where a person checks the hook: the verb answers that `mnema brief` does not take
 * `--hook`, and the session is handed what `mnema brief` prints — two names in one span, looked
 * at (63 → 65 names).
 *
 * THE PAGES THAT SAY WHAT A GREEN `verify` DOES NOT PROVE name two verbs more in prose — the
 * witness that dates a record and the cut the CI recipe fails on by design — and the recipe
 * itself is one block line more (66 → 68 names in spans, 35 → 36 lines in blocks); and
 * `verify --since` beside `--workspace` hands over the line to run in each project instead
 * (34 → 35 lines in the source).
 *
 * THE FIRST USE NOW SAYS WHAT COMES NEXT, and that moved rows of the source, each looked at. `init`
 * ends by naming the verb to type, `mnema decision record <title> <rationale>` (a line), and the one
 * that shows where things stand, `mnema status` (a name), and, when the directory is not the root of
 * the repository, `mnema init` to run there (a name); `status` without an identity says to run `mnema
 * init` (a name); and a supersede by a proposal names the accept that would put the successor in
 * force, `mnema decision move accept <id> --note "<why>"` (a line) — 34 → 36 lines, 46 → 49 names.
 */
export const HANDED_OVER: Readonly<
  Record<Handed['from'], Readonly<Record<Reading['kind'], number>>>
> = {
  // name 66 until the page about where the key lives named the verbs that protect it, and the
  // ones that stay unprotected without it (`key protect`, `key unprotect`, `verify`).
  // line 34 until the plugin page named `mnema --identify`, the question its hooks ask first.
  // line 36, name 71 until the page said `mnema key protect` asks for the passphrase.
  // line 36 and name 71 until the two pages named the command the Stop and PreCompact hooks run
  // (`mnema tally`, twice) and the switch that stops it (`mnema switch off session-tally`).
  // line 37 and name 73 until the plugin page named the switch that turns the first-write hold on
  // (`mnema switch on edit-first-write-gate`, a line) and the listing that says it is off (`mnema switch`).
  // line 38 and name 74 until the two pages named the verb that records corrections
  // (`mnema corrections`, and `mnema switch` in the row that says it starts off) and the switch that
  // turns it on (`mnema switch on user-corrections`, a line on each page).
  // And one line and one name more for the page that says a rule can refuse a write.
  // name 77 until the page named `mnema doctor` and the server-only plugin's `mnema mcp`.
  // line 41 and name 80 until the Action's page was added: it hands over its workflow, and names
  // `mnema rules` twice.
  // And four names more for the paragraph that says a note can be taken back: `mnema retract`,
  // and the three reads it names (`mnema search`, `mnema show`, `mnema verify`).
  // And one name more for the changelog entry that names `mnema brief` beside the inherited section.
  // line 48 until the page said which flag compares the keys that signed with GitHub's, and how an
  // account is linked (`mnema verify --against-github`, `mnema key github`).
  span: { line: 48, name: 87, flag: 1, unwritten: 0 },
  // name 18 until the page that says where the key lives named `mnema key protect` in a line of
  // its own.
  // line 35 until the same page showed that question in a block of its own.
  // name 19 until the page said `mnema key protect` asks for the passphrase at a terminal.
  block: { line: 37, name: 20, flag: 0, unwritten: 0 },
  // 46 until the refusal an agent's `accept` gets, with the switch off, began naming the command a
  // person accepts with (`agent-accepts.ts`).
  // line 34 until the sentences an agent's accept is answered with began handing whole lines
  // over (`agent-accepts.ts`: the read, the person's accept, and the switch in both positions).
  // line 40 until the plugin told a session which program answered that question (`hand-over.mjs`).
  // name 50 until the hook copy of the opening document named `mnema decision import` (`presentation/brief.ts`).
  // name 52 until `before-a-write`'s help named the switch of the refusal beside the asking's.
  // name 51 until the table that says why the record does not count the tally's service named
  // `mnema tally` (`record-framing.ts`), and the table of what owes no notice about the chain named
  // `mnema verify` as the reading that rules on it (`record-integrity.ts`).
  // line 46 until the verb's own help named the switch that stops it, `mnema switch off
  // session-tally` (`wiring/tally.ts`).
  // line 47 until the help of the verb that records corrections named the switch that turns it on,
  // `mnema switch on user-corrections` (`wiring/corrections.ts`).
  // name 53 until `mnema doctor` named the `mnema mcp` a host starts, twice, and `claude mcp add mnema -- mnema mcp`.
  // line 53 and name 60 until `key github` and `verify --against-github` handed over each other.
  // And one line and four names more for the verb that points a project at another record (`wiring/inherit.ts`).
  source: { line: 54, name: 64, flag: 3, unwritten: 3 },
};

// ---------------------------------------------------------------------------

const program = watchedProgram();
const verbs = new Set(program.commands.map((one) => one.name()));

const pages = trackedPages().filter((page) => !page.startsWith(EVIDENCE));
const onPages = pages.map((page) => handedOnPage(page, readFileSync(join(ROOT, page), 'utf8')));
const inSources = speakingSources().map((file) =>
  handedInSource(file, readFileSync(join(ROOT, file), 'utf8'), verbs),
);
const handed = [...onPages, ...inSources].flatMap((one) => one.handed);
const unreadable = [...onPages, ...inSources].flatMap((one) => one.unreadable);

/** Every handed-over command with its readings, computed once. */
const read = handed.map((one) => ({ ...one, readings: readingsOf(program, one.text) }));

/** How a failure names one command: the address and the words. */
const where = (one: Handed): string => `${one.where}  ${shown(one.text)}`;

describe('the command handed over runs as handed', () => {
  it('every line passes the parser whole, its markers filled and nothing added', () => {
    const refused: string[] = [];
    for (const one of read) {
      for (const reading of one.readings) {
        if (reading.kind !== 'line') continue;
        const no = refusalOf(program, reading.argv);
        if (no !== undefined) refused.push(`${where(one)}  — ${no.message}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it('every command is read whole: none opens a span it does not close', () => {
    expect(unreadable.map((one) => `${one.where}  ${one.text}`)).toEqual([]);
  });

  it('the commands whose verb is not written are the ones the roster names', () => {
    const found = [
      ...new Set(
        read
          .filter((one) => one.readings.some((reading) => reading.kind === 'unwritten'))
          .map((one) => `${one.where.split(':')[0]}: ${shown(one.text)}`),
      ),
    ].sort();
    expect(found).toEqual(Object.keys(THE_VERB_IS_NOT_WRITTEN).sort());
  });
});

describe('a name whose verb needs more is one somebody looked at', () => {
  it('is on the roster, as many times as the file names it, and the roster holds no other', () => {
    const found: Record<string, number> = {};
    for (const one of read) {
      for (const reading of one.readings) {
        if (reading.kind !== 'name' || refusalOf(program, reading.path) === undefined) continue;
        const key = `${one.where.split(':')[0]}: mnema ${reading.path.join(' ')}`;
        found[key] = (found[key] ?? 0) + 1;
      }
    }
    const listed = Object.fromEntries(
      Object.entries(NAMES_THAT_NEED_MORE).map(([key, said]) => [key, said.times]),
    );
    expect(found).toEqual(listed);
    // NON-VACUITY: the names the finding was about are among them.
    expect(Object.keys(found)).toContain('packages/code/src/wiring/key.ts: mnema key revoke');
    expect(Object.keys(found)).toContain('packages/code/src/wiring/run.ts: mnema run end');
  });

  it('the mirror knows which commands act, from the published method and not a private field', () => {
    const acting = everyCommandOf(program)
      .filter((command) => command.commands.length > 0 && actsOnItsOwn(command))
      .map((command) => command.name())
      .sort();
    expect(acting).toEqual(['switch', 'witness']);
    // And the source reads no private field of commander's.
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    expect(codeOnly(source).includes(['_action', 'Handler'].join(''))).toBe(false);
  });
});

describe('the readings know what they read', () => {
  it('each part of the corpus hands over what the count says', () => {
    const counted: Record<string, Record<string, number>> = {
      span: { line: 0, name: 0, flag: 0, unwritten: 0 },
      block: { line: 0, name: 0, flag: 0, unwritten: 0 },
      source: { line: 0, name: 0, flag: 0, unwritten: 0 },
    };
    for (const one of read) {
      for (const reading of one.readings) {
        const row = counted[one.from] as Record<string, number>;
        row[reading.kind] = (row[reading.kind] ?? 0) + 1;
      }
    }
    expect(counted).toEqual(HANDED_OVER);
  });

  it('the pages it reads are the documentation, and the evidence is left out on purpose', () => {
    expect(pages).toContain('packages/code/README.md');
    expect(pages.some((page) => page.startsWith(EVIDENCE))).toBe(false);
    expect(trackedPages().some((page) => page.startsWith(EVIDENCE))).toBe(true);
  });

  it('every exemption carries a reason', () => {
    const mute = Object.entries({ ...NOT_CHECKED, ...THE_VERB_IS_NOT_WRITTEN })
      .filter(([, why]) => why.length < 80)
      .map(([what]) => what);
    expect(mute).toEqual([]);
  });

  it('the program uses no parse setting the mirror cannot copy', () => {
    // THE MIRROR'S PREMISE, READ OFF THE SOURCE. A setting commander keeps with no getter cannot
    // be carried over, so a verb that began using one would be parsed here by commander's default
    // — and a stricter real parse would be a line this guard passes. `aliases()` with nothing in
    // it READS the aliases, and is left alone.
    const setters =
      /\.(?:allowExcessArguments|allowUnknownOption|passThroughOptions|enablePositionalOptions|conflicts|implies|env|preset|alias)\(|\.aliases\(\s*[^)\s]/;
    const using = speakingSources()
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => setters.test(codeOnly(readFileSync(join(ROOT, file), 'utf8'))));
    // NO FILE. There was one, and it was not a verb: `written-before.ts` turned positional
    // options on for a throwaway command it built to ask where a flag was WRITTEN, and this case
    // named it as the one exception. It asks commander's default parse over prefixes of the line
    // now, which answers the same without the setting, so no exception is left to cover a real
    // verb's.
    expect(using).toEqual([]);
  });
});

describe('the reading FIRES', () => {
  // Every reading above is shown working on text written here, so a case that finds nothing is
  // distinguishable from one that cannot find anything.
  const kinds = (text: string): string[] => readingsOf(program, text).map((one) => one.kind);
  // A source is written here with `#{` where it has `${`, so no string in THIS file reads as a
  // template that forgot its backticks.
  const inSource = (written: string): { handed: string[]; unreadable: number } => {
    const source = written.replaceAll('#{', '${');
    const found = handedInSource('<written here>', source, verbs);
    return {
      handed: found.handed.map((one) => shown(one.text)),
      unreadable: found.unreadable.length,
    };
  };

  it('a span in a literal is read, and an escaped backtick opens one', () => {
    expect(inSource("const a = 'run `mnema verify` here';").handed).toEqual(['mnema verify']);
    expect(inSource('const a = `run \\`mnema show #{id}\\` here`;').handed).toEqual([
      'mnema show {}',
    ]);
  });

  it('a comment hands nothing over', () => {
    expect(inSource('// run `mnema key revoke <fp>` here\n/* `mnema x` */').handed).toEqual([]);
  });

  it('a span that runs into the edge of its literal is unreadable, not guessed at', () => {
    const split = "const a = 'or `mnema switch on ' + channel + '` to have it';";
    expect(inSource(split)).toEqual({ handed: [], unreadable: 1 });
  });

  it('a command with no backtick is read at the head of a line and after the dash, and prose is not', () => {
    expect(inSource("fact('mnema key enroll <the line>', 2);").handed).toEqual([
      'mnema key enroll <the line>',
    ]);
    expect(inSource("'  mnema brief > MNEMA.md          the record, in a file'").handed).toEqual([
      'mnema brief > MNEMA.md',
    ]);
    expect(inSource('`  #{dir} (#{n}) — mnema decision import #{dir}`').handed).toEqual([
      'mnema decision import {}',
    ]);
    expect(inSource("'mnema is append-only and nothing deletes a fact'").handed).toEqual([]);
  });

  it('a page is read in its prose and in its blocks, and a table’s escaped pipe is a pipe', () => {
    const page = [
      'Run `mnema verify` and `mnema brief \\| diff - MNEMA.md`.',
      '```sh',
      'mnema run end --which release-bot',
      '```',
    ].join('\n');
    const found = handedOnPage('<written here>', page).handed;
    expect(found.map((one) => [one.from, one.text])).toEqual([
      ['span', 'mnema verify'],
      ['span', 'mnema brief | diff - MNEMA.md'],
      ['block', 'mnema run end --which release-bot'],
    ]);
  });

  it('a command is a line, a name, a flag’s name, or one whose verb is not written', () => {
    expect(kinds('mnema key revoke <fingerprint> --reason "<why>"')).toEqual(['line']);
    expect(kinds('mnema key revoke')).toEqual(['name']);
    expect(kinds('mnema mcp --project')).toEqual(['flag']);
    expect(kinds('mnema --color')).toEqual(['flag']);
    expect(kinds('mnema <verb>')).toEqual(['unwritten']);
    expect(kinds(`mnema ${INTERPOLATED} `)).toEqual(['unwritten']);
    // A marker is filled before the shell reads the line, so its `<` is not a redirection.
    expect(readingsOf(program, 'mnema show <id>')).toEqual([{ kind: 'line', argv: ['show', 'x'] }]);
    // And a quoted marker is one word, which is what a person's sentence is.
    expect(readingsOf(program, 'mnema key revoke <fp> --reason "<why>"')).toEqual([
      { kind: 'line', argv: ['key', 'revoke', 'x', '--reason', 'x'] },
    ]);
  });

  it('the parser refuses a line that is not whole, and takes one that is', () => {
    const says = (argv: readonly string[]): string | undefined => refusalOf(program, argv)?.code;
    expect(says(['key', 'revoke', 'x'])).toBe('commander.missingMandatoryOptionValue');
    expect(says(['key', 'revoke', 'x', '--reason', 'x'])).toBeUndefined();
    expect(says(['run', 'end', '--outcome', 'x'])).toBe('commander.missingMandatoryOptionValue');
    expect(says(['show'])).toBe('commander.missingArgument');
    expect(says(['completion', 'bash', 'zsh'])).toBe('commander.excessArguments');
    expect(says(['verify', '--requireZZZ'])).toBe('commander.unknownOption');
    expect(says(['verifyZZZ'])).toBe('commander.unknownCommand');
    // A verb that acts AND holds verbs takes a title; a group that only holds them does not act.
    expect(says(['task', 'create', 'Ship the parser'])).toBeUndefined();
    expect(says(['key'])).toBe('commander.help');
    // Asking for help or for the version is taken: both end with exit 0.
    expect(says(['--version'])).toBeUndefined();
    expect(says(['key', 'revoke', '--help'])).toBeUndefined();
  });

  it('the mirror refuses what the program refuses, with the same code', () => {
    // Asked of the REAL program only for lines it refuses before anything runs — a refusal of the
    // parser is thrown before any hook or action, so this reads no record and touches no home.
    const refusedLines = [
      ['key', 'revoke', 'x'],
      ['run', 'end', '--outcome', 'x'],
      ['show'],
      ['completion', 'bash', 'zsh'],
      ['verify', '--requireZZZ'],
      ['verifyZZZ'],
    ];
    const byTheProgram = refusedLines.map((argv) => {
      try {
        buildProgram(silent).program.parse(argv, { from: 'user' });
        return 'accepted';
      } catch (error) {
        return error instanceof CommanderError ? error.code : String(error);
      }
    });
    expect(refusedLines.map((argv) => refusalOf(program, argv)?.code)).toEqual(byTheProgram);
  });
});

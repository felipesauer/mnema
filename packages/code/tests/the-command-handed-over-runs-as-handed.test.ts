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
 * Whether a command runs an action of its own. commander keeps it in a field it does not publish,
 * and it is the one thing the mirror cannot read any other way: `task` takes a title AND holds
 * `move`, while `key` only holds its verbs, and a mirror that gave both the same answer would
 * either refuse `mnema task "Ship the parser"` or accept a bare `mnema key`.
 */
function actsOnItsOwn(command: Command): boolean {
  return (command as unknown as { readonly _actionHandler: unknown })._actionHandler != null;
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
    'A verb’s bare path is read as its NAME, and a name is checked only for naming a verb. Measured when this guard landed: nineteen names whose verb requires more than its path — `mnema key revoke` in the refusal that answers a line typed outside a project, `mnema tail prune` in the sentence saying what it takes. There were twenty, and the reading cannot tell a name from an instruction to type a bare line: the twentieth WAS one (`run start`’s "`mnema run end` closes it"), and it is a line now.',
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
 * How many commands each part of the corpus hands over today, by what they are.
 *
 * NOT A FLOOR, AND NOT A FILTER. It is compared with what the readings found, exactly: a command
 * that starts being handed over moves a number here until somebody has looked at it, and a reading
 * that quietly stopped reading empties a row — which is how a sweep that broke is told apart from a
 * product that stopped handing commands over.
 */
export const HANDED_OVER: Readonly<
  Record<Handed['from'], Readonly<Record<Reading['kind'], number>>>
> = {
  span: { line: 21, name: 62, flag: 1, unwritten: 0 },
  block: { line: 33, name: 20, flag: 0, unwritten: 0 },
  source: { line: 23, name: 41, flag: 3, unwritten: 3 },
};

// ---------------------------------------------------------------------------

const program = buildProgram(silent).program;
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
    expect(says(['task', 'Ship the parser'])).toBeUndefined();
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

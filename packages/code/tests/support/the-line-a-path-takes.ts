/**
 * EVERY COMMAND PATH THE PROGRAM ROUTES, AND A COMMAND LINE FOR EACH — synthesised from
 * the declaration rather than listed.
 *
 * A guard that has something to say about "every verb" has two problems before it has
 * one assertion: knowing what the surface routes today, and knowing what to type at each
 * of them. The first is a walk of the program the entry builds. The second is the one
 * that usually becomes a hand-kept table — and a hand-kept table of invocations goes
 * stale in exactly the case it exists for, which is the subcommand somebody added last
 * week.
 *
 * So the line is BUILT OUT OF THE DECLARATION: a path's required positionals in their
 * declared order, then its mandatory options, each given a value chosen by what the
 * parameter is called. A subcommand added tomorrow is exercised by every caller of this
 * module without an edit anywhere.
 *
 * WHAT A DECLARATION ANSWERS ABOUT ITS OWN VALUES, and the two places it is written.
 * This surface says "here is the closed set this takes" through `valuesDeclaredOn` — a
 * WeakMap keyed by the Argument, kept out of commander's `argChoices` on purpose, so the
 * generated help holds one list instead of two. ONE DECLARATION ON THE SURFACE DOES NOT
 * USE IT: `completion <shell>` is a plain `new Argument(...).choices([...SHELLS])`. Both
 * are asked here, because a synthesiser that knew only about the product's own spelling
 * would hand `completion` a shell that does not exist and then report the parser's
 * refusal as a fact about the verb.
 *
 * WHAT IT IS NOT. It does not decide whether a line SUCCEEDS: a caller that needs a real
 * id passes a fixture that holds one, and a caller exercising a surface with no project
 * behind it passes {@link NOTHING_FOUNDED} and gets placeholders. And it holds no
 * assertion of its own — what counts as a violation belongs to the guard that asks.
 */

import type { Argument, Command, Option } from 'commander';
import { buildProgram, type CliIo } from '../../src/cli.js';
import { valuesDeclaredOn } from '../../src/wiring/enumerated.js';

/** One invocable command path, and the declaration that says what it takes. */
export interface Routed {
  /** The words a caller types after `mnema`, joined — `decision move`, `memory`. */
  readonly path: string;
  /** The command commander holds, which is where the argument list is read from. */
  readonly command: Command;
}

/**
 * Every command path a program routes, in the order it was registered.
 *
 * Groups are included alongside their subcommands, because a group is invocable in its
 * own right on this surface: `mnema task <title>` creates and `mnema switch` lists.
 */
export function routes(program: Command, prefix: readonly string[] = []): Routed[] {
  const found: Routed[] = [];
  for (const command of program.commands) {
    const path = [...prefix, command.name()];
    found.push({ path: path.join(' '), command });
    found.push(...routes(command, path));
  }
  return found;
}

/** A port that writes nowhere — for building a program only to look at it. */
export const QUIET: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };

/** The program the binary parses with, walked. */
export function theSurface(): Routed[] {
  return routes(buildProgram(QUIET).program);
}

/**
 * A path NO invocation from a test process can exercise, and why.
 *
 * Both serve the surface for the length of a connection instead of doing a piece of work
 * and returning, so there is no line that comes back. Callers reconcile these keys against
 * the walk, so an entry for a path that was renamed is red rather than dormant.
 */
export const SERVES_A_CONNECTION: Readonly<Record<string, string>> = {
  mcp: 'it serves a connection for its lifetime and would never return',
  repl: 'it refuses without a terminal at both ends, and this harness has neither',
};

/**
 * A path that reaches ANOTHER MACHINE — except over a record that holds no tail.
 *
 * `witness stamp` asks a calendar to attest a checkpoint, which is the one act of this
 * surface that goes out over the network, so no guard may exercise it over a record with
 * anything in it. Over a record with NOTHING in it the act returns at its first line:
 * `chains.length === 0` is checked before a single fetch is composed, and the refusal
 * arrives in eleven milliseconds with no socket opened. A caller exercising the surface
 * where nothing has been founded may therefore include it; one exercising it inside a
 * project may not.
 */
export const REACHES_OUT_OVER_A_RECORD: Readonly<Record<string, string>> = {
  'witness stamp': 'it would go out to a calendar for any tail it found',
};

/** Everything a caller working inside a founded project has to leave alone. */
export const SERVES_OR_REACHES_OUT: Readonly<Record<string, string>> = {
  ...SERVES_A_CONNECTION,
  ...REACHES_OUT_OVER_A_RECORD,
};

/** The values only a founded project can produce, and the ones a line takes as text. */
export interface Fixture {
  /** The identity `init` printed — what `--actor` and `--anchor` take. */
  readonly anchor: string;
  /** A task, for every path that names one. */
  readonly task: string;
  /** A decision, for `decision move` and the first half of a supersede. */
  readonly decision: string;
  /** A second decision, the successor `decision supersede` replaces the first with. */
  readonly successor: string;
  /** A skill, for `skill move` and `skill export`. */
  readonly skill: string;
  /** A tail this machine did not write — the only kind `tail prune` can name. */
  readonly foreignTail: string;
  /** A directory of decision files, inside the project, for `decision import`. */
  readonly decisionFiles: string;
}

/** The values a path is given where no project is founded — placeholders, and legible ones. */
export const NOTHING_FOUNDED: Fixture = {
  anchor: `mnid:${'0'.repeat(64)}`,
  task: '00000000-0000-7000-8000-000000000000',
  decision: '00000000-0000-7000-8000-000000000000',
  successor: '00000000-0000-7000-8000-000000000000',
  skill: '00000000-0000-7000-8000-000000000000',
  foreignTail: 'no-such-tail',
  decisionFiles: 'adr',
};

/**
 * What a parameter is given, by the name its declaration carries.
 *
 * Keyed by NAME and not by command, so a new subcommand taking `<title>` or `--reason`
 * needs nothing added here. The ambiguous one is `<id>`, which four kinds of record
 * answer to; it is resolved per path by {@link THE_ID_MEANT}.
 */
function byName(name: string, fixture: Fixture): string | undefined {
  const table: Readonly<Record<string, string>> = {
    title: 'a title the guard recorded',
    rationale: 'the rationale the guard recorded',
    name: 'a pattern the guard proposed',
    content: 'something worth keeping',
    about: fixture.task,
    task: fixture.task,
    'task-id': fixture.task,
    from: 'agent-alpha',
    to: 'agent-beta',
    subject: fixture.task,
    target: fixture.task,
    'old-id': fixture.decision,
    'new-id': fixture.successor,
    dir: fixture.decisionFiles,
    tail: fixture.foreignTail,
    path: 'src',
    term: 'task',
    topic: 'review',
    text: 'it needs a rollback',
    rel: 'relates-to',
    which: 'agent-alpha',
    actor: fixture.anchor,
    anchor: fixture.anchor,
    reason: 'why the guard did it',
    note: 'why this verdict',
  };
  return table[name];
}

/**
 * The `<id>` each path means, where the record the generic value names will not do.
 *
 * `<id>` is the one parameter name four kinds of record answer to, so it is the one place
 * a path has to be named. A path missing from here is given the task, which is what every
 * read that takes an id can answer about.
 */
export const THE_ID_MEANT: Readonly<Record<string, keyof Fixture>> = {
  'decision move': 'decision',
  'skill move': 'skill',
  'skill export': 'skill',
};

/**
 * WHAT THE GATE REQUIRES THAT THE DECLARATION DOES NOT — the proof flags, and one more.
 *
 * A move's `--note` and a supersede's `--reason` are declared as plain options so a
 * sibling command does not inherit them as mandatory, and the requirement is the
 * WORKFLOW's: the gate refuses the move without them. `--body` is the same shape on
 * `skill`, enforced in the action. `--write` is required by nothing — it is what makes
 * `decision import` record instead of print, and a caller that needs the path to write
 * has to ask for it.
 *
 * So this is not an invocation table: it is the short list of what a declaration does not
 * say out loud. Callers reconcile its keys against the walk.
 */
export const ALSO_NEEDS: Readonly<Record<string, readonly string[]>> = {
  skill: ['--body', 'the reusable pattern itself'],
  'skill move': ['--note', 'why this verdict'],
  'decision move': ['--note', 'why this verdict'],
  'decision supersede': ['--reason', 'a later decision replaces it'],
  'decision import': ['--write'],
};

/** The closed set a declaration names, in whichever of the two ways it names one. */
function closedSet(declaration: Argument | Option): readonly string[] {
  const ours = valuesDeclaredOn(declaration);
  return ours.length > 0 ? ours : (declaration.argChoices ?? []);
}

/**
 * The command line for one path, built out of what the path itself declares.
 *
 * Required positionals in their declared order, then every mandatory option, then
 * whatever {@link ALSO_NEEDS} says the gate wants. A declaration that names a closed set
 * answers with it, so `task move` is given a real action rather than a word the workflow
 * would refuse; anything else falls through to the value its parameter name carries, and
 * finally to a placeholder that is legible in a red.
 */
export function lineFor(routed: Routed, fixture: Fixture): string[] {
  const words = routed.path.split(' ');
  const value = (name: string, declared: readonly string[]): string => {
    if (declared.length > 0) return declared[0] as string;
    if (name === 'id') return fixture[THE_ID_MEANT[routed.path] ?? 'task'];
    return byName(name, fixture) ?? `no-such-${name}`;
  };
  for (const argument of routed.command.registeredArguments) {
    if (!argument.required) continue;
    words.push(value(argument.name(), closedSet(argument)));
  }
  for (const option of routed.command.options) {
    if (!option.mandatory) continue;
    words.push(option.long as string, value(option.name(), closedSet(option)));
  }
  words.push(...(ALSO_NEEDS[routed.path] ?? []));
  return words;
}

/** Every table here that names a path, for a caller reconciling them against the walk. */
export function pathsNamedInTables(): string[] {
  return [
    ...Object.keys(SERVES_OR_REACHES_OUT),
    ...Object.keys(ALSO_NEEDS),
    ...Object.keys(THE_ID_MEANT),
  ];
}

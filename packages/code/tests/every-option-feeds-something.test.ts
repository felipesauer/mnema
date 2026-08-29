/**
 * Every option the CLI declares hands its value to something that READS it.
 *
 * THE SISTER GUARD COVERS THE OTHER HALF AND SAYS SO. `every-public-value-has-a-caller`
 * walks the exported values and declares out loud that it does not catch "a FIELD of an
 * options object that nobody sets", because catching that one means enumerating every
 * option and every setter of it. This is that half, taken from the other end: the option
 * is enumerated from the parser itself, and what has to exist is a READ of the value on
 * the path the option's own action takes.
 *
 * IT WAS BUILT BECAUSE THE SURFACE HELD ONE. `mnema witness upgrade --calendar` accepted
 * URLs, the wiring put them in `{ calendars }`, the adapter forwarded the object, and
 * `completeWitness` never read the key — while the help said `the calendars to ask, when
 * the defaults are not the ones used`. It is the fifth defect of that shape in this
 * product, and the first four were all found by somebody using them.
 *
 * WHY NEITHER GREP FINDS IT, which is the whole design of what follows:
 *
 *   - THE NAME CHANGES ON THE WAY. `opts.calendar` leaves as `calendars`, `opts.which`
 *     as `agent`, `opts.key` as `privateKeyPath`, `opts.project` as `configProject`,
 *     `opts.workspace` as `named`, `opts.blocks` as `blockSource`. Grepping the flag's
 *     own name answers about a value that is no longer called that, and would accuse
 *     every one of those six. So the destination name is read off the action's own
 *     source and the trace follows THAT.
 *   - THE KEY IS READ, JUST NOT HERE. `.calendars` has a reader in the very file that
 *     ignores it — `stampCheckpoint`, which is `stamp`'s path, not `upgrade`'s. A scan
 *     that asks "is this key read anywhere" answers yes and clears the defect. So the
 *     question is asked of the functions REACHABLE from this action and of no others,
 *     which is what separates the two acts that share a flag name and a file.
 *
 * WHAT A "READ" IS: a property access, a destructuring, or an index of the destination
 * name, in the body of a function this action can reach. Comments and string literals
 * are blanked first (`support/reading-source.ts`, the same instrument the sister guard
 * uses), so a `{@link}` cannot stand in for a use — the mistake that kept `disambiguate`
 * looking alive.
 *
 * WHAT IT DOES NOT CATCH, in a list, because a guard whose limits are not written down
 * is read as covering more than it does:
 *
 *   - THE CALL GRAPH IS BY NAME. Two functions sharing a name are treated as one, and a
 *     value passed as a callback and invoked through a variable is not followed. Both
 *     over-approximate what is reachable, which is the safe direction here: it can miss
 *     an accusation, never invent one.
 *   - A KEY READ THROUGH A SPREAD IS INVISIBLE. `{ ...network }` copies the value
 *     without naming it, so a chain that re-spreads all the way down and reads the key
 *     under a THIRD name is not followed past the first hop.
 *   - IT SAYS NOTHING ABOUT WHAT THE VALUE DOES. Read is read: an option whose value is
 *     read into a variable nobody uses afterwards passes here. The per-case elo tests
 *     are what assert the effect (`mcp-flag-reaches-the-server`, `the-witness-flags-reach-the-act`).
 *   - IT IS NOT THE MCP SURFACE. The tools take an input object each, not options, and
 *     they are the second surface with the same rule.
 *   - A COMMAND WITH NO ACTION OF ITS OWN CANNOT BE TRACED, and there is one such option
 *     ({@link NOT_TRACEABLE}).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// The production surface, read as code
// ---------------------------------------------------------------------------

/** One function of the product: where it lives, and its body with the prose gone. */
interface Body {
  readonly path: string;
  readonly body: string;
}

/** A `function name(` head, exported or not, generator or not. */
const FUNCTION_HEAD =
  /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/g;
/** A `const name = (` head — the other way this workspace declares one. */
const ARROW_HEAD =
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>)?\(/g;
/** Any call: `name(`. */
const CALL = /([A-Za-z_$][\w$]*)\s*\(/g;

/** The index of the `}` closing the `{` at `open`, or -1. */
function matchingClose(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The `{` that opens a function's body, skipping an object RETURN TYPE.
 *
 * `function heldChains(ctx: C): { chains: X; trees: Y } { … }` puts a brace group
 * between the parameters and the body, and taking the first one read the annotation as
 * the body — sixty characters of field names, no calls, no reads. A function whose body
 * is missed contributes nothing to the graph, which is how this instrument would err by
 * ACCUSING. So a group whose close is followed by another brace was the annotation.
 */
function bodyBrace(code: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < code.length) {
    const char = code[i];
    if (char === '(' || char === '[' || char === '<') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === '>') {
      if (code[i - 1] !== '=') depth -= 1;
    } else if (char === ';' && depth <= 0) return -1;
    else if (char === '{' && depth <= 0) {
      const close = matchingClose(code, i);
      if (close < 0) return -1;
      let after = close + 1;
      while (after < code.length && /\s/.test(code[after] as string)) after += 1;
      if (code[after] === '{') {
        i = after;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

/** Every function of every package's `src`, by name — tests excluded. */
function productionBodies(): Map<string, Body[]> {
  const found = new Map<string, Body[]>();
  for (const directory of ['chain', 'code', 'copilot', 'core']) {
    for (const path of sourceFiles(join(PACKAGES, directory, 'src'))) {
      const code = codeOnly(readFileSync(path, 'utf-8'));
      for (const head of [FUNCTION_HEAD, ARROW_HEAD]) {
        for (const match of code.matchAll(head)) {
          const open = bodyBrace(code, (match.index ?? 0) + match[0].length - 1);
          if (open < 0) continue;
          const close = matchingClose(code, open);
          if (close < 0) continue;
          const name = match[1] as string;
          found.set(name, [
            ...(found.get(name) ?? []),
            { path: path.slice(PACKAGES.length + 1), body: code.slice(open + 1, close) },
          ]);
        }
      }
    }
  }
  return found;
}

const BODIES = productionBodies();

/** Which functions each function calls — by NAME, which over-approximates on purpose. */
const CALLS = new Map<string, Set<string>>();
for (const [name, bodies] of BODIES) {
  const out = new Set<string>();
  for (const { body } of bodies) {
    for (const match of body.matchAll(CALL)) {
      const callee = match[1] as string;
      if (callee !== name && BODIES.has(callee)) out.add(callee);
    }
  }
  CALLS.set(name, out);
}

/** Everything reachable from a set of entry functions, the entries included. */
function reachableFrom(seeds: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const callee of CALLS.get(name) ?? []) if (!seen.has(callee)) queue.push(callee);
  }
  return seen;
}

/** Where a name is read among those functions: `x.name`, `{ name } =`, or `[name]`. */
function readSites(names: ReadonlySet<string>, key: string): string[] {
  const access = new RegExp(`\\.\\s*${key}\\b`);
  const destructured = new RegExp(`\\{[^{}]*\\b${key}\\b[^{}]*\\}\\s*=`);
  const indexed = new RegExp(`\\[\\s*['"\`]?${key}\\b`);
  const sites: string[] = [];
  for (const name of names) {
    for (const { path, body } of BODIES.get(name) ?? []) {
      if (access.test(body) || destructured.test(body) || indexed.test(body)) {
        sites.push(`${name} (${path})`);
      }
    }
  }
  return sites.sort();
}

// ---------------------------------------------------------------------------
// Where an option's value goes, read off the action that received it
// ---------------------------------------------------------------------------

/** The `{ … }` spans holding no `;` — object literals rather than blocks. */
function objectLiterals(code: string): string[] {
  const spans: string[] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== '{') continue;
    const close = matchingClose(code, i);
    if (close < 0) continue;
    const inner = code.slice(i + 1, close);
    if (!inner.includes(';')) spans.push(inner);
  }
  return spans;
}

/** The innermost `( … )` group holding an index, or null. */
function enclosingGroup(code: string, at: number): string | null {
  const open: number[] = [];
  let best: [number, number] | null = null;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === '(') open.push(i);
    else if (code[i] === ')') {
      const start = open.pop();
      if (start !== undefined && start < at && at < i && (best === null || start > best[0])) {
        best = [start, i];
      }
    }
  }
  return best === null ? null : code.slice(best[0], best[1]);
}

/**
 * The names an option's value is handed away under, taken from the action's own source.
 *
 * An EMPTY answer means the value never leaves the action, which is what every `--json`
 * does: it is read there, it chooses a branch, and nothing downstream ever sees it.
 */
export function destinationsOf(actionSource: string, attribute: string): Set<string> {
  const code = codeOnly(actionSource);
  const keys = new Set<string>();
  const used = code.search(new RegExp(`[A-Za-z_$][\\w$]*\\.${attribute}\\b`));
  if (used < 0) return keys;
  // One step: `KEY: <expression naming opts.attribute>`.
  for (const match of code.matchAll(
    new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*[^,;{}()]*[A-Za-z_$][\\w$]*\\.${attribute}\\b`, 'g'),
  )) {
    keys.add(match[1] as string);
  }
  // Two steps: `const NAME = <expression naming opts.attribute>`, then `{ …, NAME, … }`.
  // The second clause is what keeps a call's ANSWER out of the set — `const result =
  // runTailPrune(…)` names the option and is not the option going anywhere. An `await`
  // binding is excluded for the same reason, one shape earlier.
  const literals = objectLiterals(code);
  for (const match of code.matchAll(
    new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(await\\s+)?[^;]*?[A-Za-z_$][\\w$]*\\.${attribute}\\b`,
      'g',
    ),
  )) {
    if (match[2] !== undefined) continue;
    const local = match[1] as string;
    const shorthand = new RegExp(`(?:^|[{,])\\s*${local}\\s*(?:[,}]|$)`);
    if (literals.some((span) => shorthand.test(span))) keys.add(local);
  }
  // Still nothing, and the value IS spent building something handed away: the option
  // decides which LITERAL is written rather than travelling itself, which is what
  // `opts.write === true ? { write: true } : {}` does. The keys of the innermost
  // parenthesis group are the candidates — narrow enough that the sibling spread on the
  // next line is not one of them, which matters because that sibling is often read.
  if (keys.size === 0) {
    const group = enclosingGroup(code, used);
    if (group?.includes('{') === true) {
      for (const match of group.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(match[1] as string);
    }
  }
  return keys;
}

/** The workspace functions an action calls — the entry points of its own path. */
function entryPoints(actionSource: string): Set<string> {
  const seeds = new Set<string>();
  for (const match of codeOnly(actionSource).matchAll(CALL)) {
    const name = match[1] as string;
    if (BODIES.has(name)) seeds.add(name);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// The options, from the parser the binary runs
// ---------------------------------------------------------------------------

/** One declared option: where it is typed, what it is called, and what receives it. */
interface Declared {
  /** The command line it belongs to, e.g. `mnema witness upgrade`. */
  readonly where: string;
  readonly flags: string;
  readonly attribute: string;
  /** The action that receives it, or undefined when the command declares none. */
  readonly action: string | undefined;
}

/** Every option the program declares, with the action beside it. */
function declaredOptions(): Declared[] {
  const handlers = new Map<Command, (...args: never[]) => unknown>();
  const real = Command.prototype.action;
  // Intercepted rather than read out of a private field: the handler is what receives
  // the value, and its source is the only place the DESTINATION name is written.
  Command.prototype.action = function action(this: Command, fn: (...args: never[]) => unknown) {
    handlers.set(this, fn);
    return real.call(this, fn as Parameters<typeof real>[0]);
  } as typeof real;
  const io: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  let program: Command;
  try {
    // The whole program, not `registerVerbs` alone: `--color` is declared at the entry,
    // on the program, and a walk that started at the verbs would never see it.
    program = buildProgram(io).program;
  } finally {
    Command.prototype.action = real;
  }
  const found: Declared[] = [];
  const walk = (command: Command, path: readonly string[]): void => {
    const handler = handlers.get(command);
    for (const option of command.options) {
      found.push({
        where: path.join(' '),
        flags: option.flags,
        attribute: option.attributeName(),
        action: handler === undefined ? undefined : handler.toString(),
      });
    }
    for (const sub of command.commands) walk(sub, [...path, sub.name()]);
  };
  walk(program, ['mnema']);
  return found;
}

const OPTIONS = declaredOptions();

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/** How one option was cleared, or why it was not. */
interface Verdict {
  readonly option: string;
  readonly destinations: string[];
  readonly read: string[];
}

/** Where each option's value is read, or an empty `read` when it is read nowhere. */
function verdicts(): Verdict[] {
  return OPTIONS.map((declared) => {
    const option = `${declared.where} ${declared.flags}`;
    if (declared.action === undefined) return { option, destinations: [], read: [] };
    const destinations = [...destinationsOf(declared.action, declared.attribute)].sort();
    // Handed away under no name at all: the action is the reader, and there is no
    // second layer for anything to be dropped in.
    if (destinations.length === 0) return { option, destinations, read: ['the action itself'] };
    const reachable = reachableFrom(entryPoints(declared.action));
    const read = destinations.flatMap((key) =>
      readSites(reachable, key).map((site) => `${key} in ${site}`),
    );
    return { option, destinations, read };
  });
}

/** Every option whose value reaches no read on its own path. */
function feedNothing(): string[] {
  return verdicts()
    .filter((verdict) => verdict.read.length === 0)
    .map((verdict) => verdict.option)
    .sort();
}

/**
 * The options this cannot trace, each with the reason — reconciled in both directions.
 *
 * TWO ENTRIES, AND BOTH ARE THE PROGRAM'S OWN. Neither hangs on a verb, so neither has
 * an action for the trace to start from — and the walk finding them is the point: they
 * are options a caller can type, and a table that quietly skipped them would be a table
 * about a surface smaller than the one that exists.
 */
const NOT_TRACEABLE: Readonly<Record<string, string>> = {
  'mnema --color <when>':
    'declared on the program, which has no action to trace from — read in `cli.ts` ' +
    "(`program.opts().color`) and spent in `wiring/color.ts`'s `paintingFor`, which " +
    'is what `one-authority-over-colour.test.ts` drives',
  'mnema -V, --version':
    "commander's own, from `.version(VERSION)`: it is answered by the parser before " +
    'any action is reached, so the reader is not in this workspace at all — what IS ' +
    'ours is the string, pinned in `cli.golden.test.ts`',
};

/** What a declaration table tolerates, and what it does not — both ways at once. */
export function reconcile(
  accused: readonly string[],
  declared: Readonly<Record<string, string>>,
): { accused: string[]; stale: string[] } {
  const names = Object.keys(declared);
  return {
    accused: accused.filter((one) => !names.includes(one)).sort(),
    stale: names.filter((name) => !accused.includes(name)).sort(),
  };
}

/**
 * The fewest options the walk may find, and the ones it must find BY NAME.
 *
 * A guard over an ABSENCE goes green the day its enumerator breaks, and this one has
 * three ways to break quietly: the interception could stop capturing handlers, the walk
 * could stop descending into subcommands, and `buildProgram` could change shape. So the
 * count has a floor and four options are named — one per shape the enumeration has to
 * reach: a group's own option, a subcommand's, one declared multi-line, and the one
 * declared outside `wiring/` altogether.
 *
 * THE FLOOR IS 90 AND THE SURFACE DECLARES 96. `grep -c "\.option('--"` over
 * `wiring/*.ts` answers 48, which is half of them: it misses every multi-line `.option(`
 * (19 of them), every `.requiredOption(`, every `.addOption(`, every option a shared
 * helper hangs on more than one command, and `--color`, which is not in that directory.
 * A number counted that way is the reason a list of options kept by hand cannot be the
 * subject here.
 */
const OPTION_FLOOR = 90;

/** Options the enumeration must contain, one per shape of declaration. */
const MUST_ENUMERATE = [
  // Declared multi-line, on a subcommand, in `wiring/witness.ts`.
  'mnema witness stamp --calendar <url...>',
  // Its sibling on the other act — the one whose value went nowhere and was removed.
  'mnema witness upgrade --blocks <url>',
  // `.requiredOption(`, which the grep above cannot see at all.
  'mnema guard --actor <id>',
  // Declared on the program, outside `wiring/`.
  'mnema --color <when>',
];

describe('every option the CLI declares feeds something', () => {
  it('accuses nothing but what is declared untraceable', () => {
    // Both directions in one assertion: an option that loses its last reader lands in
    // `accused`, and a declared one that gains a traceable path lands in `stale` until
    // its entry leaves the table.
    expect(reconcile(feedNothing(), NOT_TRACEABLE)).toEqual({ accused: [], stale: [] });
  });

  it('found the whole surface, and found it by walking the parser', () => {
    const names = OPTIONS.map((one) => `${one.where} ${one.flags}`);
    expect(names.length).toBeGreaterThanOrEqual(OPTION_FLOOR);
    for (const wanted of MUST_ENUMERATE) expect(names).toContain(wanted);
    // And it reached the actions: an interception that stopped capturing would leave
    // every option untraceable and the table above would have to hold all of them.
    expect(OPTIONS.filter((one) => one.action !== undefined).length).toBeGreaterThanOrEqual(
      OPTION_FLOOR - 1,
    );
  });

  it('read the product, not an empty string', () => {
    // The graph is the other thing that can break quietly. A body reader that finds
    // nothing makes every read invisible and every option accused — loudly — but one
    // that finds a THIRD of them accuses only the unlucky ones.
    expect(BODIES.size).toBeGreaterThan(900);
    expect(BODIES.get('completeWitness')?.[0]?.body.length ?? 0).toBeGreaterThan(300);
    // The annotation case, which cost this instrument a body until it was handled.
    expect(BODIES.get('heldChains')?.[0]?.body ?? '').toContain('resolveTrees');
  });

  it('follows the value where the NAME changes, which is the point', () => {
    // Six of the surface's options are renamed between the flag and the reader. If the
    // trace matched on the flag's own name it would accuse all six; these are the two
    // ends of the widest rename, and the destination is what is asserted.
    expect([
      ...destinationsOf('(opts) => run(ctx, { calendars: opts.calendar })', 'calendar'),
    ]).toEqual(['calendars']);
    expect([
      ...destinationsOf('(opts) => run(ctx, { configProject: opts.project })', 'project'),
    ]).toEqual(['configProject']);
    // Two steps, through a local that is then handed away by shorthand — `parseScope`.
    expect([
      ...destinationsOf(
        '(opts) => { const scope = parseScope(opts.scope, w); run(ctx, { scope, id }); }',
        'scope',
      ),
    ]).toContain('scope');
    // A local bound to the CALL'S ANSWER is not a destination: it names the option and
    // is not the option going anywhere. Without this the trace clears an option because
    // something, somewhere, reads `.result`.
    expect([
      ...destinationsOf(
        '(opts) => { const result = run(ctx, { a: opts.thing }); return result; }',
        'thing',
      ),
    ]).toEqual(['a']);
    // Read and never forwarded: the action is the reader. Every `--json` is this.
    expect([...destinationsOf('(opts) => { if (opts.json === true) out(x); }', 'json')]).toEqual(
      [],
    );
  });

  it('asks the question of THIS path and not of the workspace', () => {
    // The case the guard exists for, stated as the instrument's own. `.calendars` has a
    // reader — `stampCheckpoint` — and that reader is on `stamp`'s path. Asked of what
    // `upgrade` can reach, the same key has none. A scan without this distinction
    // clears the defect this file was written for.
    const asked = reachableFrom(['runWitnessStamp']);
    const back = reachableFrom(['runWitnessUpgrade']);
    expect(readSites(asked, 'calendars').length).toBeGreaterThan(0);
    expect(readSites(back, 'calendars')).toEqual([]);
    // And the return visit does read the one option it kept, so the empty answer above
    // is about `calendars` and not about a path this cannot see into.
    expect(readSites(back, 'blockSource').length).toBeGreaterThan(0);
  });

  it('tolerates a declared option and still accuses an undeclared one', () => {
    // The exception mechanism, on input this test owns — the real table holds one entry
    // and exercises neither half of the reconciliation on its own.
    const accused = ['mnema x --one', 'mnema x --two'];
    expect(reconcile(accused, { 'mnema x --one': 'the reason' })).toEqual({
      accused: ['mnema x --two'],
      stale: [],
    });
    expect(reconcile([], { 'mnema x --one': 'the reason' })).toEqual({
      accused: [],
      stale: ['mnema x --one'],
    });
    expect(reconcile(accused, {})).toEqual({ accused, stale: [] });
  });
});

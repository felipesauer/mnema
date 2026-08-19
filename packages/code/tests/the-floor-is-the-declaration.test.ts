/**
 * What the CLI loads before it knows which verb was asked for.
 *
 * The entry used to import the whole product to print anything. Every wiring file
 * pulled its command adapter at module scope, each adapter pulls the chain, the
 * projections and the derivations behind it, and so `mnema --version` — which reads
 * nothing — paid for all of it. Measured on 6/ago: a floor of 121 ms against 19 ms
 * for an empty node, on a slowest verb of 169 ms. Seventy-two per cent of what a
 * person waited for was modules loading, and the work itself (3–48 ms) was under
 * the threshold where anybody notices anything at all.
 *
 * The rule that came out of it is in `wiring/verb.ts`: THE DECLARATION IS EAGER,
 * THE IMPLEMENTATION LOADS WHEN THE VERB RUNS. commander needs every command,
 * option and line of help before it can route a word or print `--help`; it does not
 * need the `runX` behind the action.
 *
 * THIS GUARD IS A SHAPE, NOT A STOPWATCH. The machine that runs it has measured
 * contention (five-second timeouts in `cli.test.ts`), so a timed assertion here
 * would be a flake somebody switches off — and then the floor grows back. So this
 * walks the entry's STATIC imports and states what they reach. The milliseconds
 * belong in a report.
 *
 * AND THE FLOOR GREW BACK ANYWAY, TWICE, WHICH IS WHY THE COUNTS BELOW ARE EXACT.
 * This paragraph used to end at *"the record of an earlier pass says the floor had
 * been brought to 90 ms, and nineteen PRs later it was 121, because nothing
 * measured"* — written as a thing that had happened once. It happened again while
 * that sentence stood: the last floor anybody recorded was **97.8 ms** (30/jul,
 * `a27f7975`), and the channel-cost measurement of 19/aug found **143.1 ms**, of
 * which only 20.5 ms is node. The two were never reconciled, and this file could not
 * have caught it — its size assertion was `toBeGreaterThan(35)`, a FLOOR and not a
 * ceiling, so a graph that only ever grows satisfies it forever.
 *
 * The gap was then attributed rather than guessed at: `a27f7975` was rebuilt and run
 * on this machine, on this node, beside the current build with the order alternating.
 * It measured 97.3 ms against the current 139.4 — 0.5% from what the archive recorded
 * for it — so the environment did not move and the 42 ms is OURS. It is NOT this list
 * getting longer: the July floor reached THIRTY modules under `commands/`, because the
 * rule below did not exist yet, and today it reaches none of them. A floor that carries
 * less work and costs more is not a floor that grew by our modules. Measured
 * marginally, `string-width` is 25.4 ms of it and did not exist in that build — which
 * is why the second table here declares the edges that are NOT the domain's, the table
 * it would have shown up in on the day it arrived.
 *
 * Bringing the floor down is a slice of its own. What this file does is make the number
 * stop growing unnoticed: a slice that puts a module or an edge on the floor now has to
 * say so IN THE DIFF, which is exactly what was missing both times.
 *
 * Three things it asserts, and they are different:
 *   - no COMMAND ADAPTER, no MCP SERVER, no COMPLETION GENERATOR and no INTERACTIVE
 *     SESSION is in the closure. That is the rule with no exceptions, and the one a
 *     careless import breaks. The third family reads the command tree rather than the
 *     record, so it looks free — it is not: a verb that walked the tree at module scope
 *     would put that walk on `mnema --version`, and `wiring/completion.ts` keeps
 *     `SHELLS` next to the flag that accepts them precisely so nothing under
 *     `completion/` has a reason to be reached before the verb runs. The fourth is the
 *     newest and it is the one that must not enter for the sharpest reason: the session
 *     exists BECAUSE the floor costs what it costs, and it reaches `node:readline`, the
 *     completion generator and the entry itself. A session imported at module scope
 *     would make every other verb pay for the thing built to stop paying.
 *   - every edge from the closure into `@mnema/*` is DECLARED, with the reason it
 *     has to be there. The floor reaches the domain in TWELVE places, five of them a
 *     constant or a parser commander needs before it can route anything — and the table
 *     is what makes the thirteenth visible instead of silent. It reconciles in both
 *     directions, so an edge that goes away has to leave too;
 *   - every MODULE of `src` on the floor is NAMED, and so is every edge out of it that
 *     is not the domain's. This is the ceiling, and it is structural for the same
 *     reason the rest of the file is: it counts what the source says rather than what
 *     the clock says. A module that arrives lands in `reached` BY NAME, so the failure
 *     says which one — a ceiling that only counted would be a ceiling that tells you to
 *     go looking, and the honest repair for one of those is to raise the number.
 *
 * WHAT IT DOES NOT COVER. A `--help` that changed is a declaration that became
 * lazy, and that is the golden's job (`cli.golden.test.ts`), not this file's. And a
 * static walk says nothing about whether an awaited load actually ran — which is
 * the OTHER defect of this shape, and why the second half of this file spawns two
 * real processes instead of reading source.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** `packages/code/src`, where the walk starts and stays. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

// ---------------------------------------------------------------------------
// What a module loads when it is loaded
// ---------------------------------------------------------------------------

/** `import { … } from '…'` and `export { … } from '…'`, anchored so a comment cannot match. */
const WITH_BRACES = /^[ \t]*(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
/**
 * A default or namespace import, with an optional named clause after it.
 *
 * The lookahead is not decoration: without it, `import type { X } from '…'` matches
 * with `type` read as the DEFAULT BINDING's name, and a type-only import of a
 * command adapter reads as loading it. That false positive put three adapters in the
 * floor on this guard's first run, and they were not there.
 */
const BARE =
  /^[ \t]*import\s+(type\s+)?(?!type\s*\{)(?:[A-Za-z_$][\w$]*|\*\s+as\s+[A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/gm;
/** `import '…'` — loaded for its effect, which is still loaded. */
const SIDE_EFFECT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
/** `export * from '…'` — a barrel loads what it plumbs. */
const STAR = /^[ \t]*export\s+\*\s+from\s*['"]([^'"]+)['"]/gm;

/**
 * The specifiers this source loads AT MODULE SCOPE, as the runtime does.
 *
 * A type-only import is not one: `verbatimModuleSyntax` makes the `type` modifier
 * mandatory, so a clause whose every name carries it is erased and costs nothing.
 * Neither is a dynamic `import()` — that is the whole point of this file, and it is
 * excluded by construction: every pattern here is anchored at the start of a line
 * with `import`/`export` as the first word, and a dynamic load is an expression.
 */
function eagerSpecifiers(source: string): Set<string> {
  const specifiers = new Set<string>();
  for (const clause of source.matchAll(WITH_BRACES)) {
    if (clause[1] !== undefined) continue;
    const names = (clause[2] as string)
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (names.length > 0 && names.every((name) => name.startsWith('type '))) continue;
    specifiers.add(clause[3] as string);
  }
  for (const clause of source.matchAll(BARE)) {
    if (clause[1] !== undefined) continue;
    specifiers.add(clause[2] as string);
  }
  for (const clause of source.matchAll(SIDE_EFFECT)) specifiers.add(clause[1] as string);
  for (const clause of source.matchAll(STAR)) specifiers.add(clause[1] as string);
  return specifiers;
}

/** One edge out of the walked graph: the file that loads, and what it loads. */
interface Edge {
  /** The importer, relative to `src`. */
  readonly from: string;
  /** The specifier as written. */
  readonly specifier: string;
}

/** Everything an entry point loads before it does anything. */
interface Closure {
  /** Every module of `src` reached, relative to `src`, sorted. */
  readonly modules: readonly string[];
  /** Every edge out of `src` — a package, a node builtin — sorted. */
  readonly external: readonly Edge[];
  /** A relative specifier that resolved to no file: a walk that stopped early. */
  readonly unresolved: readonly Edge[];
}

/**
 * Walks what loading `entry` loads, following static imports only.
 *
 * `unresolved` is carried rather than thrown because it is this walker's own
 * vacuity: a specifier it cannot resolve is a subtree it never visited, and a guard
 * that quietly stops walking passes for the wrong reason.
 */
function eagerClosure(entry: string): Closure {
  const seen = new Set<string>();
  const external: Edge[] = [];
  const unresolved: Edge[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const from = relative(SRC, file);
    for (const specifier of eagerSpecifiers(readFileSync(file, 'utf-8'))) {
      if (!specifier.startsWith('.')) {
        external.push({ from, specifier });
        continue;
      }
      const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
      if (existsSync(target)) queue.push(target);
      else unresolved.push({ from, specifier });
    }
  }
  const order = (a: Edge, b: Edge): number =>
    `${a.specifier} ${a.from}`.localeCompare(`${b.specifier} ${b.from}`);
  return {
    modules: [...seen].map((file) => relative(SRC, file)).sort(),
    external: external.sort(order),
    unresolved: unresolved.sort(order),
  };
}

// ---------------------------------------------------------------------------
// The declarations
// ---------------------------------------------------------------------------

/**
 * The packages whose load IS the floor — the ones measured at 38, 68 and 73 ms — and the
 * one SUBPATH that is here for the opposite reason.
 *
 * `@mnema/chain/one-line` is a leaf: one exported function, no imports of its own, and a
 * guard over its source that says so (`chain/src/one-line.test.ts`). It is named here
 * anyway, because the specifier one character shorter is the proof engine — and the day
 * somebody widens the re-export in `one-line.ts` to the index, the edge has to be
 * visible rather than lost in the difference between two strings.
 */
const DOMAIN = [
  '@mnema/chain',
  '@mnema/chain/one-line',
  '@mnema/core',
  '@mnema/core/write',
  '@mnema/copilot',
];

/**
 * The directories of `src` that hold WORK rather than declarations.
 *
 * A module under one of these is loaded when a verb runs and never before it: the command
 * adapters and the MCP server because they pull the domain, the completion generator
 * because it walks the whole command tree — which is cheap and is still work `mnema
 * --version` has no reason to do — and the interactive session because it drags all
 * three of readline, that same generator and the entry point behind it.
 *
 * AND THE QUESTION THE BARE NAME ASKS, which is the newest of them and joins for the
 * session's own reason: it draws with the same layout library, so a floor that loaded it
 * would make every verb of this product pay for a menu only one invocation ever sees.
 */
const WORK = ['choice', 'commands', 'mcp', 'completion', 'repl'];

/**
 * Every edge from the floor into the domain, and why that one cannot wait.
 *
 * Eight of the twelve are DECLARATIONS: commander is handed a help string or an
 * argument parser while the program is being built, before it has parsed a word, so
 * the value has to exist by then. Three are not, and they say so — they are what the
 * next pass at the floor is about, and all three cost nothing TODAY because the
 * declarations above them already hold `@mnema/core` open.
 *
 * THE COUNT USED TO SAY EIGHT, AND FIVE DECLARATIONS. What falsified it: the slice that
 * gave the surfaces one vocabulary added the sets' own module to the floor (two edges),
 * and the slice that split that module so both surfaces could read it added a third —
 * and the sentence went on saying eight through both, because a number in prose is the
 * one thing here that nothing checked. It is checked now: `reaches the domain only where
 * the declaration needs it` asserts the table's SIZE next to its contents, so the next
 * edge makes this paragraph red instead of stale. The twelfth arrived that way: the rule
 * of the line moved under all three packages, and the edge to its subpath announced
 * itself here the moment the specifier was named in `DOMAIN`.
 *
 * It reconciles in both directions, which is what keeps it from becoming the
 * allowlist every dead guard ends as: an edge that disappears has to leave this
 * table or the assertion fails.
 */
const EAGER_DOMAIN: Readonly<Record<string, string>> = {
  'one-line.ts @mnema/chain/one-line':
    'THE RULE OF THE LINE, and the one edge here that is a leaf. `oneLine` is what makes ' +
    'a report line one line, and it moved into `@mnema/chain` because the sentences that ' +
    'need it are written in three packages — the verifier’s findings, the domain’s ' +
    'refusals, this surface’s readings — and a surface cannot apply a rule to the inside ' +
    'of a sentence another package already joined. This file re-exports the SUBPATH, ' +
    'whose module imports nothing at all (`chain/src/one-line.test.ts` asserts it over ' +
    'the source); reaching it is not reaching the proof engine. It is eager because the ' +
    'two modules that want it here — `wiring/no-such-record.ts` and ' +
    '`presentation/runs.ts` — are on this floor, and a curative at their call sites is ' +
    'exactly what two earlier slices paid and this one removed.',
  'cli.ts @mnema/core':
    'the last-resort catch recognizes the domain’s own refusal by its class. NOT a ' +
    'declaration: it could be loaded inside the catch, which is free today because ' +
    'the declarations below already hold core open, and would cost a domain load on ' +
    'an unrelated throw the day they do not.',
  'pinned-run.ts @mnema/chain':
    'the entry builds the pinned-run resolver, and resolving a run replays the record. ' +
    'NOT a declaration: the resolver is memoized and sync, so deferring it means ' +
    'awaiting it at thirteen call sites — mechanical, type-checked, and worth nothing ' +
    'until the declarations stop holding the domain open.',
  'pinned-run.ts @mnema/core': 'the same resolver, for the trees it resolves the run in.',
  'recorded-content.ts @mnema/chain':
    '`mnema link --rel` names the catalog’s recommended relations in its help.',
  'recorded-content.ts @mnema/core':
    'the content contract every writing verb prints after its help states the field ' +
    'size limit the door enforces.',
  'wiring/options.ts @mnema/core':
    '`--which` is validated by commander’s own argument parser, which is synchronous ' +
    'and runs during the parse. What counts as naming an agent is `canonicalIdentity` ' +
    'and never a trim of our own — a second reading of blank would disagree with the ' +
    'one that decides what the chain records. THIS is the edge that holds the floor: ' +
    'it is the only one that needs behaviour rather than a constant.',
  'wiring/refs.ts @mnema/copilot': '`--depth` states its default and its cap in its help.',
  'wiring/search.ts @mnema/core': '`--limit` states its default and its cap in its help.',
  'vocabulary.ts @mnema/chain':
    '`--require` lists the three levels, so the chain’s own tuple of them is read while ' +
    'commander is being configured. A CONSTANT, and the tuple the flag’s refusal words ' +
    'itself from — one set, or the help and the no can disagree.',
  'vocabulary.ts @mnema/core':
    'the closed sets of domain words BOTH surfaces take: the workflow actions and the ' +
    'tables that say which proof each needs, the scopes, the kinds of record. CONSTANTS, ' +
    'and they are what the help prints — a declaration commander is handed before it has ' +
    'parsed a word. The alternative was each surface re-typing them, which is the defect ' +
    'this module closed.',
  'wiring/enumerated.ts @mnema/core':
    'the decision vocabulary MINUS the actions that have a verb of their own, which is ' +
    'what `decision move` offers. A CONSTANT, derived by exclusion so a fourth decision ' +
    'action arrives in the help by itself, and typed so a rename in the core breaks the ' +
    'build instead of quietly offering a word the move cannot take.',
};

/**
 * Every edge out of the floor that is NOT the domain's, and why it is on the floor.
 *
 * The domain table above is about reaching `@mnema/*`. This one is about reaching
 * anything else — a third-party package, a node builtin — and it exists because the
 * expensive kind of growth does not have to be ours. The layout library has a case of
 * its own further down, for being the one that was measured at a fifth of a second;
 * this is the general rule that would have caught it, and that catches the next one
 * before anybody has to notice it in a report.
 *
 * `string-width` is the newest and is the shape of the risk: it arrived because a line
 * has to be measured in COLUMNS rather than code units, it is small, and nothing in
 * this file would have said a word about it.
 */
const EAGER_EXTERNAL: Readonly<Record<string, string>> = {
  'cli.ts commander':
    'the entry BUILDS the program with it. It is the floor by definition — commander is ' +
    'what routes the word, so nothing can be decided before it is loaded.',
  'wiring/completion.ts commander':
    'the completion FLAG is declared on the program while it is being built; what the ' +
    'flag runs lives under `completion/` and is loaded when the verb runs.',
  'wiring/enumerated.ts commander': 'the type of the choices it hands commander.',
  'wiring/options.ts commander':
    'the shared options are commander’s own `Option` objects, which is what makes one ' +
    'declaration serve every verb that takes them.',
  'env.ts node:os':
    '`homedir()`, for the discovery environment every verb is handed. A builtin, and ' +
    'the one the entry cannot defer: the environment is resolved before a verb runs.',
  'presentation/width.ts string-width':
    'a line is as wide as the COLUMNS it takes, and the authority on that is a table ' +
    'this product does not keep. The floor reaches it because the wiring composes help ' +
    'and refusals with the same measurement the report uses — one reading of width, or ' +
    'the surface and the frame around it disagree.',
};

/**
 * Every module of `src` the floor loads, by name.
 *
 * THE CEILING, and it is a list rather than a number for one reason: a number can be
 * raised. This file's size assertion used to be `toBeGreaterThan(35)` — a floor under
 * the floor, which a graph that only grows satisfies forever — and while it stood, the
 * measured cost of loading this list went from 97.8 ms to 143 ms with nothing saying
 * so. A count would have gone red and been "fixed" by editing the count. A name has to
 * be ADDED, which is a sentence in a diff saying *I put this on the floor*.
 *
 * Most of it is `wiring/`, and that is the rule working rather than a leak: commander
 * needs every command, option and line of help before it can route a word, so every
 * verb's DECLARATION belongs here. What does not belong is the work behind it, and the
 * first assertion of this file is what says so.
 *
 * `presentation/` is here for a reason worth naming, because it is the part a reader
 * would question: the declarations compose sentences — help, refusals, the contract
 * printed under a verb's help — and composing a sentence is what that directory is.
 * It reaches no adapter and no record; the walk above is what says so.
 */
const FLOOR_MODULES: readonly string[] = [
  'cli.ts',
  'env.ts',
  'one-line.ts',
  'pinned-run.ts',
  'presentation/detail.ts',
  'presentation/folded.ts',
  'presentation/items.ts',
  'presentation/plain.ts',
  'presentation/runs.ts',
  'presentation/styled.ts',
  'presentation/verdict.ts',
  'presentation/width.ts',
  // THE ONE MODULE HERE THAT IS NOT A DECLARATION AND NOT A SENTENCE, and it is on the
  // floor by a decision rather than by the rule. `mnema switch` declares its channel
  // argument out of the closed set of channels this product pushes, and that set lives
  // where the channels are decided (`record-framing.ts`) — so commander needs it before
  // it can print a line of help. Typing the two names into the wiring instead would be
  // the second spelling the whole module exists to have ended. What it costs is ONE file
  // with no imports of its own: it reaches no adapter, no record and no package, which
  // the walk above is what proves.
  'record-framing.ts',
  'recorded-content.ts',
  'reference-directions.ts',
  'session-words.ts',
  'version.ts',
  'vocabulary.ts',
  'wiring/accountability.ts',
  'wiring/antipatterns.ts',
  'wiring/brief.ts',
  'wiring/color.ts',
  'wiring/completion.ts',
  'wiring/context.ts',
  'wiring/decision.ts',
  'wiring/enumerated.ts',
  'wiring/exposure.ts',
  'wiring/focus.ts',
  'wiring/guard.ts',
  'wiring/handoff.ts',
  'wiring/index.ts',
  'wiring/init.ts',
  'wiring/io.ts',
  'wiring/key.ts',
  'wiring/link.ts',
  'wiring/mcp.ts',
  'wiring/memory.ts',
  'wiring/misuse.ts',
  'wiring/next-actions.ts',
  'wiring/no-such-record.ts',
  'wiring/observe.ts',
  'wiring/on-one-line.ts',
  'wiring/options.ts',
  'wiring/refs.ts',
  'wiring/repl.ts',
  'wiring/report.ts',
  'wiring/resume.ts',
  'wiring/rules.ts',
  'wiring/run-pin.ts',
  'wiring/run.ts',
  'wiring/search.ts',
  'wiring/show.ts',
  'wiring/skill.ts',
  'wiring/skills.ts',
  'wiring/status.ts',
  'wiring/switch.ts',
  'wiring/tail.ts',
  'wiring/task.ts',
  'wiring/timeline.ts',
  'wiring/usage.ts',
  'wiring/verb.ts',
  'wiring/verify.ts',
];

/** What an exception table tolerates, and what it does not. */
interface Reconciliation {
  /** Reached and NOT declared — the guard's teeth. */
  readonly reached: readonly string[];
  /** Declared and no longer reached — a declaration that outlived its reason. */
  readonly stale: readonly string[];
}

/**
 * Reconciles what the walk found against what is declared, both ways at once.
 *
 * It takes the declared NAMES rather than a table, because the floor is declared in
 * three shapes now — two tables with a reason per edge, and a plain list of the
 * modules — and this is one rule about two sets. Three readings of "is everything
 * accounted for" would be three chances for one of them to be the lenient one.
 */
function reconcile(found: readonly string[], declared: readonly string[]): Reconciliation {
  return {
    reached: found.filter((edge) => !declared.includes(edge)).sort(),
    stale: declared.filter((name) => !found.includes(name)).sort(),
  };
}

// ---------------------------------------------------------------------------
// The walk, once
// ---------------------------------------------------------------------------

const FLOOR = eagerClosure(join(SRC, 'cli.ts'));

/** Every `<module> <specifier>` edge from the floor into the domain. */
const DOMAIN_EDGES = FLOOR.external
  .filter((edge) => DOMAIN.includes(edge.specifier))
  .map((edge) => `${edge.from} ${edge.specifier}`);

/** And every edge out of the floor that is NOT the domain's — the other half. */
const EXTERNAL_EDGES = FLOOR.external
  .filter((edge) => !DOMAIN.includes(edge.specifier))
  .map((edge) => `${edge.from} ${edge.specifier}`);

/** Every source file under a directory of `src`. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(SRC, directory), { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...filesUnder(join(directory, entry.name)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

describe('the floor is the declaration', () => {
  it('loads no command adapter, no MCP server, no completion generator and no session', () => {
    // The rule, with no exceptions. An adapter at module scope in a wiring file is
    // how the floor grew the first time, and it is invisible in review: the import
    // looks like every other import in the file.
    const work = FLOOR.modules.filter((module) =>
      WORK.some((directory) => module.startsWith(`${directory}/`)),
    );
    expect(work).toEqual([]);
  });

  it('reaches the domain only where the declaration needs it', () => {
    // One assertion, both directions: a new eager import of the chain, the core or
    // the copilot lands in `reached` until somebody writes down why it cannot wait,
    // and an edge that goes away lands in `stale` until its entry is deleted.
    expect(reconcile(DOMAIN_EDGES, Object.keys(EAGER_DOMAIN))).toEqual({ reached: [], stale: [] });
    // And the SIZE, so the number this file's own doc states cannot drift from the
    // table it describes. It drifted twice before anybody noticed — the prose said
    // eight through two slices that made it ten and then eleven.
    expect(Object.keys(EAGER_DOMAIN)).toHaveLength(12);
  });

  it('loads these modules and no others — the ceiling, by name', () => {
    // THE CEILING. A module that arrives lands in `reached` and the failure NAMES it;
    // a module that leaves lands in `stale` and the entry has to go. It is a list and
    // not a count because a count can be raised without looking, and this floor has
    // now grown unnoticed twice: 90 → 121 through nineteen PRs, and 97.8 → 143 through
    // the ones after that, both while this file was green.
    expect(reconcile(FLOOR.modules, FLOOR_MODULES)).toEqual({ reached: [], stale: [] });
  });

  it('leaves the floor for nothing but what is declared out there either', () => {
    // The other direction out: a package or a builtin. The expensive growth does not
    // have to be ours — `string-width` arrived this way, small and unremarked — and
    // this reconciles both ways over the same rule the domain table uses.
    expect(reconcile(EXTERNAL_EDGES, Object.keys(EAGER_EXTERNAL))).toEqual({
      reached: [],
      stale: [],
    });
  });

  it('walks a graph that is really there', () => {
    // This file's own non-vacuity. The assertions above are about a SET, so a walk
    // that stopped at the entry — a specifier shape this parser stopped recognizing,
    // a rename — would have to be met by deleting the declarations rather than by
    // going green on its own; these are the anchors that say the walk arrived.
    expect(FLOOR.modules).toContain('cli.ts');
    expect(FLOOR.modules).toContain('wiring/index.ts');
    // Every verb's DECLARATION is in the floor, which is the other half of the rule:
    // commander cannot route a word or print `--help` without them. Read off the map
    // of the surface rather than off the directory, because `verb.ts` is types alone
    // and is erased — being absent from the floor is what it should be.
    const verbs = [...eagerSpecifiers(readFileSync(join(SRC, 'wiring/index.ts'), 'utf-8'))]
      .filter((specifier) => specifier.startsWith('./'))
      .map((specifier) => join('wiring', specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts')));
    expect(verbs.length).toBeGreaterThanOrEqual(25);
    for (const verb of verbs) expect(FLOOR.modules).toContain(verb);
    // And the work the first assertion says is absent does EXIST — otherwise it would be
    // reporting empty directories. Asked of every one of them, so a family added to
    // {@link WORK} without files, or renamed, cannot leave that assertion vacuous.
    expect(filesUnder('commands').length).toBeGreaterThan(20);
    for (const directory of WORK)
      expect(filesUnder(directory).length, directory).toBeGreaterThan(0);
    // A relative specifier that resolves to nothing is a subtree never visited.
    expect(FLOOR.unresolved).toEqual([]);
    // The walker follows a value import INTO the domain — proved where the domain is
    // supposed to be reached, so "no edges" elsewhere means something.
    const adapter = eagerClosure(join(SRC, 'commands/task.ts'));
    expect(adapter.external.map((edge) => edge.specifier)).toContain('@mnema/core/write');
  });

  it('never loads the layout library, which is the newest thing it must not pay for', () => {
    // The session's console draws with a library, and that library is the most expensive
    // import on this surface — measured at a fifth of a second, against a floor of about
    // a tenth. It is paid ONCE, when a caller asks for a session, and by nobody else:
    // `mnema --version` and every verb that reads must not know it exists.
    const external = FLOOR.external.map((edge) => edge.specifier);
    for (const part of ['ink', 'react']) expect(external, part).not.toContain(part);
    // Not vacuous: the console really does load it, so the absence above is a fact about
    // the floor rather than about a library nobody installed.
    const console = eagerClosure(join(SRC, 'repl/console.ts'));
    expect(console.external.map((edge) => edge.specifier)).toContain('ink');
    expect(console.unresolved).toEqual([]);
  });

  it('reads an import the way the runtime does', () => {
    // The extractor's own non-vacuity, on input this test owns: each thing it must
    // see, and each thing it must not. The `import type` case is not hypothetical —
    // it is the false positive this guard shipped with for one run.
    const loads = (source: string): string[] => [...eagerSpecifiers(source)];

    expect(loads("import { runTask } from '../commands/task.js';")).toContain(
      '../commands/task.js',
    );
    expect(loads("import { type Scope, canonicalIdentity } from '@mnema/core';")).toContain(
      '@mnema/core',
    );
    expect(loads("import runTask from '../commands/task.js';")).toContain('../commands/task.js');
    expect(loads("import * as all from '@mnema/core';")).toContain('@mnema/core');
    expect(loads("import '@mnema/core';")).toContain('@mnema/core');
    expect(loads("export { runTask } from '../commands/task.js';")).toContain(
      '../commands/task.js',
    );
    expect(loads("import {\n  runTask,\n  runShow,\n} from '../commands/task.js';")).toContain(
      '../commands/task.js',
    );

    expect(loads("import type { InitResult } from '../commands/init.js';")).toEqual([]);
    expect(loads("import type Thing from '../commands/init.js';")).toEqual([]);
    expect(loads("import { type TreeReport } from '../commands/verify.js';")).toEqual([]);
    expect(loads("export type { Brief } from '@mnema/copilot';")).toEqual([]);
    // The whole point: a load inside an action is not a load at module scope.
    expect(loads("      const { runTask } = await import('../commands/task.js');")).toEqual([]);
    // And prose that mentions one is not one.
    expect(loads(" * import { runTask } from '../commands/task.js';")).toEqual([]);
    expect(loads("// import { runTask } from '../commands/task.js';")).toEqual([]);
  });

  it('tolerates a declared edge and still reports an undeclared one', () => {
    // The table's mechanism, on names this test owns. The real table is not empty, so
    // the assertion above exercises the tolerant direction — but not the stale one,
    // which is what keeps the table from outliving its reasons.
    const found = ['a.ts @mnema/core', 'b.ts @mnema/chain'];
    expect(reconcile(found, ['a.ts @mnema/core'])).toEqual({
      reached: ['b.ts @mnema/chain'],
      stale: [],
    });
    expect(reconcile([], ['a.ts @mnema/core'])).toEqual({
      reached: [],
      stale: ['a.ts @mnema/core'],
    });
    expect(reconcile(found, [])).toEqual({ reached: found, stale: [] });
  });
});

// ---------------------------------------------------------------------------
// And the load actually runs
// ---------------------------------------------------------------------------

let sandbox: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-floor-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs a real `mnema` in its own process, against the sandbox and nothing else. */
function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const inherited = { ...process.env };
  // A run pinned in this process's environment names a session the sandbox has no
  // record of, and every write would be refused for the wrong reason.
  delete inherited.MNEMA_RUN;
  const done = spawnSync(process.execPath, [CLI, ...args], {
    cwd: sandbox,
    env: { ...inherited, HOME: home, XDG_DATA_HOME: join(home, 'data') },
    encoding: 'utf-8',
  });
  return { status: done.status, stdout: done.stdout, stderr: done.stderr };
}

describe('a verb that loads its work still answers', () => {
  // The defect this pair exists for is silent: an `import()` nobody awaits makes the
  // action return before it has written anything, and the process exits — code zero,
  // no output, nothing to see. Both halves are asserted TOGETHER, because each alone
  // is satisfied by the defect: a missing line still exits, and an exit code still
  // arrives with nothing printed. And they are two verbs because the two paths are
  // different code: one ends at `io.fail()`, the other at a write and a report.
  //
  // In a real process, not through the injected io: the failure mode IS the process
  // exiting first, and an in-process test awaits the same promise commander does.

  it('refuses in a directory that is no project — and says so, and exits non-zero', () => {
    const done = cli('verify');
    expect(done.stderr).toContain('No mnema project here');
    expect(done.status).not.toBe(0);
  });

  it('writes, prints what it recorded, and exits zero', () => {
    expect(cli('init').status).toBe(0);
    const done = cli('task', 'a task the floor test wrote');
    expect(done.stdout).toContain('Created task ');
    expect(done.status).toBe(0);
    // TWO PROCESSES, and one of them FOUNDS a project — the only case in this file that
    // writes, and the only one that pays a key being made. 237 ms on a quiet machine and
    // 1006 ms with the suite running at a load of twenty.
  }, 60_000);
});

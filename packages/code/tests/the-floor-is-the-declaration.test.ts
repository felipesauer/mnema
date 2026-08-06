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
 * would be a flake somebody switches off — and then the floor grows back, which is
 * exactly what happened before: the record of an earlier pass says the floor had
 * been brought to 90 ms, and nineteen PRs later it was 121, because nothing
 * measured. So this walks the entry's STATIC imports and states what they reach.
 * The milliseconds belong in a report.
 *
 * Two things it asserts, and they are different:
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
 *     has to be there. The floor still reaches the domain in EIGHT places, five of
 *     them a constant or a parser commander needs before it can route anything —
 *     and the table is what makes the ninth one visible instead of silent. It
 *     reconciles in both directions, so an edge that goes away has to leave too.
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

/** The packages whose load IS the floor — the ones measured at 38, 68 and 73 ms. */
const DOMAIN = ['@mnema/chain', '@mnema/core', '@mnema/core/write', '@mnema/copilot'];

/**
 * The directories of `src` that hold WORK rather than declarations.
 *
 * A module under one of these is loaded when a verb runs and never before it: the command
 * adapters and the MCP server because they pull the domain, the completion generator
 * because it walks the whole command tree — which is cheap and is still work `mnema
 * --version` has no reason to do — and the interactive session because it drags all
 * three of readline, that same generator and the entry point behind it.
 */
const WORK = ['commands', 'mcp', 'completion', 'repl'];

/**
 * Every edge from the floor into the domain, and why that one cannot wait.
 *
 * Eight of the eleven are DECLARATIONS: commander is handed a help string or an
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
 * edge makes this paragraph red instead of stale.
 *
 * It reconciles in both directions, which is what keeps it from becoming the
 * allowlist every dead guard ends as: an edge that disappears has to leave this
 * table or the assertion fails.
 */
const EAGER_DOMAIN: Readonly<Record<string, string>> = {
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

/** What an exception table tolerates, and what it does not. */
interface Reconciliation {
  /** Reached and NOT declared — the guard's teeth. */
  readonly reached: readonly string[];
  /** Declared and no longer reached — a declaration that outlived its reason. */
  readonly stale: readonly string[];
}

/** Reconciles what the walk found against what the table declares, both ways at once. */
function reconcile(
  found: readonly string[],
  declared: Readonly<Record<string, string>>,
): Reconciliation {
  const names = Object.keys(declared);
  return {
    reached: found.filter((edge) => !names.includes(edge)).sort(),
    stale: names.filter((name) => !found.includes(name)).sort(),
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
    expect(reconcile(DOMAIN_EDGES, EAGER_DOMAIN)).toEqual({ reached: [], stale: [] });
    // And the SIZE, so the number this file's own doc states cannot drift from the
    // table it describes. It drifted twice before anybody noticed — the prose said
    // eight through two slices that made it ten and then eleven.
    expect(Object.keys(EAGER_DOMAIN)).toHaveLength(11);
  });

  it('walks a graph that is really there', () => {
    // This file's own non-vacuity. Both assertions above are about ABSENCE, so a
    // walk that stopped at the entry — a specifier shape this parser stopped
    // recognizing, a rename — would pass them saying nothing at all.
    expect(FLOOR.modules.length).toBeGreaterThan(35);
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
    expect(reconcile(found, { 'a.ts @mnema/core': 'the reason' })).toEqual({
      reached: ['b.ts @mnema/chain'],
      stale: [],
    });
    expect(reconcile([], { 'a.ts @mnema/core': 'the reason' })).toEqual({
      reached: [],
      stale: ['a.ts @mnema/core'],
    });
    expect(reconcile(found, {})).toEqual({ reached: found, stale: [] });
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
  });
});

/**
 * EVERY PRODUCT FILE HAS A TEST THAT ASSERTS ABOUT IT — and the suite says which do not.
 *
 * COVERAGE ANSWERS A DIFFERENT QUESTION, and this repository measured the gap against
 * itself: FOUR files sat at 100% line coverage with no test naming them. A line that ran
 * is not a property that was pinned. A module imported in passing by a case asserting
 * about something else is green in the report and holds nothing. (Both this comment and
 * `support/witnessing.ts` said five, after the plan that opened the slice; the fifth path
 * it named, `core/src/projections/session-store.ts`, is in no commit of this repository.)
 *
 * So the question here is narrower than "is it covered" and wider than "is it imported":
 *
 *     Does some assertion observe a VALUE this file produced?
 *
 * `support/witnessing.ts` answers it, and its module comment carries the argument. In
 * short: a test WITNESSES a file when it imports it through a relative specifier — the
 * only kind that reaches a package's SOURCE rather than its built `dist` — and an
 * `expect(...)` in that file mentions something the imported bindings can reach, through
 * assignment, through a helper function, or through a collaborator HANDED to them.
 *
 * WHAT THIS DOES NOT ANSWER, said plainly, because a guard that overstates itself is
 * worse than none:
 *
 *   1. AN END-TO-END REACH IS NOT A WITNESS. Thirty-four modules under `wiring/` are
 *      composed into `cli.ts` and driven by `cli-e2e.test.ts`; mutate one and it reddens.
 *      Nothing observes a value they returned, because they return none, so they are all
 *      in the ledger below with what does reach them written per entry. This is the
 *      largest hole and it is declared rather than papered over.
 *   2. A CORPUS WALK IS NOT A WITNESS. Guards here read every file under a directory and
 *      assert over the result. By the mutation standard that IS an assertion about each
 *      file — and counting it would make this guard vacuous, because the repo-wide sweeps
 *      already reach nearly every file in `packages/code/src`. What such a sweep pins is
 *      one structural fact, never a behaviour, and the whole distance between coverage
 *      and this property lives in that difference.
 *   3. IT CANNOT GRADE AN ASSERTION. `expect(x).toBeDefined()` counts the same as a
 *      round-trip. This says a property is pinned, never that it is a good one.
 *   4. THE UNIVERSE IS THE COVERAGE GATE'S, WHICH LEAVES SHIPPED CODE OUT OF IT.
 *      `plugin/hooks/session-start.mjs` is shipped and would be accused by the rule below
 *      if it were here — but the globs are `packages/**\/src/**\/*.ts`, read off
 *      `vitest.config.ts` and asserted back. Writing a second definition of production
 *      here is the exact shape that produces two answers, so the plugin tree waits for the
 *      gate to cover it rather than for this file to disagree with the gate.
 *   5. AN ERASED IMPORT IS NOT AN IMPORT. `import type { Clock } from './clock.js'` is
 *      struck out whole before the test runs, so the module is never loaded and nothing
 *      it would produce can have been observed. This counted as an import until the
 *      second reading of the scanner, and six files were called witnessed on the strength
 *      of it alone — `writer.ts`, `record-effect.ts`, `run-pin.ts`, `intelligence/
 *      events.ts`, `sources.ts` and `workflow/clock.ts`, each now a row below.
 *
 * THE LEDGER IS A BOOK OF DEBT, NOT A DISPENSATION. It is reconciled in FOUR directions at
 * once: a product file with no witness that is not in it is accused, an entry that has
 * GAINED a witness is accused, an entry whose stated reach no longer holds is accused, and
 * an entry whose path names no product file is accused. Every entry carries the reason for
 * THAT file — what reaches it today and what that reaches instead — so it can be drained
 * one row at a time. It can only shrink.
 *
 * AND IT CANNOT DISSOLVE ITSELF. The ledger's keys are 81 path strings. Under a rule that
 * read path literals, listing a file as debt would witness it and every entry would go
 * stale the moment it was written. Naming requires an IMPORT here, so a table of strings
 * names nothing — asserted below rather than assumed.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';
import {
  assertionStatements,
  boundNames,
  flowsIn,
  importClauses,
  isTestFile,
  isTypeOnlyClause,
  normalizePath,
  reachedFrom,
  resolveImport,
  type TestSource,
  type Unresolved,
  witnessing,
} from './support/witnessing.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGES = join(REPO, 'packages');

/** A repo-relative path with forward slashes, whatever the platform writes. */
const asPath = (absolute: string): string => relative(REPO, absolute).split(sep).join('/');

// ---------------------------------------------------------------------------
// The two corpora
// ---------------------------------------------------------------------------

/** Every `.ts` under a package, tests included — the walk `sourceFiles` will not do. */
function everyTypeScript(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...everyTypeScript(path));
      continue;
    }
    if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

const WORKSPACE = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/**
 * A package this walk cannot read, kept rather than thrown at.
 *
 * `sourceFiles` opens `<package>/src`, so a package directory without one used to end this
 * file in an ENOENT during COLLECTION — a stack trace where the guard's own subject is a
 * missing directory, and no case to name it. The walk skips them and a case below says
 * which, which is the difference between a guard reporting and a guard dying.
 */
const WITHOUT_SOURCE = WORKSPACE.filter((pkg) => !existsSync(join(PACKAGES, pkg, 'src')));
const READABLE = WORKSPACE.filter((pkg) => !WITHOUT_SOURCE.includes(pkg));

/**
 * The universe: what the coverage gate calls production.
 *
 * Not a definition of this file's own. `vitest.config.ts` already states which files the
 * product is measured over, and a second statement of it is how the two would come to
 * disagree — so the globs are read back below and this walk is asserted to implement
 * them. Note what that means and what the plan's own inventory got wrong: the exclude is
 * `packages/**\/src/index.ts`, a PACKAGE's barrel, so the four nested barrels
 * (`wiring/`, `identity/`, `topology/`, `workflow/`) are production here.
 */
const PRODUCTION: readonly string[] = READABLE.flatMap((pkg) =>
  sourceFiles(join(PACKAGES, pkg, 'src'))
    .map(asPath)
    .filter((path) => !path.endsWith('.d.ts') && !/\/src\/index\.ts$/.test(path)),
).sort();

/** The test tree: every case, and the helpers under `tests/` a case may import. */
const TEST_TREE: readonly TestSource[] = READABLE.flatMap((pkg) =>
  everyTypeScript(join(PACKAGES, pkg))
    .map(asPath)
    .filter((path) => path.endsWith('.test.ts') || path.includes('/tests/')),
)
  .sort()
  .map((path) => ({ path, text: readFileSync(join(REPO, path), 'utf-8') }));

/**
 * Every import clause in that tree, counted rather than bounded.
 *
 * A FLOOR CANNOT SEE A SCANNER STOP SCANNING. The case that reads this used to say
 * `toBeGreaterThan(2000)`, and the narrowing of the clause grammar is one character away
 * from losing real imports in silence: dropping `_` from `[\w$*,{}\s]` loses 211 of these
 * and leaves 2145, which clears that floor and reddens nothing else in this file. Restate
 * this number when the tree gains an import, which is the point of writing it down.
 */
const CLAUSES_IN_THE_TREE = 2362;

const { importedBy, witnessedBy, unresolved } = witnessing(PRODUCTION, TEST_TREE, codeOnly);

/** How a file with no witness is reached today — the two shapes of the same debt. */
type Reach = 'nobody imports it' | 'imported, and no assertion observes it';

/** One row of the ledger: how it is reached, and why that leaves nothing asserted. */
interface Debt {
  readonly reached: Reach;
  readonly why: string;
}

/** Every product file no assertion observes, with how it is reached. */
function unwitnessed(): Map<string, Reach> {
  const found = new Map<string, Reach>();
  for (const file of PRODUCTION) {
    if ((witnessedBy.get(file) ?? []).length > 0) continue;
    found.set(
      file,
      (importedBy.get(file) ?? []).length === 0
        ? 'nobody imports it'
        : 'imported, and no assertion observes it',
    );
  }
  return found;
}

/** What a declaration tolerates and what it does not — all four ways at once. */
interface Reconciliation {
  /** No witness and no entry: a product file nobody asserts about, undeclared. */
  readonly undeclared: readonly string[];
  /** An entry that has gained a witness. It has to leave; the ledger only shrinks. */
  readonly stale: readonly string[];
  /** An entry whose reach changed — imported since, or the importer removed. */
  readonly misdescribed: readonly string[];
  /** An entry whose path is no product file: renamed, deleted, or mistyped. */
  readonly unknown: readonly string[];
}

export function reconcile(
  found: ReadonlyMap<string, Reach>,
  declared: Readonly<Record<string, Debt>>,
  universe: readonly string[],
): Reconciliation {
  const names = Object.keys(declared);
  const known = new Set(universe);
  return {
    undeclared: [...found.keys()].filter((file) => !names.includes(file)).sort(),
    stale: names.filter((file) => known.has(file) && !found.has(file)).sort(),
    misdescribed: names
      .filter((file) => found.has(file) && found.get(file) !== declared[file]?.reached)
      .sort(),
    unknown: names.filter((file) => !known.has(file)).sort(),
  };
}

// ---------------------------------------------------------------------------
// The specifiers that led nowhere
// ---------------------------------------------------------------------------

/** How a row of the specifier list is addressed: the file, and what it asked for. */
const asRow = (one: Unresolved): string => `${one.from} -> ${one.specifier}`;

/** What the specifier list tolerates and what it does not, in both directions. */
interface Followed {
  /** A specifier that led nowhere and has no row: a deletion, or a typed path. */
  readonly unexplained: readonly string[];
  /** A row nothing produces any more — it resolves now, or the import is gone. */
  readonly obsolete: readonly string[];
}

export function reconcileFollowed(
  missed: readonly Unresolved[],
  declared: Readonly<Record<string, string>>,
): Followed {
  const rows = Object.keys(declared);
  const seen = missed.map(asRow);
  return {
    unexplained: seen.filter((row) => !rows.includes(row)).sort(),
    obsolete: rows.filter((row) => !seen.includes(row)).sort(),
  };
}

/**
 * Every relative specifier this scanner follows and finds nothing at, with why.
 *
 * NOT A LIST OF EXCEPTIONS — a list of what the resolver cannot see, which is a narrower
 * thing. It looks for `<base>.ts`, `<base>` with `.js` swapped for `.ts`, and
 * `<base>/index.ts`, and only among the paths the two corpora walked. Everything below is
 * a specifier that is CORRECT and still cannot resolve for one of those two reasons; a
 * specifier that is simply wrong belongs nowhere but in a fix.
 *
 * It only shrinks, and `reconcileFollowed` reads it both ways: a specifier that led
 * nowhere and has no row is accused, and a row nothing produces any more is accused too,
 * so a path that gets corrected cannot leave its excuse behind. Each row says what that
 * module is; two rows never carry the same sentence, for the reason the ledger's header
 * gives.
 */
const LED_NOWHERE: Readonly<Record<string, string>> = {
  'packages/code/tests/the-red-says-why-it-went-red.test.ts -> ../../../.github/why-it-went-red/ledger.mjs':
    'The vitest reporter that writes the ledger a red run is explained from. It is plain ESM under .github/, outside the packages/ walk either corpus makes, and this resolver only ever names a .ts — so the specifier is right and unfollowable at once.',
  'packages/code/tests/the-red-says-why-it-went-red.test.ts -> ../../../.github/why-it-went-red/verdict.mjs':
    'The script that re-runs one red case alone and prints the verdict. Same tree and same extension as the reporter beside it, and the same consequence: nothing about this file is asserted THROUGH the scanner, only by the cases that import it directly.',
  'packages/code/tests/the-sampler-counts-or-refuses.test.ts -> ../../../.github/flake-sampler/summarize.mjs':
    'The summariser the flake sampler folds N runs with. It lives under .github/ beside the workflow that calls it rather than in a package, because nothing the product ships imports it — which is exactly why the scanner cannot reach it.',
  'packages/copilot/tests/readme-example.test.ts -> ../src/index.js':
    "The copilot package's barrel. This one DOES exist under packages/, and is unresolvable for the other reason entirely: the coverage gate excludes a package's src/index.ts from what it measures, PRODUCTION implements that exclusion, and so the barrel is in no corpus for a specifier to land in.",
  'packages/core/src/index.test.ts -> ./index.js':
    "The core package's barrel, named by the case that sits next to it. Excluded by the same glob as the copilot barrel, and worth its own row because the two are reached differently: this one is imported from inside src/, where a test file lives beside the source it names.",
};

// ---------------------------------------------------------------------------
// The debt
// ---------------------------------------------------------------------------

/**
 * Every product file no assertion observes a value from, with the reason for THAT file.
 *
 * A BOOK OF DEBT, NOT A DISPENSATION. Each row says what this file is, what reaches it
 * today, and what that reaching pins instead — so a row can be drained on its own by
 * someone who has read nothing else. Two rows never carry the same sentence; a shared
 * excuse is how a table like this becomes a rubber stamp, and it is what the guard over
 * the MCP's write tools found rotted the last time it was a hand-kept list of names.
 *
 * IT ONLY SHRINKS. `reconcile` reads it four ways at once: a file with no witness and no
 * row is accused, a row whose file has GAINED a witness is accused and has to leave, a row
 * whose stated reach no longer holds is accused, and a row whose path names nothing in
 * production is accused. A row cannot be added in silence either — the counts below move
 * with it.
 *
 * THE SHAPE OF WHAT IS LEFT, so the next slice can pick its ground — counted off the rows
 * below, not estimated: thirty-four modules under `wiring/`, which are commander
 * declarations composed into `cli.ts` and driven by `cli-e2e`; twelve under
 * `presentation/`, which render lines nothing reads back; four projection stores in `core`,
 * reached only as `ProjectionCache` method bodies; four under `completion/`; four under
 * `commands/`; and three barrels, which export and declare nothing. The remaining twenty
 * are scattered, and the largest thing they share is the erasure in point 4 above.
 */
const UNWITNESSED: Readonly<Record<string, Debt>> = {
  'packages/chain/src/chain/enrollment.ts': {
    reached: 'nobody imports it',
    why: 'resolveIdentity, the enrollment fold: no test calls it, and enrollment.test.ts only regex-matches its issue wording inside the flattened issues array of verify().',
  },
  'packages/chain/src/chain/verify.ts': {
    reached: 'nobody imports it',
    why: "The verifier itself: no test imports verifyChain, since all of them go through chain.ts's verify() wrapper, and canonicalIdentityForm is asserted only through @mnema/chain, i.e. dist.",
  },
  'packages/chain/src/chain/writer.ts': {
    reached: 'nobody imports it',
    why: 'The ChainWriter class: six tests name it and all six spell `import type`, taking their writer from openChainForWriting in chain.ts instead, so every assertion observes a value THAT module returned.',
  },
  'packages/chain/src/events/envelope.ts': {
    reached: 'nobody imports it',
    why: 'A types-only module (Who, Which, Envelope): every importer uses import type, so it emits no runtime code and there is no value for any assertion to observe.',
  },
  'packages/chain/src/one-line.ts': {
    reached: 'nobody imports it',
    why: 'oneLine, the whitespace-collapse rule: its sibling test reads this file as text to prove it declares no import, and never once calls the function it is about.',
  },
  'packages/code/src/choice/asked.ts': {
    reached: 'nobody imports it',
    why: "theChoice, the bare-name menu's key reducer: the one in-process case asserts only that the help was NOT printed, reading the drawn page inside an until() wait.",
  },
  'packages/code/src/choice/screen.ts': {
    reached: 'nobody imports it',
    why: 'openScreen, the ink adapter that draws the menu: the test that names it parses import declarations to prove ink is loaded dynamically, and renders no row itself.',
  },
  'packages/code/src/commands/export.ts': {
    reached: 'nobody imports it',
    why: 'runExport, the OCSF audit feed reader: no test imports it, and the feed is asserted as NDJSON text captured off the io port, so its ExportDone return is never held.',
  },
  'packages/code/src/commands/rules.ts': {
    reached: 'nobody imports it',
    why: "runRules, the CLI's thin wrapper over readGoverningRules: no test imports it, and its printed --json page is asserted only against the MCP twin those tests import directly.",
  },
  'packages/code/src/commands/skills.ts': {
    reached: 'nobody imports it',
    why: "The `mnema skills` provenance-audit adapter; no test imports it, and the verb's lazy import means its tree resolution is only ever read back off printed report lines in cli-e2e.",
  },
  'packages/code/src/commands/status.ts': {
    reached: 'nobody imports it',
    why: 'The `mnema status` adapter behind the opening read; the one test that names it uses its PATH in a source sweep of who calls `bootstrap`, and never imports the module at all.',
  },
  'packages/code/src/completion/bash.ts': {
    reached: 'nobody imports it',
    why: "The bash rendering of the command tree; nothing imports `bashScript`, which is reached only as a row of completionScript's table and observed as a whole-file golden.",
  },
  'packages/code/src/completion/fish.ts': {
    reached: 'nobody imports it',
    why: 'The fish rendering, one guarded `complete` per candidate; nothing imports `fishScript`, and its `-x`/`-r` value spec is only ever matched as a substring of the generated file.',
  },
  'packages/code/src/completion/text.ts': {
    reached: 'nobody imports it',
    why: "The renderers' shared quoting helpers; nothing imports them, and every program the shell test names — mnema, later, odd — is word-safe, so `functionNameOf`'s sanitiser never fires.",
  },
  'packages/code/src/completion/zsh.ts': {
    reached: 'nobody imports it',
    why: "The zsh rendering, the only one carrying `_describe` descriptions; nothing imports `zshScript`, and with zsh absent its output is merely handed to bash's parser.",
  },
  'packages/code/src/env.ts': {
    reached: 'nobody imports it',
    why: "The one place the surface turns process.env into a DiscoveryEnv; the only test naming it asserts it sits on the CLI's eager-import floor, not what it returns for HOME or XDG.",
  },
  'packages/code/src/mcp/hook-reply.ts': {
    reached: 'nobody imports it',
    why: 'The shape of the MCP hook reply the host reads; nothing imports `hookReply`, and the one case naming the file greps its source text for the literals `deny` and `escalate`.',
  },
  'packages/code/src/mcp/route.ts': {
    reached: 'nobody imports it',
    why: "The MCP's one write-destination resolver; mcp-write-routing.test.ts reaches it two hops via tools.ts and asserts which disk a write hit — its wording is only ever a substring.",
  },
  'packages/code/src/presentation/consultation.ts': {
    reached: 'nobody imports it',
    why: "The lone sentence wording a pattern's consultation count; nothing imports it, and its two branches surface only as substrings inside cli-e2e's case about counting sessions served.",
  },
  'packages/code/src/presentation/exported.ts': {
    reached: 'nobody imports it',
    why: 'Composes the four lines `skill export` prints; the test driving it is about the SKILL.md written to disk, and only its two description phrases are ever read back off stdout.',
  },
  'packages/code/src/presentation/exposure.ts': {
    reached: 'nobody imports it',
    why: "Builds the exposure report's rows and closing facts; the cases that drive it are about the credential value NOT being printed, so its column order and date cut go unobserved.",
  },
  'packages/code/src/presentation/record.ts': {
    reached: 'nobody imports it',
    why: 'The five-branch read of one whole record; `show` is substring-checked on a decision and a skill only, so its memory, observation and task branches ride on the golden alone.',
  },
  'packages/code/src/presentation/render.ts': {
    reached: 'nobody imports it',
    why: 'A type-only module whose one export is the `Render` alias: it emits no runtime code, and the two tests naming it use `import type`, so there is no value to observe.',
  },
  'packages/code/src/presentation/rules.ts': {
    reached: 'nobody imports it',
    why: "Builds the governance page's two count lines and four row groups; the address tests assert the `--json` reading, so the rows and their `(unresolved)` fallback ride on the golden.",
  },
  'packages/code/src/presentation/runs.ts': {
    reached: 'nobody imports it',
    why: "Words every run phrase for three readings; only regex spot-checks through `focus` and `resume` reach it, so humanDuration's two-unit cut and negative-clock branch go unobserved.",
  },
  'packages/code/src/presentation/status.ts': {
    reached: 'nobody imports it',
    why: 'The `mnema status` printer: nothing imports it, its lines are only read by an end-to-end test about two doors sharing one derivation, and no fixture caps a list so `3 of 12` never prints.',
  },
  'packages/code/src/presentation/switches.ts': {
    reached: 'nobody imports it',
    why: 'The `mnema switch` listing: the only reads of its rows belong to a test about the switch event, which uses the line as a probe for on-or-off rather than asking what the row says.',
  },
  'packages/code/src/presentation/tails.ts': {
    reached: 'nobody imports it',
    why: 'The `tail list` renderer: an e2e test does take the id off its printed row and feed `tail prune`, but nothing imports `tailReport`, so every column is observed only through the verb.',
  },
  'packages/code/src/presentation/usage.ts': {
    reached: 'nobody imports it',
    why: 'The `mnema usage` table: tests only ever print its `no transcript` rows and closing disclaimer, so the `not attributed` line and the passed-over suffix it alone words go unseen.',
  },
  'packages/code/src/presentation/witness.ts': {
    reached: 'nobody imports it',
    why: 'The `mnema witness` listing: one assertion touches it — `not covered`, in a test about flags reaching the act — so `PENDING`, `covered` and the checkpoint column go unread.',
  },
  'packages/code/src/record-effect.ts': {
    reached: 'nobody imports it',
    why: 'The mutates/reads declaration pair: its one test borrows the RecordEffect type and then reads the MCP sources as bytes, asserting each tool spells the import rather than calling either function.',
  },
  'packages/code/src/repl/region.ts': {
    reached: 'nobody imports it',
    why: "The console's layout: the two in-process renders that load it assert floor.ts's words and console.ts's fold width, while its caret and rules are measured only against dist in a pty.",
  },
  'packages/code/src/transcripts.ts': {
    reached: 'nobody imports it',
    why: "The host-transcript reader: its numbers are asserted only as the usage adapter's `RunSpend`, and every fixture writes `cwd: repo`, so nothing shows a foreign cwd being left out.",
  },
  'packages/code/src/wiring/accountability.ts': {
    reached: 'nobody imports it',
    why: "Registration and the one-level author summary; cli-e2e only scrapes this verb's output for a short anchor to prove identity forms, and never reads the counts it prints.",
  },
  'packages/code/src/wiring/antipatterns.ts': {
    reached: 'nobody imports it',
    why: 'Composes the whole antipatterns page, yet the only cases reaching it sit in the brief block and grep it for the label-clash line, leaving its six counts and closing note unread.',
  },
  'packages/code/src/wiring/brief.ts': {
    reached: 'nobody imports it',
    why: 'The option-less brief registration and its switched-off sentence; the brief cases all assert the document presentation/brief.ts renders, and the switch test is about the switch.',
  },
  'packages/code/src/wiring/decision.ts': {
    reached: 'nobody imports it',
    why: 'The decision group, three subcommands and two private printers; cli-e2e reads its lines to prove the decision workflow, and the import plan survives only as committed golden bytes.',
  },
  'packages/code/src/wiring/export.ts': {
    reached: 'nobody imports it',
    why: "The only read with no --json and no summary; the feed test driving it is about copilot's OCSF mapping, and this verb appears in no golden and its adapter has no test of its own.",
  },
  'packages/code/src/wiring/exposure.ts': {
    reached: 'nobody imports it',
    why: 'A twenty-line registration that only picks between JSON and the report; every string the exposure cases assert is produced by the command and presenter it defers to, not here.',
  },
  'packages/code/src/wiring/focus.ts': {
    reached: 'nobody imports it',
    why: 'Builds the focus header and one line per open run; the test that reaches it counts those lines against the header number, asserting arity rather than anything the line says.',
  },
  'packages/code/src/wiring/guard.ts': {
    reached: 'nobody imports it',
    why: "The dry-run gate verb's declaration and its ALLOWED/REFUSED line; only cli-e2e reaches it through run(), and what it asserts there is the gate's verdict, not this adapter.",
  },
  'packages/code/src/wiring/handoff.ts': {
    reached: 'nobody imports it',
    why: "The handoff verb's three positionals and its id-less echo; cli-e2e asserts the recorded event and the sentence, never that this file makes --which the author, not the subject.",
  },
  'packages/code/src/wiring/io.ts': {
    reached: 'nobody imports it',
    why: 'The CliIo port itself; every test injects its own port so processIo never runs, doors.test.ts imports the type only, and writeLines just relays lines other modules composed.',
  },
  'packages/code/src/wiring/key.ts': {
    reached: 'nobody imports it',
    why: "The key group's four subcommands and the advice they print; cli-e2e asserts what restore, enroll and revoke did to the record, not the sentences this file prints about it.",
  },
  'packages/code/src/wiring/link.ts': {
    reached: 'nobody imports it',
    why: "The link verb's open --rel and its reach notice; cli-e2e asserts the edge in projectLinks and the tree line, so nothing observes the ordering this file gives its two notices.",
  },
  'packages/code/src/wiring/mcp.ts': {
    reached: 'nobody imports it',
    why: "The mcp verb's declaration and --project passthrough; no test invokes it because it never returns, cli.test.ts only regexes its source text, and the golden pins its help page.",
  },
  'packages/code/src/wiring/memory.ts': {
    reached: 'nobody imports it',
    why: "The memory verb's single positional; cli-e2e and the golden use it everywhere as the cheapest write and assert the captured event, so this adapter is only ever a means to one.",
  },
  'packages/code/src/wiring/next-actions.ts': {
    reached: 'nobody imports it',
    why: "The next-actions verb's human list and --json branch; cli-e2e asserts 'submit → READY' and 'no legal moves', which are the workflow table's answers rather than this file's.",
  },
  'packages/code/src/wiring/no-such-record.ts': {
    reached: 'nobody imports it',
    why: 'The one sentence every verb refuses an unknown id with; a-refusal-is-one-line.test.ts drives its eight call sites through the CLI but compares them to wordings retyped in the test.',
  },
  'packages/code/src/wiring/observe.ts': {
    reached: 'nobody imports it',
    why: "The observe verb's own copy of the Recorded-observation line; cli-e2e only regex-matches its prefix, while mcp-e2e byte-pins the separate copy in mcp/server.ts.",
  },
  'packages/code/src/wiring/on-one-line.ts': {
    reached: 'nobody imports it',
    why: 'The template tag that collapses every value on a success line; a-line-of-success-is-one-line.test.ts decides it was applied by grepping the wiring source, never by calling it.',
  },
  'packages/code/src/wiring/refs.ts': {
    reached: 'nobody imports it',
    why: "The refs verb's declaration and its own depth and direction refusals; cli-e2e never runs refs, and the golden only says its lines are the ones already committed.",
  },
  'packages/code/src/wiring/resume.ts': {
    reached: 'nobody imports it',
    why: "The resume verb's wiring and its no-runs branch; cli-e2e runs it to prove the run lifecycle and one identity short-form, and the phrases it checks come from presentation/runs.ts.",
  },
  'packages/code/src/wiring/rules.ts': {
    reached: 'nobody imports it',
    why: "The rules verb's wiring for reading which recorded rules govern a path; the-rule-has-an-address.test.ts drives it only to compare the CLI's answer with the governing_rules tool's.",
  },
  'packages/code/src/wiring/run-pin.ts': {
    reached: 'nobody imports it',
    why: 'pinnedRunResolver and the PIN_REFUSED sentinel: the single test naming it imports the PinnedRun type to describe a stub of its own, and asserts about the verb wiring that was handed the stub.',
  },
  'packages/code/src/wiring/run.ts': {
    reached: 'nobody imports it',
    why: 'The run start/end group and the export and unset lines it prints; cli-e2e reads those lines as fixture steps and asserts the run stamped on the envelopes of what was written.',
  },
  'packages/code/src/wiring/search.ts': {
    reached: 'nobody imports it',
    why: "The search verb's seven filter flags and its two usage refusals; cli-e2e asserts the report commands/search.ts returns, and nothing reaches its no-such-tree branch.",
  },
  'packages/code/src/wiring/show.ts': {
    reached: 'nobody imports it',
    why: "The `show` verb declaration; cli-e2e drives `show <id>` and `--json`, but its expectations land on runShow's record and recordReport's lines, not on what this file declares.",
  },
  'packages/code/src/wiring/skill.ts': {
    reached: 'nobody imports it',
    why: "The `skill` group's declaration; every test that runs `skill export` passes `--out`, so the './skills' default this file declares is exercised by nothing and asserted by nothing.",
  },
  'packages/code/src/wiring/skills.ts': {
    reached: 'nobody imports it',
    why: "The `skills` audit declaration; cli-e2e's eighteen runs of it assert provenanceReport's rows and runSkills' data, and only its help paragraph is ever read back from this file.",
  },
  'packages/code/src/wiring/status.ts': {
    reached: 'nobody imports it',
    why: "The `status` declaration; where-things-stand drives it only to prove the CLI's --json equals the MCP bootstrap payload and that copilot's derivation has a single door.",
  },
  'packages/code/src/wiring/switch.ts': {
    reached: 'nobody imports it',
    why: 'The `switch` group and its shared off/on declaration; the-switch-is-a-fact asserts the channel.switched event and the silence it buys, while the lines here live only in the golden.',
  },
  'packages/code/src/wiring/tail.ts': {
    reached: 'nobody imports it',
    why: "The `tail` group's declaration; its two tests are about the printed id round-tripping into `prune` and the cut removing nothing, and the golden pins only prune's refusals.",
  },
  'packages/code/src/wiring/task.ts': {
    reached: 'nobody imports it',
    why: "The `task` group; it is the fixture verb other suites create records with, so its forty-odd cli-e2e runs assert the gate's verdicts and movedLine rather than this declaration.",
  },
  'packages/code/src/wiring/timeline.ts': {
    reached: 'nobody imports it',
    why: 'The `timeline` declaration; cli-e2e runs it twice only to check the read does not fail and prints one anchor form, and the one-line probe drives it to test onOneLine.',
  },
  'packages/code/src/wiring/usage.ts': {
    reached: 'nobody imports it',
    why: "Declares `mnema usage` with no options; the cost suites assert the report's numbers and wording, which presentation/usage.ts produces, and its six-line help block sits in no golden.",
  },
  'packages/code/src/wiring/witness.ts': {
    reached: 'nobody imports it',
    why: 'Declares the `witness` group and prints its outcomes; the one suite driving it proves --calendar and --global reach commands/witness.ts, and no golden ever invokes the verb.',
  },
  'packages/copilot/src/context/switches.ts': {
    reached: 'nobody imports it',
    why: "The OFF-wins fold across trees; the only value a relative-chain test observes is the brief's `{ on: true }` default, so the off branch, the tie-break and `travels` go unseen.",
  },
  'packages/copilot/src/intelligence/events.ts': {
    reached: 'nobody imports it',
    why: 'CatalogEvent and EventKind, two aliases computed from orderedEvents across a package boundary: nothing of it survives compilation, so the two tests naming it borrow a vocabulary and never a value.',
  },
  'packages/copilot/src/intelligence/pattern-moves.ts': {
    reached: 'nobody imports it',
    why: 'The three-answer pattern-move reading; the suite its own docstring cites lives in packages/code and reaches it as `@mnema/copilot`, exercising the built dist and not this source.',
  },
  'packages/copilot/src/sources.ts': {
    reached: 'nobody imports it',
    why: 'The ScopedCache port, an interface and nothing besides: nine tests name it, sources.test.ts among them, and each uses it only to type a fake that some intelligence module is then asked about.',
  },
  'packages/core/src/identity/index.ts': {
    reached: 'nobody imports it',
    why: 'A barrel re-exporting the four identity modules; the single test that loads it asserts three projection symbols, and every user of these helpers imports them directly instead.',
  },
  'packages/core/src/one-line.ts': {
    reached: 'nobody imports it',
    why: "A one-line re-export of the chain's line rule; behaviour is asserted against `@mnema/chain/one-line`, and all this address gets is a `toContain` over its own source text.",
  },
  'packages/core/src/projections/channel-store.ts': {
    reached: 'nobody imports it',
    why: 'The SQLite store for switch rows; advance.test.ts only checks its rows against a second run of the same store, and `getChannelSwitch`, the hot-path lookup, no test calls at all.',
  },
  'packages/core/src/projections/channel.ts': {
    reached: 'nobody imports it',
    why: 'The last-switch-wins fold; the one `channel.switched` case running it asserts advanced tables equal replayed ones, never reading the `on` it decided or the attribution beside it.',
  },
  'packages/core/src/projections/decision-store.ts': {
    reached: 'nobody imports it',
    why: 'Tests only ever reach its four decisions-table functions as ProjectionCache method bodies, so every assertion is about the cache facade and materializeDecisions is named by no test.',
  },
  'packages/core/src/projections/knowledge-store.ts': {
    reached: 'nobody imports it',
    why: 'cache.test.ts reaches its four knowledge tables only through ProjectionCache, and listLinksByRelation is exercised only by copilot tests that load @mnema/core from dist.',
  },
  'packages/core/src/topology/index.ts': {
    reached: 'nobody imports it',
    why: 'A barrel over three topology modules every core test bypasses by importing resolve.js, routing.js or locate.js directly; write.ts pulls one value through it, openTreeForWriting.',
  },
  'packages/core/src/workflow/append.ts': {
    reached: 'nobody imports it',
    why: 'Its UNREADABLE_EVENT refusal is asserted only by driving the operations that call it, so nothing calls appendEvents and its check-the-whole-batch-first atomicity is unexercised.',
  },
  'packages/core/src/workflow/clock.ts': {
    reached: 'nobody imports it',
    why: 'The Clock alias and systemClock beneath it: seven tests import the type to hand a fixed clock in, and the one real value is reached only through @mnema/core by production, never by a relative specifier.',
  },
  'packages/core/src/workflow/index.ts': {
    reached: 'nobody imports it',
    why: 'A barrel over eighteen workflow modules; its only asserted property, that TASK_DISPOSITION stays off the surface, is checked by a code test loading src/index.ts by computed path.',
  },
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('every file has a test that names it', () => {
  it('walks the universe the coverage gate measures, not one of its own', () => {
    // One statement of what production is. If the gate's globs change, this walk has to
    // change with them, and the assertion is what forces the pair to move together.
    const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf-8');
    expect(config).toContain("include: ['packages/**/src/**/*.ts']");
    expect(config).toContain("'packages/**/src/**/*.d.ts'");
    expect(config).toContain("'packages/**/src/index.ts'");
    // The four nested barrels are production by that reading, and the count is the
    // non-vacuity of this whole file: a walk that found nothing would leave every
    // assertion below true.
    expect(PRODUCTION).toContain('packages/code/src/wiring/index.ts');
    expect(PRODUCTION).toContain('packages/core/src/topology/index.ts');
    expect(PRODUCTION).not.toContain('packages/core/src/index.ts');
    expect(PRODUCTION).toHaveLength(295);
    expect(TEST_TREE.length).toBeGreaterThan(250);
    // No file is in both corpora, which is what keeps a test from witnessing itself.
    const tests = new Set(TEST_TREE.map((one) => one.path));
    expect(PRODUCTION.filter((file) => tests.has(file))).toEqual([]);
  });

  it('reconciles the debt in all four directions', () => {
    expect(reconcile(unwitnessed(), UNWITNESSED, PRODUCTION)).toEqual({
      undeclared: [],
      stale: [],
      misdescribed: [],
      unknown: [],
    });
  });

  it('says how many, so a scanner that stopped scanning cannot pass', () => {
    const found = unwitnessed();
    const byReach = (reach: Reach): number =>
      [...found.values()].filter((one) => one === reach).length;
    expect(PRODUCTION.length - found.size).toBe(214);
    expect(found.size).toBe(81);
    expect(byReach('nobody imports it')).toBe(81);
    expect(byReach('imported, and no assertion observes it')).toBe(0);
  });

  it('carries a reason for that file, and no two rows carry the same one', () => {
    // Announced in the header and, until now, kept by hand. A shared excuse is how a table
    // like this turns into a rubber stamp, and a row drained to a stub is how it starts.
    const reasons = Object.values(UNWITNESSED).map((one) => one.why);
    expect(reasons).toHaveLength(81);
    expect(new Set(reasons).size).toBe(reasons.length);
    // The shortest reason standing is 156 characters; the floor is under it and well over
    // anything that could be written without saying what reaches that file.
    expect(reasons.filter((one) => one.length < 120)).toEqual([]);
  });

  it('accounts for every relative specifier that led nowhere, or accuses it', () => {
    // The fact the scanner used to compute and throw away, and the reason this case
    // exists at all: `completion/lookups.test.ts` asked for `'../io.js'`, a file that has
    // never existed, and the branch that IS this guard carried it through two passes. A
    // dangling relative specifier is a deleted file or a mistyped path; neither is a
    // thing to be silent about, so it is either fixed or it is a row with a reason.
    expect(reconcileFollowed(unresolved, LED_NOWHERE)).toEqual({
      unexplained: [],
      obsolete: [],
    });
    // Non-vacuity in both parts: the walk really did follow specifiers, and the list
    // really does hold rows — a scanner returning nothing would satisfy the line above.
    expect(unresolved.length).toBe(5);
    expect(Object.keys(LED_NOWHERE)).toHaveLength(5);
    // And each row says what THAT module is, by the ledger's rule, at the ledger's floor.
    const why = Object.values(LED_NOWHERE);
    expect(new Set(why).size).toBe(why.length);
    expect(why.filter((one) => one.length < 120)).toEqual([]);
  });

  it('names a package with no src/ instead of dying while it collects', () => {
    expect(WITHOUT_SOURCE).toEqual([]);
    expect(READABLE).toEqual(['chain', 'code', 'copilot', 'core']);
  });

  it('cannot be dissolved by the ledger that describes it', () => {
    // The keys below are 81 paths. Naming requires an IMPORT, so listing a file here
    // cannot witness it — and this file, which mentions every one of them, imports no
    // product file at all.
    const self = TEST_TREE.find((one) =>
      one.path.endsWith('every-file-has-a-test-that-names-it.test.ts'),
    );
    expect(self).toBeDefined();
    const named = PRODUCTION.filter((file) =>
      (importedBy.get(file) ?? []).includes(self?.path as string),
    );
    expect(named).toEqual([]);
    // And the ledger really does hold the paths, so the line above is not passing over
    // an empty table.
    expect(Object.keys(UNWITNESSED)).toContain('packages/code/src/wiring/focus.ts');
  });
});

// ---------------------------------------------------------------------------
// The instrument, on input of its own
// ---------------------------------------------------------------------------

describe('the scanner tells an assertion from an import', () => {
  const product = ['pkg/src/store.ts', 'pkg/src/other.ts'];
  const scan = (text: string): { imported: boolean; witnessed: boolean } => {
    const answer = witnessing(product, [{ path: 'pkg/src/one.test.ts', text }], codeOnly);
    return {
      imported: (answer.importedBy.get('pkg/src/store.ts') ?? []).length > 0,
      witnessed: (answer.witnessedBy.get('pkg/src/store.ts') ?? []).length > 0,
    };
  };

  it('witnesses an assertion whose subject came from the file', () => {
    expect(
      scan("import { open } from './store.js';\nit('x', () => { expect(open(1)).toBe(2); });"),
    ).toEqual({ imported: true, witnessed: true });
  });

  it('witnesses a value carried through a local binding, and through a helper', () => {
    expect(
      scan(
        "import { open } from './store.js';\n" +
          'const held = open(1);\nfunction shown() { return held.line; }\n' +
          "it('x', () => { expect(shown()).toBe('a'); });",
      ),
    ).toEqual({ imported: true, witnessed: true });
  });

  it('witnesses a collaborator the file was HANDED, which is what a fake is', () => {
    expect(
      scan(
        "import { arm } from './store.js';\n" +
          "it('x', () => { const fake = { seen: [] }; arm(fake); expect(fake.seen).toEqual(['a']); });",
      ),
    ).toEqual({ imported: true, witnessed: true });
  });

  it('ACCUSES a file imported only to build a fixture for something else', () => {
    // The defect this whole guard exists to catch: the module runs, its value feeds
    // another module's input, and the assertion is about that other module.
    expect(
      scan(
        "import { open } from './store.js';\nimport { render } from './other.js';\n" +
          "it('x', () => { open(1); expect(render('a')).toBe('a'); });",
      ),
    ).toEqual({ imported: true, witnessed: false });
  });

  it('ACCUSES a file only a path literal names, however the literal is asserted', () => {
    // A corpus walk or a declared list of module paths is not a witness here — see the
    // header. Both spellings of the literal are tried, because this is the exclusion the
    // ledger's own survival depends on.
    expect(scan("it('x', () => { expect(['pkg/src/store.ts']).toEqual(FLOOR); });")).toEqual({
      imported: false,
      witnessed: false,
    });
    expect(
      scan("const FLOOR = ['store.ts'];\nit('x', () => { expect(FLOOR).toHaveLength(1); });"),
    ).toEqual({ imported: false, witnessed: false });
  });

  it('ACCUSES a file reached only through a package specifier, which is another build', () => {
    // `@mnema/core` resolves to that package's dist. Measured: a mutation to
    // `core/src/projections/skill-store.ts` left every case in `mcp-session-cache.test.ts`
    // green, because those cases execute the built copy.
    expect(
      scan("import { open } from '@mnema/core';\nit('x', () => { expect(open(1)).toBe(2); });"),
    ).toEqual({ imported: false, witnessed: false });
  });

  it('does not read an `expect` out of a comment', () => {
    expect(
      scan("import { open } from './store.js';\n// it once said expect(open(1)).toBe(2)\nopen(1);"),
    ).toEqual({ imported: true, witnessed: false });
  });

  it('reports a specifier that led nowhere from a HELPER as well as from a case', () => {
    // The rule has one site and TWO walks reach it. The corpus exercises the case half —
    // put the wrong path back into `completion/lookups.test.ts` and the guard above
    // accuses it. The helper half has nothing live to exercise it, so it is stated here:
    // routing only the helper walk around that site left every case green, and this is
    // what closes that.
    const answer = witnessing(
      product,
      [
        { path: 'pkg/tests/support/held.ts', text: "export { open } from '../../src/gone.js';" },
        { path: 'pkg/tests/one.test.ts', text: "import { x } from './nowhere.js';\n" },
      ],
      codeOnly,
    );
    expect(answer.unresolved).toEqual([
      { from: 'pkg/tests/support/held.ts', specifier: '../../src/gone.js' },
      { from: 'pkg/tests/one.test.ts', specifier: './nowhere.js' },
    ]);
    // A package specifier is not a path this scanner claims to follow, so it is not a
    // miss — the exclusion the module comment argues for, read from the other end.
    expect(
      witnessing(
        product,
        [{ path: 'pkg/tests/one.test.ts', text: "import { g } from 'commander';\n" }],
        codeOnly,
      ).unresolved,
    ).toEqual([]);
  });

  it('follows a specifier BEFORE deciding the clause was erased, in the case walk', () => {
    // THE ORDER IS THE PROPERTY, and it is the defect that reached the PR this guard is:
    // `completion/lookups.test.ts` asked for a path no file has ever been at, and it asked
    // with `import type`. A walk that skips the erased clause before following it cannot
    // see that, because whether esbuild erases the import decides if it is an IMPORT — it
    // never decides whether the path is a path.
    //
    // Constructed rather than frozen, and that is declared: the live instance was the
    // defect, and fixing it took the last one out of the tree. Swapping the two lines is
    // the mutation, and before this case it left all thirty-eight green.
    const erased = witnessing(
      product,
      [{ path: 'pkg/tests/one.test.ts', text: "import type { Held } from './nowhere.js';\n" }],
      codeOnly,
    );
    expect(erased.unresolved).toEqual([
      { from: 'pkg/tests/one.test.ts', specifier: './nowhere.js' },
    ]);
    // And the erasure still happens, one line later: the miss is recorded and the file is
    // not imported. Both halves, because a walk that stopped erasing would also be green
    // on the line above.
    expect(erased.importedBy.get('pkg/src/store.ts')).toEqual([]);
    expect(
      witnessing(
        product,
        [
          {
            path: 'pkg/tests/one.test.ts',
            text:
              "import type { Held } from './store.js';\n" +
              "it('x', () => { expect(Held.of(1)).toBe(2); });",
          },
        ],
        codeOnly,
      ).importedBy.get('pkg/src/store.ts'),
    ).toEqual([]);
  });

  it('follows a specifier BEFORE deciding the clause was erased, in the HELPER walk too', () => {
    // The same order, at the other of the two walks — A1: the rule is at two points, so it
    // is asserted at two points. Measured before this case: swapping the pair in the helper
    // walk alone left every case green, including the one above, because no case handed the
    // helper walk an erased clause.
    expect(
      witnessing(
        product,
        [
          { path: 'pkg/tests/support/held.ts', text: "export type { Open } from './gone.js';" },
          { path: 'pkg/tests/one.test.ts', text: "import { open } from './support/held.js';\n" },
        ],
        codeOnly,
      ).unresolved,
    ).toEqual([{ from: 'pkg/tests/support/held.ts', specifier: './gone.js' }]);
  });

  it('relays nothing through a helper whose re-export a compiler erases', () => {
    // THE OTHER SIDE OF THE SAME LINE, and nothing asserted it: deleting the helper walk's
    // skip outright — not reordering it, removing it — left all thirty-eight green, while
    // deleting the case walk's copy reddened three. The two walks were not equally covered,
    // and this is the half that had none.
    //
    // `export type { Open }` loads nothing, so the helper carries no value out of
    // production and the case that imports the helper observes nothing that came from
    // `store.ts`.
    const relayed = witnessing(
      product,
      [
        {
          path: 'pkg/tests/support/held.ts',
          text: "export type { Open } from '../../src/store.js';",
        },
        {
          path: 'pkg/tests/one.test.ts',
          text:
            "import { Open } from './support/held.js';\n" +
            "it('x', () => { expect(Open.of(1)).toBe(2); });",
        },
      ],
      codeOnly,
    );
    expect(relayed.witnessedBy.get('pkg/src/store.ts')).toEqual([]);
    expect(relayed.importedBy.get('pkg/src/store.ts')).toEqual([]);
    // Non-vacuity: the same relay without the word `type` DOES reach, so what moved is the
    // keyword and not the shape of the two sources.
    const loaded = witnessing(
      product,
      [
        { path: 'pkg/tests/support/held.ts', text: "export { Open } from '../../src/store.js';" },
        {
          path: 'pkg/tests/one.test.ts',
          text:
            "import { Open } from './support/held.js';\n" +
            "it('x', () => { expect(Open.of(1)).toBe(2); });",
        },
      ],
      codeOnly,
    );
    expect(loaded.witnessedBy.get('pkg/src/store.ts')).toEqual(['pkg/tests/one.test.ts']);
  });

  it('relays through a helper under tests/, because a helper is test code', () => {
    const answer = witnessing(
      product,
      [
        { path: 'pkg/tests/support/held.ts', text: "export { open } from '../../src/store.js';" },
        {
          path: 'pkg/tests/one.test.ts',
          text:
            "import { open } from './support/held.js';\n" +
            "it('x', () => { expect(open(1)).toBe(2); });",
        },
      ],
      codeOnly,
    );
    expect(answer.witnessedBy.get('pkg/src/store.ts')).toEqual(['pkg/tests/one.test.ts']);
  });

  it('reads an erased `import type` as no import at all, and one keyword decides it', () => {
    // The two sources differ by the word `type` and nothing else, so the pair says the
    // keyword is what moved and not the assertion. esbuild strikes the whole specifier
    // out: the module is never loaded, and a value it never produced was never observed.
    const erased =
      "import type { Held } from './store.js';\nit('x', () => { expect(Held.of(1)).toBe(2); });";
    expect(scan(erased)).toEqual({ imported: false, witnessed: false });
    expect(scan(erased.replace('import type', 'import'))).toEqual({
      imported: true,
      witnessed: true,
    });
  });

  it('keeps the value half of a mixed clause and drops the type half', () => {
    // `import { open, type Held }` DOES load the module — only `Held` is struck out — so
    // the file is imported either way, and only the witness moves.
    const mixed = "import { open, type Held } from './store.js';\n";
    expect(scan(`${mixed}it('x', () => { expect(open(1)).toBe(2); });`)).toEqual({
      imported: true,
      witnessed: true,
    });
    expect(scan(`${mixed}it('x', () => { expect(Held.of(1)).toBe(2); });`)).toEqual({
      imported: true,
      witnessed: false,
    });
  });

  it('follows a helper whose signature carries a brace, in both shapes that carry one', () => {
    // The naive body extractor takes the first `{` after the name, which for these two is
    // the RETURN TYPE. A captured type mentions no value, the taint dies at the helper,
    // and the file is called unwitnessed while an assertion is looking straight at it.
    const object =
      "import { open } from './store.js';\n" +
      'function made(): { held: number } { return open(1); }\n' +
      "it('x', () => { expect(made()).toBe(2); });";
    const promised =
      "import { open } from './store.js';\n" +
      'async function made(): Promise<{ held: number }> { return open(1); }\n' +
      "it('x', async () => { expect(await made()).toBe(2); });";
    const generic =
      "import { open } from './store.js';\n" +
      'function made<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> { return open(r); }\n' +
      "it('x', () => { expect(made({ ok: true })).toBe(2); });";
    for (const source of [object, promised, generic]) {
      expect(scan(source), source).toEqual({ imported: true, witnessed: true });
    }
  });

  it('relays through a helper that reaches production through ANOTHER helper', () => {
    // One hop would make the answer depend on how deeply somebody nested a helper. The
    // live chain here is `support/pty.ts` -> `support/console.ts` -> `repl/floor.ts`.
    const answer = witnessing(
      product,
      [
        { path: 'pkg/tests/support/deep.ts', text: "export { open } from '../../src/store.js';" },
        { path: 'pkg/tests/support/near.ts', text: "export { open } from './deep.js';" },
        {
          path: 'pkg/tests/one.test.ts',
          text:
            "import { open } from './support/near.js';\n" +
            "it('x', () => { expect(open(1)).toBe(2); });",
        },
      ],
      codeOnly,
    );
    expect(answer.witnessedBy.get('pkg/src/store.ts')).toEqual(['pkg/tests/one.test.ts']);
  });

  it('refuses to reach the assertion verb, which would answer every question yes', () => {
    // `open(expect)` taints `expect` by the rule a fake needs — what a tainted callee is
    // HANDED is observable through it. But `expect` is in every assertion statement there
    // is, so admitting it would make the next line witness the file no matter what it
    // asserted about. The assertion below is about `unrelated`, and nothing else.
    expect(
      scan(
        "import { open } from './store.js';\n" +
          "it('x', () => { open(expect); expect(unrelated).toBe(1); });",
      ),
    ).toEqual({ imported: true, witnessed: false });
    // And the file is still witnessed when an assertion really does look at it.
    expect(
      scan(
        "import { open } from './store.js';\n" +
          "it('x', () => { open(expect); expect(open(1)).toBe(1); });",
      ),
    ).toEqual({ imported: true, witnessed: true });
  });

  it('reconciles a declaration in every direction it can be wrong', () => {
    const found = new Map<string, Reach>([['a.ts', 'nobody imports it']]);
    const table: Readonly<Record<string, Debt>> = {
      'a.ts': { reached: 'nobody imports it', why: 'r' },
    };
    const universe = ['a.ts', 'b.ts'];
    expect(reconcile(found, table, universe)).toEqual({
      undeclared: [],
      stale: [],
      misdescribed: [],
      unknown: [],
    });
    // A file nobody asserts about and nobody declared.
    expect(
      reconcile(new Map([...found, ['b.ts', 'nobody imports it' as Reach]]), table, universe),
    ).toEqual({ undeclared: ['b.ts'], stale: [], misdescribed: [], unknown: [] });
    // An entry that gained a witness: it has to leave.
    expect(reconcile(new Map(), table, universe)).toEqual({
      undeclared: [],
      stale: ['a.ts'],
      misdescribed: [],
      unknown: [],
    });
    // An entry whose reach changed under it.
    expect(
      reconcile(
        new Map([['a.ts', 'imported, and no assertion observes it' as Reach]]),
        table,
        universe,
      ),
    ).toEqual({ undeclared: [], stale: [], misdescribed: ['a.ts'], unknown: [] });
    // An entry naming a file that is not production — a rename, or a typed path.
    expect(
      reconcile(
        found,
        { ...table, 'gone.ts': { reached: 'nobody imports it', why: 'r' } },
        universe,
      ),
    ).toEqual({ undeclared: [], stale: [], misdescribed: [], unknown: ['gone.ts'] });
  });

  it('reads the specifier list both ways, so a corrected path cannot keep its excuse', () => {
    const missed: Unresolved[] = [{ from: 'pkg/tests/a.test.ts', specifier: '../../x.mjs' }];
    const row = 'pkg/tests/a.test.ts -> ../../x.mjs';
    expect(reconcileFollowed(missed, { [row]: 'why' })).toEqual({
      unexplained: [],
      obsolete: [],
    });
    // A specifier that leads nowhere with nothing said about it — the shape that let a
    // wrong path into this branch.
    expect(reconcileFollowed(missed, {})).toEqual({ unexplained: [row], obsolete: [] });
    // And the other direction: the path was fixed, so the row has to go with it.
    expect(reconcileFollowed([], { [row]: 'why' })).toEqual({
      unexplained: [],
      obsolete: [row],
    });
    // The row is addressed by the PAIR. Same file, different specifier is a different
    // fact, so an excuse written for one cannot cover the other.
    expect(
      reconcileFollowed([{ from: 'pkg/tests/a.test.ts', specifier: '../../y.mjs' }], {
        [row]: 'why',
      }),
    ).toEqual({ unexplained: ['pkg/tests/a.test.ts -> ../../y.mjs'], obsolete: [row] });
  });
});

describe('the source it reads is code, and a pattern is not code', () => {
  it('ends every file of the test tree in code, which is what a desync destroys', () => {
    // The strongest form of the property, and the one that was broken: append a statement
    // and ask whether it survived. A blanker still inside a literal at EOF has been
    // swallowing source since wherever it lost its place — nine of these files, up to a
    // hundred and nineteen lines each, assertions included.
    const swallowed = TEST_TREE.filter(
      (one) => !codeOnly(`${one.text}\nconst zzSentinel = 1;\n`).includes('zzSentinel'),
    ).map((one) => one.path);
    expect(swallowed).toEqual([]);
    expect(TEST_TREE.length).toBeGreaterThan(250);
  });

  it('reads a pattern carrying quotes as a pattern, so it cannot open a string', () => {
    // `/"zzAt":"([^"]+)"/` holds five quotes. Taking the fifth for the start of a string is
    // what cost `what-the-agent-just-did.test.ts` every line below it.
    const source = 'const found = /"zzAt":"([^"]+)"/.exec(line);\nconst after = one(2);';
    expect(codeOnly(source)).toContain('const after = one(2);');
    expect(codeOnly(source)).not.toContain('zzAt');
  });

  it('takes a slash inside a character class for a literal, not the pattern’s end', () => {
    // ON ONE LINE, and that is the whole case. Read without the class, `/[^/` ends at the
    // slash inside it and the `/` after `]+` opens a SECOND pattern that swallows the rest
    // — but a pattern cannot cross a newline, so a version of this written across two
    // lines is rescued by that rule and stays green under the very mutation it is for.
    const source = 'const parts = split(/[^/]+/); const after = one(2);';
    expect(codeOnly(source)).toContain('const after = one(2);');
    expect(codeOnly(source)).not.toContain('^');
  });

  it('takes a bracket inside a character class for a literal, so the class still closes', () => {
    // THE LINE IS FROZEN FROM THE ONE THAT WAS LIVE, byte for byte:
    // `one-source-for-a-vocabulary.test.ts:171` at 60d4df0f, the regex-escaping call whose
    // class holds a `[`. The case above it is not this case — its class holds a single
    // bracket, which is the one shape a depth counter reads correctly, so it stayed green
    // through the whole defect. Counted as depth, the class here never closes: everything
    // from the pattern to the end of the line was read as pattern text and
    // `return text.replace(` was all that came back.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the frozen line IS the subject.
    const live = "  return text.replace(/[.*+?^${}()|[\\]\\\\/]/g, '\\\\$&');";
    // The flag and the call's own end are code, and they are what vanished.
    expect(codeOnly(live)).toContain('g, ');
    expect(codeOnly(live)).toContain(');');
    // The other direction, so this is not just "blank less": the pattern is still gone.
    expect(codeOnly(live)).not.toContain('^');
    expect(codeOnly(live)).not.toContain('$&');
    // And a statement sharing the line survives it, which is what the tree-wide sentinel
    // below cannot see — a pattern dies at the newline, so a file ends in code either way.
    expect(codeOnly(`${live} const after = one(2);`)).toContain('const after = one(2);');
  });

  it('reads a slash after a value as division, which opens nothing', () => {
    // The other direction, the one a regex mode gets wrong by being eager: two divisions
    // in a row would otherwise read as one pattern, with everything between them gone.
    const source = 'const half = total / 2;\nconst other = count / 4;\nconst after = one(2);';
    expect(codeOnly(source)).toContain('total / 2');
    expect(codeOnly(source)).toContain('count / 4');
    expect(codeOnly(source)).toContain('const after = one(2);');
    // And after a word that still wants an operand, a slash DOES open one.
    expect(codeOnly('return /zzSecret/.test(x);')).not.toContain('zzSecret');
  });
});

describe('the scanner’s parts, each on input of its own', () => {
  it('follows a relative specifier to source and refuses everything else', () => {
    const known = new Set(['pkg/src/store.ts', 'pkg/src/deep/index.ts']);
    expect(resolveImport('pkg/src/a.test.ts', './store.js', known)).toBe('pkg/src/store.ts');
    expect(resolveImport('pkg/src/sub/a.test.ts', '../store.js', known)).toBe('pkg/src/store.ts');
    expect(resolveImport('pkg/src/a.test.ts', './deep/index.js', known)).toBe(
      'pkg/src/deep/index.ts',
    );
    expect(resolveImport('pkg/src/a.test.ts', './deep', known)).toBe('pkg/src/deep/index.ts');
    expect(resolveImport('pkg/src/a.test.ts', '@mnema/core', known)).toBeUndefined();
    expect(resolveImport('pkg/src/a.test.ts', 'node:fs', known)).toBeUndefined();
    expect(resolveImport('pkg/src/a.test.ts', './nowhere.js', known)).toBeUndefined();
  });

  it('takes the whole assertion, subject and matcher, and nothing before it', () => {
    const found = assertionStatements('const a = 1;\nexpect(subject).toEqual(expected);\nafter();');
    expect(found).toEqual(['expect(subject).toEqual(expected)']);
    // A chain broken across lines is one statement, not two — a matcher on its own line
    // is where half these assertions put the expected value.
    expect(assertionStatements('expect(one)\n  .toEqual(two);')).toEqual([
      'expect(one)\n  .toEqual(two)',
    ]);
  });

  it('binds what a clause brings in, and nothing a compiler will erase', () => {
    expect(boundNames(' { a, b as c } ')).toEqual(['a', 'c']);
    expect(boundNames(' Thing ')).toEqual(['Thing']);
    expect(boundNames(' * as ns ')).toEqual(['ns']);
    expect(boundNames(' Thing, { a } ')).toEqual(['a', 'Thing']);
    // The erasures, in each of the four spellings TypeScript allows.
    expect(boundNames(' type { A } ')).toEqual([]);
    expect(boundNames(' type * as ns ')).toEqual([]);
    expect(boundNames(' { type A, type B } ')).toEqual([]);
    expect(boundNames(' { type A as B } ')).toEqual([]);
    // And the keyword needs a NAME after it to be a keyword: `type` is not reserved, so
    // each of these three binds an ordinary value that happens to be spelled like it.
    expect(boundNames(' type ')).toEqual(['type']);
    expect(boundNames(' { type } ')).toEqual(['type']);
    expect(boundNames(' { type as t } ')).toEqual(['t']);
  });

  it('tells a clause that erases its whole specifier from one that erases a name', () => {
    expect(isTypeOnlyClause(' type { A } ')).toBe(true);
    expect(isTypeOnlyClause(' type Thing ')).toBe(true);
    expect(isTypeOnlyClause(' type * as ns ')).toBe(true);
    // Erased in PART: the module is still loaded, so this is an import.
    expect(isTypeOnlyClause(' { a, type B } ')).toBe(false);
    expect(isTypeOnlyClause(' { A } ')).toBe(false);
    expect(isTypeOnlyClause(' type ')).toBe(false);
  });

  it('reads every clause of a file, across lines and out of an export', () => {
    const found = importClauses(
      "import { a } from './one.js';\n" +
        'import {\n  b,\n  c as d,\n} from "./two.js";\n' +
        "export { e } from './three.js';\n" +
        "import './side-effect.js';\n",
    );
    // The middle one is double-quoted. If it were not closed, its clause would run on and
    // the `export` below would come back binding `b` and `d` instead of `e` — measured,
    // and the reason both quotes are matched.
    expect(found.map((one) => one.specifier)).toEqual(['./one.js', './two.js', './three.js']);
    expect(found.map((one) => boundNames(one.clause))).toEqual([['a'], ['b', 'd'], ['e']]);
    // The one form this cannot see, declared rather than implied: a bare
    // `import './side-effect.js'` has no `from`, and binds nothing to observe anyway.
    expect(found.some((one) => one.specifier.includes('side-effect'))).toBe(false);
  });

  it('never invents a clause out of a declaration, over the tree it actually reads', () => {
    // NOT A WRITTEN EXAMPLE — the corpus, because the two files that carried this are in
    // it and one of them is this one. A line-initial `export` that begins a declaration
    // has no `from`, so a lazily matched clause left the declaration and ran to somebody
    // else's: out of THIS file it produced a single clause opening at
    // `export function reconcile(` and ending at the first `from './store.js'` among the
    // written cases below, and `matchAll` does not overlap, so everything between was
    // never read. It was 466 lines when measured at `60d4df0f`; that length is a property
    // of how long this file has since become, so the number is dated and the count below
    // is what this case pins instead. The case that was supposed to hold this was built on
    // `export { e } from` — a clause that closes on its own line, the one shape that
    // cannot run on.
    const clauses = TEST_TREE.flatMap((one) =>
      importClauses(one.text).map((found) => ({ where: one.path, ...found })),
    );
    // A clause holds identifiers, `type`, `as`, `*`, commas, braces and whitespace. Any
    // other character here means the match left the declaration it started in — a clause
    // that ran on. A clause the grammar never matched leaves nothing here to see at all,
    // which is the half the count below is for.
    const invented = clauses
      .filter((one) => /[^\w$*,{}\s]/.test(one.clause))
      .map((one) => `${one.where}: ${one.clause.trim().slice(0, 40)}`);
    expect(invented).toEqual([]);
    // HOW MANY, NOT AT LEAST HOW MANY, because a floor cannot see the scanner stop
    // seeing. This was `toBeGreaterThan(2000)` and the tree yields 2362: dropping `_`
    // alone from the clause's word class loses 211 real imports and leaves 2145, which
    // clears that floor and every other assertion in this file — measured. A count goes
    // red the moment a clause the grammar used to match stops matching.
    //
    // THE COST IS THAT A NEW IMPORT REDDENS IT, and that is the price of the property:
    // this number is the size of the test tree's import graph, and it is meant to be
    // restated deliberately rather than drifted past.
    expect(clauses.length).toBe(CLAUSES_IN_THE_TREE);
    expect(clauses.filter((one) => one.clause.includes('\n')).length).toBeGreaterThan(50);
  });

  it('does not see an import whose clause holds a comment, and that is the cost', () => {
    // THE DECLARED COST, WRITTEN DOWN ONCE IN THIS WORKSPACE. The grammar admits no `/`,
    // so a comment between the braces and `from` is not matched wrong — it is not matched
    // at all, and an import that goes missing whole is invisible to the case above, whose
    // filter can only speak about clauses that WERE matched.
    const commented = "export type {\n  // why these two\n  A,\n} from './x.js';\n";
    expect(importClauses(commented)).toEqual([]);
    // Non-vacuity: the same statement without the comment IS seen, so what moved is the
    // comment and not the shape.
    expect(
      importClauses("export type {\n  A,\n} from './x.js';\n").map((one) => one.specifier),
    ).toEqual(['./x.js']);
    // And it is written today, in the one place under `packages/` that holds it: the
    // copilot barrel, whose `export type {` carries three line comments among the names.
    const barrel = readFileSync(join(PACKAGES, 'copilot', 'src', 'index.ts'), 'utf-8');
    expect(importClauses(barrel).map((one) => one.specifier)).not.toContain('@mnema/core');
    // Non-vacuity for that one: the import really is there to be missed.
    expect(barrel).toContain("} from '@mnema/core';");
    // INERT BECAUSE OF THE CORPUS, not because of the coverage exclude: this scanner is
    // only ever handed `sources`, and every one of them is test code, so no `src` file's
    // clause is read here by anything.
    expect(
      TEST_TREE.filter((one) => !one.path.includes('/tests/') && !isTestFile(one.path)),
      'a file that is not test code reached the only corpus whose clauses are read',
    ).toEqual([]);
    expect(TEST_TREE.map((one) => one.path)).not.toContain('packages/copilot/src/index.ts');
  });

  it('separates a case from a helper by the only thing that distinguishes them', () => {
    expect(isTestFile('pkg/src/store.test.ts')).toBe(true);
    expect(isTestFile('pkg/src/store.ts')).toBe(false);
    expect(isTestFile('pkg/tests/support/held.ts')).toBe(false);
    expect(isTestFile('pkg/tests/store.test.tsx')).toBe(false);
  });

  it('resolves a path textually, with no filesystem under it', () => {
    expect(normalizePath('a/b/../c')).toBe('a/c');
    expect(normalizePath('./a//b')).toBe('a/b');
    expect(normalizePath('a/b/./c')).toBe('a/b/c');
    expect(normalizePath('a/b/../../c')).toBe('c');
    // Climbing past the top yields the rest rather than throwing: a specifier that does
    // this resolves to nothing in `known`, and is refused there instead.
    expect(normalizePath('a/../../b')).toBe('b');
  });

  it('takes the body and not a `readonly` return annotation, which is a type', () => {
    // FROZEN FROM A LIVE SIGNATURE: `the-page-shows-its-seams.test.ts` reads the surface
    // and returns `readonly { … }[]`. `readonly` is a modifier and what follows it is
    // still the type, but every other word ended the wait for one — so the ANNOTATION's
    // brace read as the body, and a body of field names mentions no value a walk could
    // carry. Six declarations in this tree are shaped this way; the one case that reached
    // this extractor before used a signature with no annotation at all.
    const live =
      'function sources(\n' +
      '): readonly { readonly where: string; readonly code: string }[] {\n' +
      '  return sourceFiles(SRC).map((file) => ({ where: file, code: codeOnly(file) }));\n' +
      '}';
    const found = flowsIn(live).functions;
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('sources');
    expect(found[0]?.body).toContain('sourceFiles(SRC)');
    // The other direction, so this is not "capture more": the annotation is not the body.
    expect(found[0]?.body).not.toContain('readonly where');
  });

  it('stops propagating rather than reaching everything', () => {
    // Non-vacuity of the taint walk in the direction that matters: it must NOT be a
    // function that returns every identifier in the file.
    const flows = flowsIn('const a = seed.x;\nconst b = elsewhere;\nfunction c() { return a; }');
    const reached = reachedFrom(flows, ['seed']);
    expect([...reached].sort()).toEqual(['a', 'c', 'seed']);
    expect(reached.has('b')).toBe(false);
    expect(reached.has('elsewhere')).toBe(false);
  });
});

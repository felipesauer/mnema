/**
 * A classification stays in the module that owns it; only the QUESTION crosses a
 * package boundary.
 *
 * A workflow state answers "where is this entity"; a table beside the machine says
 * what that state MEANS to a reader — governs, awaits somebody, is over. Four
 * modules hold such a table, and each one declares in its own doc that the table is
 * NOT on the package's public surface, because a consumer that could import it would
 * re-derive the meaning where nobody can see the two copies drift. Nothing kept any
 * of those declarations true.
 *
 * It is the second guard of a pair that could not go red. Measured in the delivery
 * before this one: making a surface classify for itself (`state === 'adopted'`
 * instead of asking) leaves ONE red, and it comes from
 * `every-public-value-has-a-caller.test.ts` — the accessor loses its only consumer —
 * never from behaviour. That red is conditional on the accessor still being
 * exported: a duplicator that also tidies the now-uncalled export away leaves
 * NOTHING red (measured in this slice's report). Inside a single package the
 * duplication was always silent.
 *
 * So this walks the public surface, in both directions of one rule:
 *   - no table a module declares hidden reaches an entry point's runtime exports;
 *   - the accessor that makes asking possible IS on the surface, so the honest path
 *     stays cheaper than the copy.
 *
 * HOW THE SUBJECT IS ENUMERATED, and why each net is here:
 *   - BY DECLARATION. The modules are found by their own sentence — "not on the
 *     package's public surface" — and every plain-object value they export is then
 *     subject. The DECLARATION is the source, not a list kept in this file: a table
 *     added to one of those modules tomorrow is covered without an edit here. The
 *     witness table below is what keeps the sweep from silently finding nothing.
 *   - BY SHAPE. An object whose keys are exactly the states of one of the product's
 *     machines is a per-state table whoever wrote it and wherever it lives, so this
 *     net catches one that carries no declaration at all — including a copy of a
 *     hidden table under a new name. The machines come from `@mnema/core`'s own
 *     `*_STATES` tuples, so a fourth machine is covered without an edit.
 *   - BY NAME and BY IDENTITY, inside the first net. A re-export under the original
 *     name is the ordinary shape; renaming on the way out
 *     (`export { SKILL_DISPOSITION as MEANINGS }`) is the cheapest evasion of a
 *     name check and costs nothing to catch, since the module instance is the same
 *     one this file imported.
 *
 * WHAT IT DOES NOT DO, so a pass is not read as more than it says:
 *   - IT DOES NOT CATCH REIMPLEMENTATION FROM SCRATCH. A surface that writes
 *     `state === 'adopted'` for itself touches neither the table nor the accessor,
 *     and nothing here sees it. The alternative was measured and refused: a scan for
 *     a state literal in a comparison, outside the machine's own house, finds ONE
 *     site in this workspace and it is a FALSE POSITIVE —
 *     `core/src/workflow/identity-operations.ts:161`, `decided.source === 'adopted'`,
 *     where `adopted` is where an anchor came from and merely a homonym of the skill
 *     state. A guard born needing an allowlist already carries an exception, and the
 *     exception accretes until somebody switches the guard off. It was not built;
 *     this limit is the price, and it is the whole of what stays uncovered.
 *   - It is blind to a table keyed by a SUBSET of a machine's states, and to one
 *     keyed by a vocabulary that is not a machine's states at all: `LATEST_VERSION`
 *     is keyed by every event kind and is public on purpose, and `UNROUTED_KINDS` is
 *     held off the surface by the first net only.
 *   - A table reached through a class member, or through `import * as ns`, is not a
 *     runtime key of an entry point and is not seen. Neither exists here today.
 *   - It says nothing about whether an accessor's answers are RIGHT. That the
 *     exported function is the table asked rather than a second opinion is
 *     `skills.test.ts` — "skillDisposition is the table, asked rather than restated";
 *     that the tables agree with the workflow they read is `disposition.test.ts`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// The public surface, read from the manifests
// ---------------------------------------------------------------------------

/** The `exports` map's shape, as far as this file needs it. */
type ExportTarget = string | { readonly default?: string };

/** One public entry point: the specifier a consumer writes, and its runtime values. */
interface Surface {
  readonly specifier: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * Every entry point every package's manifest declares, loaded from SOURCE.
 *
 * The source and not the `dist`: a guard that read the build would pass on a stale
 * one, which this repo has already paid for. Enumeration is by RUNTIME KEY, so a
 * type cannot enter — it is gone before this file runs.
 */
async function surfaces(): Promise<Surface[]> {
  const found: Surface[] = [];
  for (const directory of readdirSync(PACKAGES).sort()) {
    const manifestPath = join(PACKAGES, directory, 'package.json');
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest: { name?: string; exports?: Record<string, ExportTarget> } = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    );
    const name = manifest.name ?? directory;
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const built = typeof target === 'string' ? target : target.default;
      if (built === undefined) continue;
      const source = join(
        PACKAGES,
        directory,
        built.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'),
      );
      found.push({
        specifier: subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`,
        values: (await import(source)) as Record<string, unknown>,
      });
    }
  }
  return found;
}

const SURFACE = await surfaces();

/** Every `<specifier> <name>` pair the workspace publishes as a runtime value. */
function publishedValues(): { specifier: string; name: string; value: unknown }[] {
  return SURFACE.flatMap((surface) =>
    Object.entries(surface.values).map(([name, value]) => ({
      specifier: surface.specifier,
      name,
      value,
    })),
  );
}

// ---------------------------------------------------------------------------
// The modules that declare themselves hidden
// ---------------------------------------------------------------------------

/**
 * The sentence a module writes when it keeps a table to itself. It is matched over
 * the source with comment continuations flattened, so the claim counts however the
 * line happens to wrap, and case-insensitively because one of the four writes it as
 * a heading.
 */
const HIDDEN_CLAIM = /not on the package['’]s public surface/i;

/** Every non-test TypeScript file under a directory. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** One module that declares its tables hidden, and the tables it exports. */
interface Hidden {
  /** The module's path from `packages/`, which is how the witness table names it. */
  readonly module: string;
  /** Its exported plain objects — the tables. A function is the accessor, not a table. */
  readonly tables: readonly { readonly name: string; readonly value: object }[];
}

/** Whether a value is a table: a plain object, never an array and never a function. */
function isTable(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every module whose own doc says its tables are not on the public surface, with
 * those tables. Found by the CLAIM: the declaration is what makes the module
 * subject, so nothing here has to be kept in step by hand.
 */
async function declaredHidden(): Promise<Hidden[]> {
  const found: Hidden[] = [];
  for (const directory of readdirSync(PACKAGES).sort()) {
    const src = join(PACKAGES, directory, 'src');
    if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const path of sourceFiles(src)) {
      const flattened = readFileSync(path, 'utf-8').replace(/\n\s*\*\s?/g, ' ');
      if (!HIDDEN_CLAIM.test(flattened)) continue;
      const loaded = (await import(path)) as Record<string, unknown>;
      found.push({
        module: path
          .slice(PACKAGES.length + 1)
          .split(sep)
          .join('/'),
        tables: Object.entries(loaded)
          .filter(([, value]) => isTable(value))
          .map(([name, value]) => ({ name, value: value as object })),
      });
    }
  }
  return found;
}

const HIDDEN = await declaredHidden();

/**
 * What the sweep above must find — the WITNESS of the enumeration, never the subject
 * of the rule.
 *
 * The assertion runs on what the sweep found; this is what fails if the sweep starts
 * finding something else, which is the failure a claim-driven guard has to be loud
 * about: reword the sentence in one of those docs and the guard would otherwise cover
 * nothing and pass. Checked in both directions, so a fifth module that declares
 * itself hidden — or a table added to one of these four — announces itself here
 * instead of arriving silently.
 */
const DECLARED_HIDDEN: Readonly<Record<string, readonly string[]>> = {
  'copilot/src/context/decisions.ts': ['DECISION_DISPOSITION'],
  'copilot/src/context/skills.ts': ['SKILL_DISPOSITION'],
  'core/src/content/fields.ts': ['ENVELOPE_TEXT', 'PAYLOAD_TEXT', 'SUBJECT_TEXT'],
  'core/src/topology/routing.ts': ['UNROUTED_KINDS'],
};

/**
 * Every hidden table that reached a public surface, as `<specifier> <name>`.
 *
 * By NAME and by IDENTITY. The name catches the ordinary re-export; the identity
 * catches a rename on the way out, and it works because the entry point and this
 * file resolve the owning module to the same instance.
 */
function leaked(
  published: readonly { specifier: string; name: string; value: unknown }[],
): string[] {
  const names = new Set(HIDDEN.flatMap((hidden) => hidden.tables.map((table) => table.name)));
  const objects = HIDDEN.flatMap((hidden) => hidden.tables.map((table) => table.value));
  return published
    .filter(({ name, value }) => names.has(name) || objects.some((table) => table === value))
    .map(({ specifier, name }) => `${specifier} ${name}`)
    .sort();
}

// ---------------------------------------------------------------------------
// The shape of a per-state table
// ---------------------------------------------------------------------------

/** The product's state machines, taken from `@mnema/core`'s own tuples. */
function machines(): { name: string; states: readonly string[] }[] {
  const core = SURFACE.find((surface) => surface.specifier === '@mnema/core');
  return Object.entries(core?.values ?? {})
    .filter(([name, value]) => name.endsWith('_STATES') && Array.isArray(value))
    .map(([name, value]) => ({ name, states: value as readonly string[] }));
}

const MACHINES = machines();

/**
 * The machine a value is a total table over, or undefined when it is not one.
 *
 * Keys EXACTLY, which is what keeps the net from guessing: a `Record<State, …>` is
 * total by construction, and an object keyed by a subset of the states is left alone
 * rather than accused on a hunch.
 */
function tableOverMachine(value: unknown): string | undefined {
  if (!isTable(value)) return undefined;
  const keys = Object.keys(value).sort().join(',');
  return MACHINES.find((machine) => [...machine.states].sort().join(',') === keys)?.name;
}

/** Every published value that is a total table over one of the machines. */
function perStateTables(
  published: readonly { specifier: string; name: string; value: unknown }[],
): string[] {
  return published
    .flatMap(({ specifier, name, value }) => {
      const machine = tableOverMachine(value);
      return machine === undefined ? [] : [`${specifier} ${name} (${machine})`];
    })
    .sort();
}

// ---------------------------------------------------------------------------
// The other half: the accessor that keeps asking cheaper than copying
// ---------------------------------------------------------------------------

/**
 * The classifications a package outside the owning one has to be able to ASK about,
 * and the specifier that must answer.
 *
 * This half cannot be enumerated from a shape — "which meaning does a consumer of
 * another package need" is a design fact, not a property of the code — so the NAMES
 * are the source here, and the staleness guard beside it is what keeps that from
 * rotting: every exported `…Disposition` function in the workspace has to appear,
 * so a second accessor written tomorrow fails this file until its surface status has
 * been decided.
 *
 * One entry today. `@mnema/code` frames a pattern body it just served — an
 * instruction if the pattern is in force, a proposal if it is not — and that framing
 * has to know which, from the one place that says so.
 */
const ASKED_NOT_COPIED: readonly { readonly specifier: string; readonly accessor: string }[] = [
  { specifier: '@mnema/copilot', accessor: 'skillDisposition' },
];

/** Every `export function …Disposition` in production — the accessors that exist. */
function accessorsInProduction(): string[] {
  const found: string[] = [];
  for (const directory of readdirSync(PACKAGES).sort()) {
    const src = join(PACKAGES, directory, 'src');
    if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const path of sourceFiles(src)) {
      for (const match of readFileSync(path, 'utf-8').matchAll(
        /^export function (\w*Disposition)\s*\(/gm,
      )) {
        found.push(match[1] as string);
      }
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('no classification table reaches the surface', () => {
  it('reads the whole surface and the whole set of declarations', () => {
    // The enumeration's own non-vacuity, and it comes first because every case below
    // is a filter over these three collections: an entry point that stopped
    // resolving, a claim that was reworded, or a machine tuple that left the core
    // would each empty a net and pass in silence.
    expect(publishedValues().length).toBeGreaterThan(200);
    expect(MACHINES.map((machine) => machine.name)).toEqual([
      'DECISION_STATES',
      'SKILL_STATES',
      'TASK_STATES',
    ]);
    expect(
      Object.fromEntries(
        HIDDEN.map((hidden) => [hidden.module, hidden.tables.map((table) => table.name).sort()]),
      ),
    ).toEqual(DECLARED_HIDDEN);
  });

  it('keeps every table its module declares hidden off every entry point', () => {
    // The rule. Six tables in four modules, each one declaring in its own doc that it
    // is not on the package's public surface — now checked instead of asserted.
    expect(leaked(publishedValues())).toEqual([]);
  });

  it('publishes no total table over a machine’s states, however it got there', () => {
    // The second net, which needs no declaration: a `Record<State, …>` on the surface
    // is a classification a consumer can read and re-derive from, whatever it is
    // called and whichever module wrote it.
    expect(perStateTables(publishedValues())).toEqual([]);
  });

  it('accuses a leak by name, by identity and by shape — on input of its own', () => {
    // The mechanism's non-vacuity, in all three ways it can fire. With the real
    // surface clean the three cases above say only "nothing is accused": none of them
    // exercises the accusation, so nothing has ever proved these nets can go red. The
    // input is a synthetic surface holding the REAL hidden tables, which is what
    // makes the case survive a day when no shape in the tree is like it.
    const table = HIDDEN.flatMap((hidden) => hidden.tables).find(
      (candidate) => candidate.name === 'SKILL_DISPOSITION',
    )?.value;
    expect(table).toBeDefined();

    // By name: the ordinary re-export, which is the mutation this guard was written for.
    expect(
      leaked([{ specifier: '@mnema/copilot', name: 'SKILL_DISPOSITION', value: table }]),
    ).toEqual(['@mnema/copilot SKILL_DISPOSITION']);
    // By identity: renamed on the way out, so a name check alone would let it through.
    expect(leaked([{ specifier: '@mnema/copilot', name: 'MEANINGS', value: table }])).toEqual([
      '@mnema/copilot MEANINGS',
    ]);
    // And not everything is accused: a value that is neither a hidden table nor a
    // per-state one comes through clean, so the nets are filters and not a constant.
    expect(leaked([{ specifier: '@mnema/copilot', name: 'brief', value: () => 1 }])).toEqual([]);

    // By shape: a copy of the rows under a new name is a new object, so name and
    // identity both miss it and only the machine's key set catches it.
    expect(
      perStateTables([{ specifier: '@mnema/copilot', name: 'MEANINGS', value: { ...table } }]),
    ).toEqual(['@mnema/copilot MEANINGS (SKILL_STATES)']);
    // A subset of the states is NOT accused — the declared blind spot, held as a case
    // so it stays a decision rather than becoming a surprise.
    expect(
      perStateTables([
        { specifier: '@mnema/copilot', name: 'HALF', value: { proposed: 1, reviewed: 1 } },
      ]),
    ).toEqual([]);
  });

  it('keeps the exported way of asking ON the surface', () => {
    // The other direction, and the one the first three cases cannot see: with the
    // table hidden AND the accessor gone, a consumer in another package has no honest
    // path to the classification and the only thing left is to write it out again.
    for (const { specifier, accessor } of ASKED_NOT_COPIED) {
      const surface = SURFACE.find((entry) => entry.specifier === specifier);
      expect(surface, specifier).toBeDefined();
      expect(typeof surface?.values[accessor], `${specifier} ${accessor}`).toBe('function');
    }
    // And the list cannot rot: every accessor production defines has to be in it, so a
    // second one arrives as a failure here rather than as an undecided export.
    expect(accessorsInProduction()).toEqual(ASKED_NOT_COPIED.map((entry) => entry.accessor).sort());
  });
});

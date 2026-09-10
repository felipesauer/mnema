/**
 * Every value the workspace exports publicly has a caller in production.
 *
 * Four defects of this series were one shape: an option plumbed to the end with
 * nothing feeding it. `disambiguate` exported and called by nobody,
 * `transport.onclose` with no production caller, `configProject` documented and set
 * by no flag. Every one of them passed every test of the code UNDER the gap, because
 * that code was right: the resolver honoured the value it was handed, and nobody
 * handed it one. No review catches this class, because the defect is an ABSENCE —
 * there is nothing to look at.
 *
 * THE FOURTH NAME CAME OFF THIS LIST, and what it was replaced with is worth more
 * than the row. It read `DEFAULT_CHECKPOINT_EVERY inert`, and the premise behind that
 * word was that a constant no production caller ever OVERRIDES is a constant nothing
 * uses. That is false, and it was falsified by measuring: the value is the writer's
 * default, so production runs ON it rather than around it, and `mnema decision import
 * --write` crosses it on a directory of 33 ADRs (measured in
 * `every-write-signs-what-it-wrote.test.ts`). Its sibling `DEFAULT_MAX_SEGMENT_BYTES`
 * is unfed by exactly the same test and nobody has ever called it dead. So the shape
 * this file hunts is *exported and never REFERENCED*, which is what it actually
 * checks; *never overridden by a caller* is a different question and not a defect.
 * The constant now says what it is: `DEFAULT_MAX_UNSIGNED_EVENTS`.
 *
 * So this walks the public surface itself. For every VALUE a package's entry point
 * exports, some non-test file under `packages/*​/src` must reference it in code.
 * Three of the four packages are private and exist for `@mnema/code` to consume,
 * so an export with no consumer inside this workspace has no consumer at all; the
 * published one is a binary and an MCP server, not a library.
 *
 * WHAT A REFERENCE IS, and why each exclusion is there:
 *   - not PROSE. A `{@link}` in a doc-comment is what made `disambiguate` look
 *     alive for as long as it existed, and the four link relations named in a tool
 *     description would have kept a dead vocabulary constant looking wired. So
 *     comments and string literals are blanked before anything is counted.
 *   - not a RE-EXPORT. Plumbing a value out to the surface is not consuming it —
 *     which is exactly why a barrel cannot be the caller that saves it.
 *   - not its own DECLARATION. `export const X = …` is not a use of X; a later
 *     line in the same file is.
 *   - not another package's name for it. A reference in a different package counts
 *     only if that file IMPORTS the name from this package: `PACKAGE_NAME` is
 *     exported by all four, and without this every one of them would be kept alive
 *     by whichever single package still used its own.
 *
 * WHAT IT DOES NOT DO:
 *   - TYPES ARE NOT SUBJECT. An exported `interface` exists to type a consumer
 *     without anyone calling it; including types would produce false positives in
 *     bulk, the guard would be switched off, and a guard nobody runs is worse than
 *     no guard. Enumeration is by RUNTIME KEY, so a type cannot enter by accident:
 *     it is gone before this file runs.
 *   - IT COVERS ONE OF THREE SHAPES. This one is a whole VALUE exported with no
 *     caller. The second is a FIELD of an options object that nobody sets — what
 *     `configProject` and `transport.onclose` were — and catching that one
 *     mechanically means enumerating every option interface and every setter of
 *     it, which is frailer; it already has a per-case mould in
 *     `mcp-flag-reaches-the-server.test.ts`, which asserts that a flag REACHES
 *     the option. Said out loud here so a pass is not read as covering both.
 *
 *     THE THIRD SHAPE IS AN ARM of a public record whose whole value IS called: it
 *     lives at the bottom of this file, and it is here because it was found the way
 *     the other two were — by a defect. `ALIAS_PREFIXES` declared `task`, `epic` and
 *     `sprint`; production passed `'task'` at all four call sites and never the other
 *     two. The value had a caller, so this guard was silent and right to be — an arm
 *     is not a value, and enumeration is by runtime key of the MODULE, not of the
 *     records inside it. Whether the third shape deserves a general sweep is a
 *     NUMBER, and the number says no: exactly two public exports are flat records
 *     (`ALIAS_PREFIXES` and `@mnema/chain`'s `LATEST_VERSION`), and `LATEST_VERSION`
 *     would need an exception on the day it was born, because its arms are keyed by
 *     the closed catalogue and fed by the catalogue rather than chosen by a caller.
 *     A guard with one subject and one exception is the shape the paragraph above
 *     refuses, so what stands is the per-case mould, for the one record whose arm a
 *     caller SELECTS.
 *
 *     THE FRAILTY IS NOW A NUMBER, and the number is why the second shape still has
 *     no guard. Asked from the READ end rather than the setter end — a field READ in
 *     production and written as `<name>:` by no production file — the sweep over
 *     packages/*​/src sees 345 optional-field declarations under 100 distinct names and accuses
 *     SIX. Five of the six would have to be excused on the day it was born: `json`,
 *     `require` and `allowNoRecord` are fed by the commander from `--json`,
 *     `--require` and `--allow-no-record`, so no product file ever writes the key;
 *     `parseArg` is a commander hook it calls itself; `fetch`
 *     (`chain/src/chain/witness-request.ts:106`) is a network seam with a `?? fetch`
 *     default and only tests pass one. A guard needing five exceptions to be born is
 *     the shape the paragraph above refuses, so it was not built.
 *
 *     THE SIXTH IS REAL AND IS NAMED WHERE IT LIVES: `CacheOptions.dbPath`, public on
 *     `@mnema/core`, read at `core/src/projections/cache.ts:106`, and set by no
 *     production caller — all six `ProjectionCache.open` sites pass `upcasters`
 *     alone. It is not dead: it is the seam `cache.test.ts` and `advance.test.ts`
 *     prove persistence across a close and re-open through. Its own doc now says so,
 *     which is what a one-instance class gets instead of a guard.
 *
 * Known blind spots, so nobody reads more into a pass than it says: a class method
 * or object key that happens to share an exported value's name reads as a
 * reference to it, and `import * as ns` would hide every use behind a property
 * access. Neither exists in this workspace today, and the second would fail loudly
 * (as a false accusation) rather than silently.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALIAS_PREFIXES } from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// The public surface, read from the manifests
// ---------------------------------------------------------------------------

/** One public entry point: the specifier a consumer writes, and the source behind it. */
interface Entry {
  readonly specifier: string;
  readonly source: string;
}

/** One workspace package and every entry point its manifest declares. */
interface Package {
  readonly name: string;
  readonly directory: string;
  readonly entries: readonly Entry[];
}

/** The `exports` map's shape, as far as this file needs it. */
type ExportTarget = string | { readonly default?: string };

/**
 * Every package under `packages/`, with its entry points taken from its own
 * manifest — never from a list kept here. A package added tomorrow, or a subpath
 * export added to one, is covered without this file being edited; the floor table
 * below is what makes the addition VISIBLE instead of silent.
 *
 * The entry's SOURCE is read, not its `dist`. A guard that read the build would
 * pass on a stale one, which is the failure this repo has already paid for twice.
 */
function workspacePackages(): Package[] {
  const found: Package[] = [];
  for (const directory of readdirSync(PACKAGES).sort()) {
    const manifestPath = join(PACKAGES, directory, 'package.json');
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest: { name?: string; exports?: Record<string, ExportTarget> } = JSON.parse(
      readFileSync(manifestPath, 'utf-8'),
    );
    const name = manifest.name ?? directory;
    const entries: Entry[] = [];
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const built = typeof target === 'string' ? target : target.default;
      if (built === undefined) continue;
      entries.push({
        specifier: subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`,
        source: join(
          PACKAGES,
          directory,
          built.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'),
        ),
      });
    }
    found.push({ name, directory, entries });
  }
  return found;
}

// ---------------------------------------------------------------------------
// What a production file references
// ---------------------------------------------------------------------------

/** An `export { … }` clause, with or without a `from`: the plumbing, not a use. */
const EXPORT_CLAUSE = /export\s+(?:type\s+)?\{[^}]*\}(?:\s*from)?/g;
/** A value's own declaration head — the name it introduces is not a use of it. */
const DECLARATION =
  /((?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\s*\*?|class|enum)\s+)[A-Za-z_$][\w$]*/g;
/** Any identifier. */
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

/**
 * The identifiers a file references: what is left after the comments, the string
 * literals, the re-export clauses and its own declaration heads are gone. A
 * property access (`writer.append`) is dropped too — it names a member, not the
 * exported value that happens to share the name.
 *
 * A SPREAD IS A REFERENCE, and reading it as a property access is what this guard did
 * until `ADDRESS_RELATIONS` was accused: the pair of path relations is defined once and
 * spread into the recommended set in the very next statement, and `...NAME` ends in the
 * same character `obj.NAME` does. The accusation was the instrument's, not the code's —
 * the value had a caller three lines below its declaration — so the two dots are told
 * apart here rather than the source being written to suit the reader.
 */
function referencedIdentifiers(source: string): Set<string> {
  const code = codeOnly(source)
    .replace(EXPORT_CLAUSE, ' ')
    .replace(DECLARATION, (_whole, head: string) => head);
  const referenced = new Set<string>();
  for (const match of code.matchAll(IDENTIFIER)) {
    let before = (match.index ?? 0) - 1;
    while (before >= 0 && (code[before] === ' ' || code[before] === '\n')) before -= 1;
    // `.NAME` is a member; `...NAME` is the value itself.
    if (before >= 0 && code[before] === '.' && code[before - 1] !== '.') continue;
    referenced.add(match[0]);
  }
  return referenced;
}

/** An `import { … } from '<specifier>'` statement, anchored so a commented one cannot match. */
const IMPORT_CLAUSE = /^[ \t]*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
/**
 * A `const { … } = await import('<specifier>')` — the CLI's way of loading a verb's
 * work when the verb runs, so the floor stays the declaration (see
 * `wiring/verb.ts`).
 *
 * It is a second shape of the same thing, and reading only the first one made this
 * guard accuse `@mnema/chain requiredLevel` the day its one caller moved inside an
 * action: the reference was still there, and the attribution was not. Anchored at
 * the statement for the same reason the other one is anchored at the line.
 */
const DYNAMIC_IMPORT_CLAUSE =
  /^[ \t]*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * Which names this file imports from which specifier, statically or when the verb
 * runs. It is how a reference is attributed to the package that exports it, so two
 * packages exporting the same name cannot cover for each other.
 */
function importedNames(source: string): Map<string, Set<string>> {
  const bySpecifier = new Map<string, Set<string>>();
  for (const clauses of [IMPORT_CLAUSE, DYNAMIC_IMPORT_CLAUSE]) {
    for (const statement of source.matchAll(clauses)) {
      const specifier = statement[2] as string;
      const names = bySpecifier.get(specifier) ?? new Set<string>();
      for (const clause of (statement[1] as string).split(',')) {
        const imported = clause
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.split(':')[0]
          ?.trim();
        if (imported !== undefined && imported.length > 0) names.add(imported);
      }
      bySpecifier.set(specifier, names);
    }
  }
  return bySpecifier;
}

/** An `export { … } from '…'` clause: what a barrel plumbs out without using. */
const RE_EXPORT_CLAUSE = /export\s+(?:type\s+)?\{([^}]*)\}\s*from/g;

/** The names a barrel re-exports from another module, types included. */
function reExportedNames(source: string): string[] {
  const names: string[] = [];
  for (const clause of source.matchAll(RE_EXPORT_CLAUSE)) {
    for (const item of (clause[1] as string).split(',')) {
      const name = item.trim().replace(/^type\s+/, '');
      if (name.length > 0) names.push(name);
    }
  }
  return names;
}

/**
 * The names a barrel exports AS TYPES — either `export type { … }` or a `type`
 * modifier inside a clause. `verbatimModuleSyntax` makes the modifier mandatory, so
 * this reads the whole type surface, not a sample of it.
 */
function typeExportedNames(source: string): string[] {
  const names: string[] = [];
  for (const clause of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const wholeClauseIsTypes = clause[1] !== undefined;
    for (const item of (clause[2] as string).split(',')) {
      const bare = item.trim();
      if (bare.length === 0) continue;
      if (wholeClauseIsTypes) names.push(bare);
      else if (bare.startsWith('type ')) names.push(bare.slice('type '.length).trim());
    }
  }
  return names;
}

/** One non-test source file, with what it references and where it imported it from. */
interface ProductionFile {
  readonly owner: string;
  readonly referenced: ReadonlySet<string>;
  readonly imported: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Production, as this guard reads it: every package's own source, tests excluded. */
function productionFiles(packages: readonly Package[]): ProductionFile[] {
  const files: ProductionFile[] = [];
  for (const pkg of packages) {
    for (const path of sourceFiles(join(PACKAGES, pkg.directory, 'src'))) {
      const source = readFileSync(path, 'utf-8');
      files.push({
        owner: pkg.name,
        referenced: referencedIdentifiers(source),
        imported: importedNames(source),
      });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// The surface, enumerated once
// ---------------------------------------------------------------------------

const PACKAGE_LIST = workspacePackages();
const PRODUCTION = productionFiles(PACKAGE_LIST);

/** One entry point's exported values — its runtime keys, so no type is among them. */
interface Surface {
  readonly package: string;
  readonly specifier: string;
  readonly source: string;
  readonly values: readonly string[];
}

const SURFACE: Surface[] = [];
for (const pkg of PACKAGE_LIST) {
  for (const entry of pkg.entries) {
    const loaded: Record<string, unknown> = await import(entry.source);
    SURFACE.push({
      package: pkg.name,
      specifier: entry.specifier,
      source: entry.source,
      values: Object.keys(loaded).sort(),
    });
  }
}

/** Which package a specifier names: a `@mnema/*` one, or the reader's own. */
function specifierOwner(specifier: string, reader: string): string {
  const named = PACKAGE_LIST.find(
    (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
  );
  return named?.name ?? reader;
}

/**
 * Whether some production file references this package's value.
 *
 * A file of the package itself counts — unless it imported that very name from
 * ANOTHER package, in which case the identifier in it is the other package's
 * export and attributing it here would be the collision this guard exists to
 * avoid. A file of a different package counts only if it imported the name from
 * this one by specifier.
 */
function hasProductionCaller(owner: string, value: string): boolean {
  const specifiers = SURFACE.filter((entry) => entry.package === owner).map(
    (entry) => entry.specifier,
  );
  return PRODUCTION.some((file) => {
    if (!file.referenced.has(value)) return false;
    if (file.owner === owner) {
      for (const [specifier, names] of file.imported) {
        if (names.has(value) && specifierOwner(specifier, file.owner) !== owner) return false;
      }
      return true;
    }
    return specifiers.some((specifier) => file.imported.get(specifier)?.has(value) === true);
  });
}

/** Every exported value with no production caller, as `<specifier> <name>`. */
function unwired(): string[] {
  const dead: string[] = [];
  for (const entry of SURFACE) {
    for (const value of entry.values) {
      if (!hasProductionCaller(entry.package, value)) dead.push(`${entry.specifier} ${value}`);
    }
  }
  return dead.sort();
}

// ---------------------------------------------------------------------------
// The declarations
// ---------------------------------------------------------------------------

/**
 * The exported values that have no caller and STAY that way, each with the reason.
 *
 * It is checked in both directions, which is what keeps it from becoming the
 * allowlist every dead guard ends as: a value that gains a caller has to LEAVE
 * this table or the assertion fails, and so does one that stops being exported.
 *
 * IT IS EMPTY, and that is the strongest state this table has: every value the
 * workspace exports publicly has a production caller. Its last entry was
 * `@mnema/core listProjects` — the reader of a machine-local project index that
 * `init` wrote on every founding and nothing ever read, while telling the person it
 * had happened. It was removed rather than wired, because what a read covers comes
 * from the trees the client announces.
 *
 * An empty table also ERASES the proof that declaring an exception works, which is
 * the vacuity this file warns about elsewhere — a guard whose escape hatch is
 * untested is a guard whose next legitimate residue discovers it broken. So
 * {@link reconcile} is the mechanism as one function, and it is exercised on
 * SYNTHETIC input in both directions. The synthetic entries live in that test, never
 * here: this table stays auto-pruning over the real surface.
 */
const UNWIRED: Readonly<Record<string, string>> = {};

/** What an exception table tolerates, and what it does not. */
interface Reconciliation {
  /** Accused and NOT declared — the guard's teeth. */
  readonly accused: readonly string[];
  /** Declared and no longer accused — a declaration that outlived its reason. */
  readonly stale: readonly string[];
}

/**
 * Reconciles the accusations against the declarations, in both directions at once.
 *
 * The second direction is the auto-pruning: a declared value that GAINED a caller,
 * or stopped being exported, is no longer accused and must leave the table — so a
 * declaration cannot quietly outlive the reason written next to it. It is a
 * function, not an inline comparison, so the mechanism can be driven by a test
 * with input of its own on the day the real table is empty.
 */
function reconcile(
  accused: readonly string[],
  declared: Readonly<Record<string, string>>,
): Reconciliation {
  const names = Object.keys(declared);
  return {
    accused: accused.filter((value) => !names.includes(value)).sort(),
    stale: names.filter((name) => !accused.includes(name)).sort(),
  };
}

/**
 * The fewest values each entry point may export, and the one that exports NONE.
 *
 * This is the enumeration's own non-vacuity. The guard loads a module to find its
 * values, so an entry whose path stopped resolving, or a manifest whose `exports`
 * map changed shape, would report an empty surface and pass in silence. A floor
 * fails instead. `@mnema/code`'s zero is DECLARED: the published package is a
 * binary and an MCP server, and nothing imports it as a library.
 *
 * A key missing here, or one too many, fails as well — that is how a new package
 * or a new subpath export announces itself.
 */
const SURFACE_FLOOR: Readonly<Record<string, number>> = {
  '@mnema/chain': 75,
  // One value, and it is published on its own for exactly that: `oneLine` is what makes
  // a report line ONE line, three packages want it, and the ones that load it before a
  // verb has been routed may not pay for the proof engine to get it.
  '@mnema/chain/one-line': 1,
  '@mnema/code': 0,
  '@mnema/copilot': 20,
  '@mnema/core': 90,
  '@mnema/core/write': 25,
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('every public value has a caller', () => {
  it('accuses nothing but what is declared unwired', () => {
    // One assertion, both directions: an export that loses its last caller lands in
    // `accused`, and a declared one that gained a caller — or stopped being exported
    // — lands in `stale` until its entry leaves the table.
    expect(reconcile(unwired(), UNWIRED)).toEqual({ accused: [], stale: [] });
  });

  it('reads a spread as a use and a member access as none', () => {
    // The instrument's own case, because a scanner that errs by ACCUSING is as broken
    // as one that errs by staying silent — and this one did, on the exact shape a
    // single-site constant takes when a second list is built from it. Both directions,
    // so a fix that simply stopped dropping members would fail here.
    const referenced = referencedIdentifiers(
      ['const built = [...SOURCE_LIST];', 'const value = holder.SOURCE_LIST;'].join('\n'),
    );
    expect(referenced.has('SOURCE_LIST')).toBe(true);
    expect(referencedIdentifiers('const value = holder.MEMBER_ONLY;').has('MEMBER_ONLY')).toBe(
      false,
    );
  });

  it('tolerates a declared value and still accuses an undeclared one', () => {
    // The mechanism's own non-vacuity, on input this test owns. With the real table
    // empty the assertion above says only "nothing is accused" — it exercises neither
    // half of the exception, so the day a legitimate residue needs one, nothing has
    // ever proved it works. These names are not real exports and never enter the
    // product's table.
    const accused = ['@mnema/core notCalledOne', '@mnema/core notCalledTwo'];

    // Declared ⇒ tolerated. Undeclared ⇒ still accused, and NAMED.
    expect(reconcile(accused, { '@mnema/core notCalledOne': 'the reason' })).toEqual({
      accused: ['@mnema/core notCalledTwo'],
      stale: [],
    });
    // Declaring both leaves nothing to report — which is what "the table works" means.
    expect(
      reconcile(accused, {
        '@mnema/core notCalledOne': 'the reason',
        '@mnema/core notCalledTwo': 'the other reason',
      }),
    ).toEqual({ accused: [], stale: [] });
    // The other direction, and the one that keeps this from becoming an allowlist: a
    // declaration for a value that is no longer accused is reported as stale, so the
    // guard FAILS until the entry is deleted. Without it, a table entry would survive
    // its own reason forever.
    expect(reconcile([], { '@mnema/core notCalledOne': 'the reason' })).toEqual({
      accused: [],
      stale: ['@mnema/core notCalledOne'],
    });
    // And the empty case is not accidentally the same as the tolerant one: with no
    // declarations at all, every accusation comes through.
    expect(reconcile(accused, {})).toEqual({ accused, stale: [] });
  });

  it('reads the whole surface the manifests declare', () => {
    const counted = new Map(SURFACE.map((entry) => [entry.specifier, entry.values.length]));
    expect([...counted.keys()].sort()).toEqual(Object.keys(SURFACE_FLOOR).sort());
    for (const [specifier, floor] of Object.entries(SURFACE_FLOOR)) {
      expect(
        counted.get(specifier),
        `${specifier} exports fewer values than declared`,
      ).toBeGreaterThanOrEqual(floor);
    }
    // The entry points are SOURCE files, not the build: a guard reading `dist`
    // passes on a stale one.
    for (const entry of SURFACE) expect(entry.source.endsWith('.ts')).toBe(true);
  });

  it('never accuses a type — only values are subject to the rule', () => {
    // Not one hand-picked example: EVERY name the barrels export as a type, checked
    // against the subject set. If a type ever entered, the rule would start asking
    // for a caller of something that cannot have one, the accusations would arrive
    // in bulk, and the guard would be switched off — which is worse than not having
    // it. Enumeration is by runtime key, so this holds by construction; the
    // assertion is what makes the construction provable instead of asserted.
    const types = SURFACE.flatMap((entry) =>
      typeExportedNames(readFileSync(entry.source, 'utf-8')).map((name) => ({
        entry: entry.specifier,
        name,
      })),
    );
    expect(types.length).toBeGreaterThan(100);
    for (const { entry, name } of types) {
      const values = SURFACE.find((surface) => surface.specifier === entry)?.values ?? [];
      expect(values, `${entry} counts the type ${name} as a value`).not.toContain(name);
    }
    // And the teeth: some of those types have no production caller either, so
    // including them would produce accusations nobody could act on.
    const wouldAccuse = types.filter(({ entry, name }) => {
      const owner = SURFACE.find((surface) => surface.specifier === entry)?.package ?? '';
      return !hasProductionCaller(owner, name);
    });
    expect(wouldAccuse.length).toBeGreaterThan(0);
  });

  it('never takes a barrel’s re-export as the caller', () => {
    // Synthetic, so the case survives the day nothing in the tree is shaped like it:
    // a file whose only mention of a name is a re-export references nothing.
    expect([...referencedIdentifiers("export { disambiguate } from './alias.js';")]).not.toContain(
      'disambiguate',
    );
    expect([
      ...referencedIdentifiers("export {\n  deriveAlias,\n  type AliasKind,\n} from './alias.js';"),
    ]).not.toContain('deriveAlias');
    // And the real thing: an entry barrel re-exports the whole surface, so if a
    // re-export counted as a use, this guard could never accuse anything at all.
    let plumbed = 0;
    for (const entry of SURFACE) {
      const source = readFileSync(entry.source, 'utf-8');
      const referenced = referencedIdentifiers(source);
      for (const name of reExportedNames(source)) {
        plumbed += 1;
        expect([...referenced], `${entry.specifier} counts its re-export of ${name}`).not.toContain(
          name,
        );
      }
    }
    // Non-vacuity: the loop above asserts nothing if the clauses stop being found.
    expect(plumbed).toBeGreaterThan(100);
  });

  it('reads a reference in code, and only in code', () => {
    // The extractor's own non-vacuity: each exclusion has a case that fails if the
    // exclusion goes away, and each inclusion has one that fails if it stops
    // counting. Without the first pair the guard is vacuous — a `{@link}` alone kept
    // `disambiguate` looking alive, and prose in a tool description would keep a
    // dead vocabulary constant looking wired.
    const references = (source: string): string[] => [...referencedIdentifiers(source)];

    expect(references('/** See {@link disambiguate} for the set form. */')).not.toContain(
      'disambiguate',
    );
    expect(references('// disambiguate was here\nconst x = 1;')).not.toContain('disambiguate');
    expect(references("describe('disambiguate lengthens', () => {});")).not.toContain(
      'disambiguate',
    );
    expect(references(`const help = \`recommended: \${1}\`;`)).not.toContain('recommended');
    expect(references('export const PACKAGE_NAME = 1;')).not.toContain('PACKAGE_NAME');
    expect(references('const writer = 1;\nwriter.append();')).not.toContain('append');

    expect(references("import { disambiguate } from './alias.js';")).toContain('disambiguate');
    expect(references('export const A = 1;\nconst b = A + 1;')).toContain('A');
    expect(references(`const label = \`\${deriveAlias(id)}\`;`)).toContain('deriveAlias');
    expect(references('const { buildMcpServer } = await import("./server.js");')).toContain(
      'buildMcpServer',
    );
  });

  it('attributes a reference to the package that exports the name', () => {
    // `PACKAGE_NAME` is the case: more than one package exported it, and a
    // name-matching guard let whichever package still used its own keep the others
    // alive. The imports decide instead.
    const source = "import { REFERENCE_ROLES } from '@mnema/core';\nconst r = REFERENCE_ROLES;";
    expect(importedNames(source).get('@mnema/core')?.has('REFERENCE_ROLES')).toBe(true);
    expect(importedNames(source).get('@mnema/copilot')).toBeUndefined();
    // A commented-out import is not an import.
    expect(importedNames("// import { x } from '@mnema/core';").size).toBe(0);
    expect(importedNames(" * import { x } from '@mnema/core';").size).toBe(0);
    // A verb loads its work when it runs, and that attributes the name just the same
    // — the shape this guard did not know until a caller moved inside an action.
    expect(
      importedNames("      const { requiredLevel } = await import('@mnema/chain');")
        .get('@mnema/chain')
        ?.has('requiredLevel'),
    ).toBe(true);
    expect(
      importedNames("      // const { requiredLevel } = await import('@mnema/chain');").size,
    ).toBe(0);
    // An aliased import is attributed to the name the package exports, not the
    // local one.
    expect(
      importedNames("import { PACKAGE_NAME as CORE } from '@mnema/core';")
        .get('@mnema/core')
        ?.has('PACKAGE_NAME'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The third shape: an arm of a public record that a caller SELECTS
// ---------------------------------------------------------------------------

/** A call to `deriveAlias`, wherever it stands. */
const A_DERIVE_ALIAS_CALL = /deriveAlias\(/g;
/** The kind it passes, read from the call's own first argument. */
const THE_KIND_IT_PASSES = /^deriveAlias\(\s*'([^']*)'/;

/**
 * Which alias kinds ONE file passes, read from its call sites and not from a list.
 *
 * The kind is a string literal, so the blanker this file uses everywhere else is the
 * wrong reader for it: `codeOnly` exists to blank literals, and the argument is one.
 * It is still the thing that decides whether a call is CODE, because it preserves
 * positions — a `deriveAlias(` that survives blanking is at the same offset in the
 * raw source, and one written inside a doc-comment is not there at all. So the two are
 * read together: the blanked text says WHERE a real call is, and the raw text at that
 * offset says WHAT it passes. Nothing in the shared scanner had to change to ask this,
 * and no second scanner was written to ask it.
 *
 * IT TAKES A SOURCE RATHER THAN WALKING THE TREE, and that is not tidiness. Asked over
 * production only, the blanking step is redundant TODAY: no production comment happens
 * to spell a call with a literal kind, so replacing `codeOnly(source)` with `source`
 * changes nothing and leaves the guard at ZERO — measured, as row M2.2 of this
 * delivery's battery. A step whose removal reddens nothing is a step nothing proves. So
 * the reader is a function over text, and the case below drives it on prose it owns; the
 * same mutation now reddens that case instead of passing in silence.
 */
function kindsPassedIn(source: string): Set<string> {
  const passed = new Set<string>();
  const code = codeOnly(source);
  for (const call of code.matchAll(A_DERIVE_ALIAS_CALL)) {
    const kind = THE_KIND_IT_PASSES.exec(source.slice(call.index ?? 0))?.[1];
    if (kind !== undefined) passed.add(kind);
  }
  return passed;
}

/** The same question over every production file the workspace has. */
function kindsProductionPasses(): Set<string> {
  const passed = new Set<string>();
  for (const pkg of PACKAGE_LIST) {
    for (const path of sourceFiles(join(PACKAGES, pkg.directory, 'src'))) {
      for (const kind of kindsPassedIn(readFileSync(path, 'utf-8'))) passed.add(kind);
    }
  }
  return passed;
}

describe('every arm of a selected vocabulary has a caller', () => {
  it('production passes every kind `ALIAS_PREFIXES` declares, and no other', () => {
    // The enumeration comes from the value itself, so an arm added tomorrow is subject
    // to this without the file being edited — which is the whole point, since the two
    // arms this replaces were added once and never fed. Both directions: an arm nobody
    // passes fails on the left, and a kind production passes that the map does not
    // declare fails on the right (the compiler would refuse it first, and this says so
    // out loud rather than trusting a check that lives in another tool).
    expect([...kindsProductionPasses()].sort()).toEqual(Object.keys(ALIAS_PREFIXES).sort());
  });

  it('reads a call in code and not one in prose', () => {
    // The instrument's own case, driven through the SAME reader the assertion above
    // uses. A new instrument gets one because this series has been accused BY one: the
    // reader that finds a call has to tell a call from a sentence about a call, and
    // `alias.ts`'s own doc-comment names the function repeatedly. Over production alone
    // this direction is unprovable — nothing there spells a call in prose — so the input
    // is owned here, which is what makes the blanking step's removal visible.
    expect([
      ...kindsPassedIn("/** Something like deriveAlias('epic', id) used to work. */"),
    ]).toEqual([]);
    expect([...kindsPassedIn("const label = deriveAlias('task', id);")]).toEqual(['task']);
    // A call whose kind is not a literal is not a kind, and reporting the next token as
    // one would let any identifier bless an arm.
    expect([...kindsPassedIn('const label = deriveAlias(kind, id);')]).toEqual([]);
  });

  it('finds the call sites at all', () => {
    // Non-vacuity of the sweep: a scanner that found nothing would make the assertion
    // above compare two empty sets on the day the map went empty, and pass. Four sites
    // is what production has — two on each surface, task birth and task move.
    expect(kindsProductionPasses().size).toBeGreaterThan(0);
    expect(Object.keys(ALIAS_PREFIXES).length).toBeGreaterThan(0);
  });
});

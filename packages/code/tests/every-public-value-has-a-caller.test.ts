/**
 * Every value the workspace exports publicly has a caller in production.
 *
 * Four defects of this series were one shape: an option plumbed to the end with
 * nothing feeding it. `disambiguate` exported and called by nobody,
 * `DEFAULT_CHECKPOINT_EVERY` inert, `transport.onclose` with no production caller,
 * `configProject` documented and set by no flag. Every one of them passed every
 * test of the code UNDER the gap, because that code was right: the resolver
 * honoured the value it was handed, and nobody handed it one. No review catches
 * this class, because the defect is an ABSENCE — there is nothing to look at.
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
 *   - IT COVERS ONE OF THE TWO SHAPES. This one is a whole VALUE exported with no
 *     caller. The other is a FIELD of an options object that nobody sets — what
 *     `configProject` and `transport.onclose` were — and catching that one
 *     mechanically means enumerating every option interface and every setter of
 *     it, which is frailer; it already has a per-case mould in
 *     `mcp-flag-reaches-the-server.test.ts`, which asserts that a flag REACHES
 *     the option. Said out loud here so a pass is not read as covering both.
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
import { describe, expect, it } from 'vitest';

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

/** The lexical states this scanner walks; everything but `code` is blanked. */
type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

/**
 * The source with every comment and string literal blanked, and newlines kept so
 * nothing shifts. A template's interpolations survive — `${deriveAlias(id)}` is a
 * call — while the literal text around them does not, which is why a nested
 * template inside an interpolation is handled by the stack rather than by a
 * counter.
 */
function codeOnly(source: string): string {
  const kept: string[] = [];
  const stack: { mode: Mode; braces: number }[] = [{ mode: 'code', braces: 0 }];
  let i = 0;
  while (i < source.length) {
    const frame = stack[stack.length - 1] as { mode: Mode; braces: number };
    const char = source[i] as string;
    const next = source[i + 1];
    if (frame.mode === 'code') {
      if (char === '/' && next === '/') {
        stack.push({ mode: 'line', braces: 0 });
        kept.push('  ');
        i += 2;
      } else if (char === '/' && next === '*') {
        stack.push({ mode: 'block', braces: 0 });
        kept.push('  ');
        i += 2;
      } else if (char === "'" || char === '"' || char === '`') {
        stack.push({
          mode: char === "'" ? 'single' : char === '"' ? 'double' : 'template',
          braces: 0,
        });
        kept.push(' ');
        i += 1;
      } else if (char === '{') {
        frame.braces += 1;
        kept.push(char);
        i += 1;
      } else if (char === '}' && frame.braces === 0 && stack.length > 1) {
        stack.pop();
        kept.push(' ');
        i += 1;
      } else {
        if (char === '}') frame.braces -= 1;
        kept.push(char);
        i += 1;
      }
      continue;
    }
    if (frame.mode === 'line') {
      if (char === '\n') {
        stack.pop();
        kept.push('\n');
      } else kept.push(' ');
      i += 1;
      continue;
    }
    if (frame.mode === 'block') {
      if (char === '*' && next === '/') {
        stack.pop();
        kept.push('  ');
        i += 2;
      } else {
        kept.push(char === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }
    // A string or a template's literal text: escapes consume two characters so a
    // `\'` never reads as the closing quote.
    if (char === '\\') {
      kept.push('  ');
      i += 2;
      continue;
    }
    if (frame.mode === 'template' && char === '$' && next === '{') {
      stack.push({ mode: 'code', braces: 0 });
      kept.push('  ');
      i += 2;
      continue;
    }
    const closes =
      (frame.mode === 'single' && char === "'") ||
      (frame.mode === 'double' && char === '"') ||
      (frame.mode === 'template' && char === '`');
    if (closes) {
      stack.pop();
      kept.push(' ');
    } else kept.push(char === '\n' ? '\n' : ' ');
    i += 1;
  }
  return kept.join('');
}

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
 */
function referencedIdentifiers(source: string): Set<string> {
  const code = codeOnly(source)
    .replace(EXPORT_CLAUSE, ' ')
    .replace(DECLARATION, (_whole, head: string) => head);
  const referenced = new Set<string>();
  for (const match of code.matchAll(IDENTIFIER)) {
    let before = (match.index ?? 0) - 1;
    while (before >= 0 && (code[before] === ' ' || code[before] === '\n')) before -= 1;
    if (before >= 0 && code[before] === '.') continue;
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

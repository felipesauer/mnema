/**
 * WHAT A PACKAGE PUBLISHES IS WHAT ITS PAGE PROMISES — asked of the tarball, not of the tree.
 *
 * WHERE THIS COMES FROM. Three of this workspace's four packages were `private: true` with no
 * `files` field at all, which meant nothing had ever decided what they would carry. Measured
 * on 22/09/2026, the moment `private` came off, `@mnema/chain` would have shipped 281 files:
 * seventeen `__pycache__/*.pyc` bytecode caches, forty-one `.test.ts` files, and a
 * `tsconfig.json` whose `extends` points two directories above the package and therefore
 * resolves to nothing. The root `.gitignore` names `__pycache__/` and `dist/`, and the packer
 * read NEITHER of them — it looks for an ignore file beside the manifest and does not walk up
 * to the workspace root. So "publish whatever is not ignored" was never the rule in force;
 * there was no rule in force.
 *
 * THE DECISION THIS GUARD HOLDS, and it is the one the delivery had to make. `@mnema/chain`
 * is the package that is AUDITED, not merely used: the root page sells it as *"the code you
 * have to trust for tamper-evidence is auditable on its own"*, and what makes that checkable
 * is not the TypeScript — it is `FORMAT.md`, the two published artifacts, and the independent
 * Python verifier written from the document. Copying `files: ["dist/"]` from `@mnema/code`
 * would have shipped the engine with none of them, which is a page promising what the
 * artifact does not carry. So the chain tarball carries them, and the case below RUNS the
 * verifier out of an extracted tarball — with nothing else beside it — because a list of
 * filenames proves the files are present and not that they are enough.
 *
 * `@mnema/core` and `@mnema/context` carry `dist/` and no more. They are published because
 * `@mnema/code` depends on them and a `workspace:*` that does not resolve is an install that
 * fails, not because anybody should read them. Their pages say so.
 *
 * THE INSTRUMENT IS `pnpm pack` AND THEN `tar`, AND BOTH HALVES OF THAT WERE MEASURED.
 *
 *   - `pnpm` AND NOT `npm`, because npm is not the packer that will publish this. `npm pack`
 *     leaves `workspace:*` raw in the manifest and the install dies with
 *     `EUNSUPPORTEDPROTOCOL`; `pnpm pack` rewrites each one to the concrete version. A guard
 *     that measured `npm pack` would be measuring an artifact nobody can install.
 *   - `tar` AND NOT THE PACKER'S OWN `--json`, because the report is not the tarball.
 *     Measured on `@mnema/context`: `pnpm pack --json` listed 107 files and the tarball held
 *     108. The extra one is `LICENSE`, which pnpm copies from the workspace root — so the one
 *     file that makes `"license": "Apache-2.0"` more than a word in a manifest is exactly the file
 *     neither report mentions. A guard reading the report would have sworn it was absent.
 *
 * WHAT IT DOES NOT CHECK. Whether a publish would be ACCEPTED: that needs the registry, an
 * account and a scope that does not exist yet, and this delivery deliberately publishes
 * nothing.
 *
 * THE SOURCE MAPS USED TO BE THE OTHER THING IT DID NOT CHECK, and this header said so as
 * declared debt: every package shipped `dist/**.js.map` and `dist/**.d.ts.map` whose
 * `sources` named `../src/*.ts` with no `sourcesContent`, so in an installed tree, where
 * `src/` does not travel, they resolved to nothing. Measured on 30/09/2026 out of the
 * tarballs: 76 such maps in `@mnema/chain`, 134 in `@mnema/core`, 52 in `@mnema/context` and
 * 380 in `@mnema/code`. The choice was between shipping `src/` and embedding the source in
 * the maps, and it was made for the second. `tsconfig.base.json` now sets `inlineSources`,
 * which the compiler honours for the maps of the emitted JavaScript and NOT for declaration
 * maps — measured with `tsc` 7.0.2, a `.d.ts.map` comes out with `sources` and no
 * `sourcesContent` whatever `inlineSources` says. A declaration map can therefore only point
 * at a `src/` the tarball does not carry, so `declarationMap` is off, and
 * {@link mapsWithoutTheirSource} below holds both halves: every map that travels carries the
 * text of every file it names, and no declaration map travels at all.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY PACKAGE OF THE WORKSPACE, ASKED OF GIT. `pnpm-workspace.yaml` says `packages/*`, and
 * a list typed here would stay at four while a fifth arrived carrying whatever the packer's
 * defaults decide — which is precisely the state this file was written to end.
 */
const MANIFESTS: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages/*/package.json'],
  { cwd: ROOT, encoding: 'utf-8' },
)
  .split('\n')
  .filter((where) => where !== '');

interface Manifest {
  readonly where: string;
  readonly dir: string;
  readonly name: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly files?: readonly string[];
  readonly publishConfig?: { readonly access?: string };
}

const readManifest = (where: string): Manifest => {
  const parsed = JSON.parse(readFileSync(join(ROOT, where), 'utf-8')) as Omit<
    Manifest,
    'where' | 'dir'
  >;
  return { ...parsed, where, dir: join(ROOT, where, '..') };
};

const ALL: readonly Manifest[] = MANIFESTS.map(readManifest);

/** The ones that would go to a registry: everything not held back by `private`. */
const PUBLISHABLE: readonly Manifest[] = ALL.filter((m) => m.private !== true);

/**
 * One sandbox of its own for the tarballs, destroyed when the file is done — never the work
 * tree, and never a directory another worker writes to.
 */
const SANDBOX = mkdtempSync(join(tmpdir(), 'mnema-tarballs-'));
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

/** Packs one package for real and returns where the tarball landed. */
function pack(dir: string): string {
  const said = execFileSync('pnpm', ['pack', '--json', '--pack-destination', SANDBOX], {
    cwd: dir,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(said) as { filename: string }).filename;
}

/** What is really inside a tarball, read off the archive. */
const contentsOf = (tarball: string): readonly string[] =>
  execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));

const TARBALLS: ReadonlyMap<string, string> = new Map(
  PUBLISHABLE.map((m) => [m.name, pack(m.dir)]),
);

const PACKED: ReadonlyMap<string, readonly string[]> = new Map(
  [...TARBALLS].map(([name, tarball]) => [name, contentsOf(tarball)]),
);

const carried = (name: string): readonly string[] => PACKED.get(name) ?? [];

describe('the workspace knows which packages it publishes', () => {
  it('finds five, and every one but the Action is meant to go', () => {
    // NON-VACUITY of everything below, which is a reduction over this list. Exact rather
    // than a floor: a floor is a number anyone can lower to swallow a package that stopped
    // being read. `@mnema/action` is the one that stays: it is `private`, runs from a
    // checkout and is published nowhere, so it is in the workspace and not in what travels.
    expect(ALL.map((m) => m.name).sort()).toEqual([
      '@mnema/action',
      '@mnema/chain',
      '@mnema/code',
      '@mnema/context',
      '@mnema/core',
    ]);
    expect(PUBLISHABLE.map((m) => m.name).sort()).toEqual([
      '@mnema/chain',
      '@mnema/code',
      '@mnema/context',
      '@mnema/core',
    ]);
    expect(ALL.filter((m) => m.private === true).map((m) => m.name)).toEqual(['@mnema/action']);
    expect(ALL.find((m) => m.name === '@mnema/action')?.license).toBe('Apache-2.0');
  });

  it('carries no `private` in a manifest that travels', () => {
    // THE FIELD TRAVELS INSIDE THE TARBALL. It is not a flag the packer consults and leaves
    // behind: the manifest is packed, so a `private: true` left in place is published and
    // then refused. Asserted as an absence of the key, not as `!== true`, because `false`
    // would be a second way of saying the same thing and a reader would have to know which.
    const held = PUBLISHABLE.filter((m) => 'private' in m).map((m) => m.where);
    expect(held).toEqual([]);
  });

  it('says out loud that a scoped package is public, because npm assumes otherwise', () => {
    // Every name here is under `@mnema/`, and a scoped package defaults to restricted. The
    // failure is not silent — the publish is refused — but it is refused for each package
    // separately, which is how three of four get published and one does not.
    const quiet = PUBLISHABLE.filter((m) => m.publishConfig?.access !== 'public').map(
      (m) => m.where,
    );
    expect(quiet).toEqual([]);
  });

  it('decides what it carries, rather than letting the packer decide', () => {
    // A package with no `files` publishes whatever the packer's defaults leave behind, and
    // this workspace measured what that is: bytecode caches, test files, and a
    // `tsconfig.json` that extends a path outside the tarball. The point is not which list —
    // it is that there is one.
    const undecided = PUBLISHABLE.filter((m) => !Array.isArray(m.files) || m.files.length === 0);
    expect(undecided.map((m) => m.where)).toEqual([]);
  });

  it('the manifest that travels declares the concrete version of every sibling it needs', () => {
    // THE REASON THE PACKER HAD TO BE `pnpm`. `workspace:*` is a workspace protocol and a
    // registry client refuses it outright — measured: `npm pack` leaves it raw and
    // `npm i -g` of that tarball dies with `EUNSUPPORTEDPROTOCOL` before the binary is ever
    // reached. What is asserted is its absence from the PACKED manifest, never from the one
    // on disk, where `workspace:*` is correct and has to stay.
    const raw: string[] = [];
    for (const [name, tarball] of TARBALLS) {
      const manifest = JSON.parse(
        execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf-8' }),
      ) as { dependencies?: Record<string, string> };
      for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
        if (range.startsWith('workspace:')) raw.push(`${name} needs ${dep}@${range}`);
      }
    }
    expect(raw).toEqual([]);
  });
});

describe('nothing travels that is a fact about this machine', () => {
  it('ships no Python bytecode cache', () => {
    const stray = [...PACKED].flatMap(([name, files]) =>
      files.filter((path) => path.includes('__pycache__')).map((path) => `${name}: ${path}`),
    );
    expect(stray).toEqual([]);
  });

  it('ships no test file', () => {
    const stray = [...PACKED].flatMap(([name, files]) =>
      files.filter((path) => /\.test\.[cm]?[jt]s$/.test(path)).map((path) => `${name}: ${path}`),
    );
    expect(stray).toEqual([]);
  });

  it('ships no `tsconfig.json`, whose `extends` would resolve to nothing', () => {
    // `packages/*/tsconfig.json` extends `../../tsconfig.base.json`, which is two levels
    // above the package and therefore outside every tarball. A config that cannot be read
    // is not a courtesy to an adopter; it is a file that fails when somebody tries it.
    const stray = [...PACKED].flatMap(([name, files]) =>
      files.filter((path) => path.endsWith('tsconfig.json')).map((path) => `${name}: ${path}`),
    );
    expect(stray).toEqual([]);
  });

  it('ships no incremental-build cache', () => {
    // `dist/.tsbuildinfo` is what `tsc -b` writes to know what it can skip next time, and
    // `files: ["dist/"]` carried it into all four tarballs — `@mnema/code` included, which
    // had had that `files` field since before this delivery. It is nobody's business but
    // this machine's, and an adopter who deleted it would notice nothing.
    const stray = [...PACKED].flatMap(([name, files]) =>
      files.filter((path) => path.endsWith('.tsbuildinfo')).map((path) => `${name}: ${path}`),
    );
    expect(stray).toEqual([]);
  });

  it('ships the built code in every one of them', () => {
    // NON-VACUITY, and it is not decorative: an unbuilt package packs no `dist/` at all, and
    // an empty list satisfies every case above.
    const empty = [...PACKED]
      .filter(([, files]) => !files.some((path) => path.startsWith('dist/')))
      .map(([name]) => name);
    expect(empty, 'a package packed no dist/ — is the workspace built?').toEqual([]);
  });
});

/**
 * What is wrong with the licence a set of packages declares and ships: a manifest that does
 * not say Apache-2.0, and a tarball without the `LICENSE` or the `NOTICE`. A function and not
 * inline assertions so the case below can hand it a fixture with ONE defect and watch it
 * name that one.
 */
function licenceDefects(
  manifests: readonly Pick<Manifest, 'name' | 'license'>[],
  packed: ReadonlyMap<string, readonly string[]>,
): string[] {
  const declared = manifests
    .filter((m) => m.license !== 'Apache-2.0')
    .map((m) => `${m.name}: declares ${m.license ?? 'no licence'}`);
  const shipped = [...packed].flatMap(([name, files]) =>
    ['LICENSE', 'NOTICE']
      .filter((file) => !files.includes(file))
      .map((file) => `${name}: ${file} does not travel`),
  );
  return [...declared, ...shipped];
}

describe('every package carries the licence its manifest claims', () => {
  it('declares one, and ships the text of it and the notice', () => {
    // `"license": "Apache-2.0"` in a manifest is a word; the file is the grant. LICENSE travels
    // because pnpm copies the workspace root's into each package, which npm does not do and
    // which neither packer's `--json` report mentions. NOTICE is not copied by anybody, so
    // each package carries its own and `files` names it; the Apache License asks that a
    // NOTICE which exists travels with the work. This case is the only thing in this
    // workspace that would notice if either stopped happening.
    expect(licenceDefects(PUBLISHABLE, PACKED)).toEqual([]);
  });

  it('holds the same licence and notice in a package that is never packed', () => {
    // `@mnema/action` is `private`, so no tarball is made of it and the cases above never see
    // it. It is still a directory of this repository that someone reads and copies, so what
    // the tarballs are held to is asked of its files directly: the manifest says Apache-2.0
    // and the NOTICE beside it is the root's, byte for byte.
    const notPacked = ALL.filter((m) => m.private === true);
    expect(notPacked.map((m) => m.name)).toEqual(['@mnema/action']);
    const root = readFileSync(join(ROOT, 'NOTICE'), 'utf-8');
    const defects = notPacked.flatMap((m) => [
      ...(m.license === 'Apache-2.0' ? [] : [`${m.name}: declares ${m.license ?? 'no licence'}`]),
      ...(readFileSync(join(m.dir, 'NOTICE'), 'utf-8') === root
        ? []
        : [`${m.name}: NOTICE is not the root's`]),
    ]);
    expect(defects).toEqual([]);
  });

  it('ships the root text, byte for byte, and not a copy that drifted', () => {
    // The copies of NOTICE are one file said once per package; the guard is that each equals
    // the root's. LICENSE is the official Apache-2.0 text, not edited.
    const root = (name: string) => readFileSync(join(ROOT, name), 'utf-8');
    expect(root('LICENSE')).toContain(
      'Apache License\n                           Version 2.0, January 2004',
    );
    expect(root('NOTICE')).toContain('Copyright 2026 Felipe Sauer');
    const drifted = [...TARBALLS].flatMap(([name, tarball]) =>
      ['LICENSE', 'NOTICE']
        .filter(
          (file) =>
            execFileSync('tar', ['-xOzf', tarball, `package/${file}`], { encoding: 'utf-8' }) !==
            root(file),
        )
        .map((file) => `${name}: ${file}`),
    );
    expect(drifted).toEqual([]);
  });
});

/**
 * EVERY SOURCE MAP THAT TRAVELS CARRIES THE SOURCE IT MAPS TO.
 *
 * A map is only worth shipping if a debugger in an installed tree can open what it names, and
 * the installed tree has no `src/`. So each map read out of a tarball must hold, for every
 * entry of `sources`, a `sourcesContent` string — and that string must be the repository's
 * file at that path, because an empty string or a stale copy satisfies a check
 * on the shape and leaves the debugger showing something other than what ran.
 *
 * Returns one line per defect, `<package>: <map> <what is wrong>`, so a red names the map.
 * `readMap` and `readSource` are parameters so the mutations below can hand it a map this
 * workspace no longer produces.
 */
function mapsWithoutTheirSource(
  name: string,
  maps: readonly string[],
  readMap: (path: string) => { sources?: unknown; sourcesContent?: unknown },
  readSource: (map: string, source: string) => string | undefined,
): string[] {
  const defects: string[] = [];
  for (const map of maps) {
    if (map.endsWith('.d.ts.map')) {
      defects.push(`${name}: ${map} is a declaration map, which the compiler cannot fill`);
      continue;
    }
    const { sources, sourcesContent } = readMap(map);
    if (!Array.isArray(sources) || sources.length === 0) {
      defects.push(`${name}: ${map} names no source`);
      continue;
    }
    if (!Array.isArray(sourcesContent) || sourcesContent.length !== sources.length) {
      defects.push(`${name}: ${map} does not carry the text of the ${sources.length} it names`);
      continue;
    }
    sources.forEach((source, at) => {
      const held = readSource(map, String(source));
      if (held === undefined) {
        defects.push(`${name}: ${map} names ${source}, which the repository does not hold`);
      } else if (sourcesContent[at] !== held) {
        defects.push(
          `${name}: ${map} carries a text for ${source} that is not the repository's file`,
        );
      }
    });
  }
  return defects;
}

/** Where each package's tarball is unpacked for the maps, apart from the chain's own run. */
const unpackedFor = (name: string): string => join(SANDBOX, 'maps', name.replace('/', '__'));

/** The repository's file a map in `<package dir>/dist/…` names, resolved from the map itself. */
const trackedSourceOf =
  (dir: string) =>
  (map: string, source: string): string | undefined => {
    try {
      return readFileSync(join(dir, map, '..', source), 'utf-8');
    } catch {
      return undefined;
    }
  };

describe('every source map that travels carries the source it maps to', () => {
  beforeAll(() => {
    for (const [name, tarball] of TARBALLS) {
      mkdirSync(unpackedFor(name), { recursive: true });
      execFileSync('tar', ['-xzf', tarball, '-C', unpackedFor(name)]);
    }
  }, 60_000);

  const mapsOf = (name: string): readonly string[] =>
    carried(name).filter((path) => path.endsWith('.map'));
  const readPacked =
    (name: string) =>
    (map: string): { sources?: unknown; sourcesContent?: unknown } =>
      JSON.parse(readFileSync(join(unpackedFor(name), 'package', map), 'utf-8'));

  it('finds maps in every package, or the case below passes over nothing', () => {
    // NON-VACUITY: `sourceMap` switched off would ship no map at all, and an empty list has
    // no map without its source.
    const none = PUBLISHABLE.filter((m) => mapsOf(m.name).length === 0).map((m) => m.name);
    expect(none).toEqual([]);
  });

  it('carries, in every map, the text of every file the map names, as the repository holds it', () => {
    const defects = PUBLISHABLE.flatMap((m) =>
      mapsWithoutTheirSource(m.name, mapsOf(m.name), readPacked(m.name), trackedSourceOf(m.dir)),
    );
    expect(defects).toEqual([]);
  });
});

/** What the proof engine has to carry for its page to be true. */
const AUDIT_ARTIFACTS = ['FORMAT.md', 'canonical-vectors.json', 'event-schema.json'] as const;

describe('the proof engine carries what makes it checkable', () => {
  const chain = () => carried('@mnema/chain');

  it('carries the document, the vectors and the declarations', () => {
    const missing = AUDIT_ARTIFACTS.filter((file) => !chain().includes(file));
    expect(missing).toEqual([]);
  });

  it('carries the second reader, all of it, and only its source', () => {
    // Against git rather than against a count: the verifier is twenty files today and the
    // number is not the promise — that every module the repository tracks is in the tarball
    // is.
    const tracked = execFileSync('git', ['ls-files', '--', 'packages/chain/verifier'], {
      cwd: ROOT,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.slice('packages/chain/'.length));
    expect(tracked.length).toBeGreaterThan(15);
    const missing = tracked.filter((path) => !chain().includes(path));
    expect(missing, 'the second reader travels incomplete').toEqual([]);
  });
});

/**
 * AND IT RUNS OUT OF THE TARBALL, which is the half a list of filenames cannot reach.
 *
 * The verifier resolves the vectors as `<its own directory>/../canonical-vectors.json`, so
 * what is being asked here is not only "are the files there" but "does the layout survive
 * packing". Extracted into the same sandbox with nothing of this workspace beside it: no
 * `node_modules`, no `src/`, no repository.
 */
describe('the second reader runs out of what the package publishes', () => {
  const unpacked = join(SANDBOX, 'extracted', 'package');

  beforeAll(() => {
    // NOT AT MODULE SCOPE, AND THE REASON IS A MEASURED ONE. This ran at collection, with
    // `TARBALLS.get('@mnema/chain') ?? ''` for the path — and a mutation that put
    // `private: true` back on the chain took it out of the packed set, so `tar` was handed
    // an empty path, threw during collection, and the whole FILE reported "no tests". The
    // defect was caught, loudly, but by a stack trace instead of by the case whose name says
    // what went wrong. A fallback that turns "the package is missing" into "tar got an empty
    // string" is a fallback that hides which of the two happened.
    const tarball = TARBALLS.get('@mnema/chain');
    if (tarball === undefined) {
      throw new Error('@mnema/chain was not packed — it is `private` again, or it is gone');
    }
    const into = join(SANDBOX, 'extracted');
    mkdirSync(into, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', into]);
  }, 60_000);

  it('extracted the package, and nothing of this workspace came with it', () => {
    // NON-VACUITY: a sandbox that failed to extract would leave the case below running the
    // repository's own verifier through a path that happened to resolve.
    expect(readdirSync(unpacked).sort()).toEqual([
      'FORMAT.md',
      'LICENSE',
      'NOTICE',
      'README.md',
      'canonical-vectors.json',
      'dist',
      'event-schema.json',
      'package.json',
      'verifier',
    ]);
  });

  it('checks the published vectors with nothing but the tarball', () => {
    const ran = execFileSync(
      'python3',
      [join(unpacked, 'verifier', 'mnema_verify.py'), 'vectors'],
      { encoding: 'utf-8', cwd: SANDBOX },
    );
    // The verdict and the failure count, not the whole transcript: the counts of `ok` and
    // `note` move when a kind is added, and a golden here would be a second copy of
    // `second-reader-agrees-on-the-bytes.test.ts`. `0 FAIL` is asserted beside the verdict
    // because a reader that broke out early can print a verdict over checks it never ran.
    expect(ran).toContain('VERDICT: VERIFIED');
    expect(ran).toMatch(/checks: \d+ ok, 0 FAIL, 0 UNCHECKED/);
    // It read the tarball's own copy of the artifact and not one it found elsewhere.
    expect(ran).toContain(join(unpacked, 'canonical-vectors.json'));
  }, 60_000);
});

/**
 * THE MUTATIONS THAT LIGHT IT. Applied to the packed LIST rather than to the manifests: a
 * guard whose non-vacuity proof rewrites four `package.json` files is a guard that can leave
 * them rewritten, and this workspace has already lost work to a restore that reverted more
 * than it took.
 */
describe('the guard is not vacuous', () => {
  const missingArtifacts = (files: readonly string[]): readonly string[] =>
    AUDIT_ARTIFACTS.filter((file) => !files.includes(file));
  const machineFacts = (files: readonly string[]): readonly string[] =>
    files.filter((path) => path.includes('__pycache__') || path.endsWith('.tsbuildinfo'));

  it('the tarball it is measured against is clean, or the mutations below prove nothing', () => {
    expect(missingArtifacts(carried('@mnema/chain'))).toEqual([]);
    expect(machineFacts(carried('@mnema/chain'))).toEqual([]);
  });

  it('reddens on the `files: ["dist/"]` that would have been copied from @mnema/code', () => {
    // The mutation that matters, because it is the one a reader of `@mnema/code`'s manifest
    // would make: the document, the vectors and the declarations all leave at once.
    const asIfCopied = carried('@mnema/chain').filter((path) => path.startsWith('dist/'));
    expect(missingArtifacts(asIfCopied)).toEqual([...AUDIT_ARTIFACTS]);
  });

  it('reddens when the second reader is dropped from what travels', () => {
    const present = carried('@mnema/chain').filter((path) => path.startsWith('verifier/'));
    const without = carried('@mnema/chain').filter((path) => !path.startsWith('verifier/'));
    expect(present.length).toBeGreaterThan(15);
    expect(present.filter((path) => !without.includes(path))).toHaveLength(present.length);
  });

  it('reddens on a bytecode cache and on a build cache, which the negations keep out', () => {
    const asIfUnfiltered = [
      ...carried('@mnema/chain'),
      'verifier/mnemaverify/__pycache__/framed.cpython-312.pyc',
      'dist/.tsbuildinfo',
    ];
    expect(machineFacts(asIfUnfiltered)).toEqual([
      'verifier/mnemaverify/__pycache__/framed.cpython-312.pyc',
      'dist/.tsbuildinfo',
    ]);
  });

  it('reddens on a map that names its source and does not carry it, as every map once did', () => {
    // The shape the compiler emits without `inlineSources`, byte for byte in the fields read.
    const bare = () => ({ sources: ['../src/index.ts'] });
    const source = () => 'export {};\n';
    expect(mapsWithoutTheirSource('m', ['dist/index.js.map'], bare, source)).toEqual([
      'm: dist/index.js.map does not carry the text of the 1 it names',
    ]);
  });

  it('reddens on a map whose text is not the file it names, which a shape check would pass', () => {
    const stale = () => ({ sources: ['../src/index.ts'], sourcesContent: ['export {};\n'] });
    const source = () => 'export const moved = 1;\n';
    expect(mapsWithoutTheirSource('m', ['dist/index.js.map'], stale, source)).toEqual([
      "m: dist/index.js.map carries a text for ../src/index.ts that is not the repository's file",
    ]);
  });

  it('reddens on a declaration map, which `inlineSources` leaves without its source', () => {
    const filled = () => ({ sources: ['../src/index.ts'], sourcesContent: ['export {};\n'] });
    const source = () => 'export {};\n';
    expect(mapsWithoutTheirSource('m', ['dist/index.d.ts.map'], filled, source)).toEqual([
      'm: dist/index.d.ts.map is a declaration map, which the compiler cannot fill',
    ]);
    // And the same map with its source, under the JavaScript name, is clean — so the red
    // above is the declaration map and not the fixture.
    expect(mapsWithoutTheirSource('m', ['dist/index.js.map'], filled, source)).toEqual([]);
  });

  it('reddens on a missing NOTICE, a missing LICENSE and a manifest that says MIT, each alone', () => {
    const good = [{ name: 'p', license: 'Apache-2.0' }];
    const all = ['LICENSE', 'NOTICE', 'package.json'];
    const packed = (files: readonly string[]) => new Map([['p', files]]);
    expect(licenceDefects(good, packed(all))).toEqual([]);
    expect(licenceDefects(good, packed(all.filter((f) => f !== 'NOTICE')))).toEqual([
      'p: NOTICE does not travel',
    ]);
    expect(licenceDefects(good, packed(all.filter((f) => f !== 'LICENSE')))).toEqual([
      'p: LICENSE does not travel',
    ]);
    expect(licenceDefects([{ name: 'p', license: 'MIT' }], packed(all))).toEqual([
      'p: declares MIT',
    ]);
  });
});

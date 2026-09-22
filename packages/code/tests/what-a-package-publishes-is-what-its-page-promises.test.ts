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
 * `@mnema/core` and `@mnema/copilot` carry `dist/` and no more. They are published because
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
 *     Measured on `@mnema/copilot`: `pnpm pack --json` listed 107 files and the tarball held
 *     108. The extra one is `LICENSE`, which pnpm copies from the workspace root — so the one
 *     file that makes `"license": "MIT"` more than a word in a manifest is exactly the file
 *     neither report mentions. A guard reading the report would have sworn it was absent.
 *
 * WHAT IT DOES NOT CHECK. Whether a publish would be ACCEPTED: that needs the registry, an
 * account and a scope that does not exist yet, and this delivery deliberately publishes
 * nothing. Nor the sourcemaps: every package ships `dist/**.js.map` and `dist/**.d.ts.map`
 * whose `sources` name `../src/*.ts` with no `sourcesContent`, so they resolve to nothing in
 * an installed tree — 72 of them in `@mnema/chain` alone. That is declared debt rather than a
 * silence here; it degrades a debugger, it breaks no promise a page makes, and fixing it is a
 * choice between shipping `src/` and dropping the maps that `@mnema/code` made before this
 * delivery existed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

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

/** One sandbox of its own for the tarballs (A6), destroyed when the file is done. */
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
  it('finds four, and every one of them is meant to go', () => {
    // NON-VACUITY of everything below, which is a reduction over this list. Exact rather
    // than a floor: a floor is a number anyone can lower to swallow a package that stopped
    // being read.
    expect(ALL.map((m) => m.name).sort()).toEqual([
      '@mnema/chain',
      '@mnema/code',
      '@mnema/copilot',
      '@mnema/core',
    ]);
    expect(PUBLISHABLE.map((m) => m.name).sort()).toEqual(ALL.map((m) => m.name).sort());
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

describe('every package carries the licence its manifest claims', () => {
  it('declares one, and ships the text of it', () => {
    // `"license": "MIT"` in a manifest is a word; the file is the grant. It travels because
    // pnpm copies the workspace root's `LICENSE` into each package — which npm does not do,
    // and which neither packer's `--json` report mentions. This case is the only thing in
    // this workspace that would notice if that stopped happening.
    const undeclared = PUBLISHABLE.filter((m) => m.license !== 'MIT').map((m) => m.where);
    expect(undeclared).toEqual([]);
    const missing = [...PACKED]
      .filter(([, files]) => !files.includes('LICENSE'))
      .map(([name]) => name);
    expect(missing).toEqual([]);
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
  const into = join(SANDBOX, 'extracted');
  mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xzf', TARBALLS.get('@mnema/chain') ?? '', '-C', into]);
  const unpacked = join(into, 'package');

  it('extracted the package, and nothing of this workspace came with it', () => {
    // NON-VACUITY: a sandbox that failed to extract would leave the case below running the
    // repository's own verifier through a path that happened to resolve.
    expect(readdirSync(unpacked).sort()).toEqual([
      'FORMAT.md',
      'LICENSE',
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
 * than it took (A14).
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

  it('reddens when the licence text stops travelling', () => {
    const without = carried('@mnema/chain').filter((path) => path !== 'LICENSE');
    expect(without.includes('LICENSE')).toBe(false);
    expect(carried('@mnema/chain').includes('LICENSE')).toBe(true);
  });
});

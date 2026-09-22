/**
 * WHAT A PACKAGE PUBLISHES IS WHAT ITS PAGE PROMISES — asked of the tarball, not of the tree.
 *
 * WHERE THIS COMES FROM. Three of this workspace's four packages were `private: true` with no
 * `files` field at all, which meant nothing had ever decided what they would carry. Measured
 * on 22/09/2026 with `npm pack --dry-run`, the moment `private` came off, `@mnema/chain`
 * would have shipped 281 files: seventeen `__pycache__/*.pyc` bytecode caches, forty-one
 * `.test.ts` files, and a `tsconfig.json` whose `extends` points two directories above the
 * package and therefore resolves to nothing. The root `.gitignore` names `__pycache__/` and
 * `dist/`, and npm read NEITHER of them — it looks for an ignore file beside the manifest and
 * does not walk up to the workspace root. So "publish whatever is not ignored" was never the
 * rule in force; there was no rule in force.
 *
 * THE DECISION THIS GUARD HOLDS, and it is the one the delivery had to make. `@mnema/chain`
 * is the package that is AUDITED, not merely used: the root page sells it as *"the code you
 * have to trust for tamper-evidence is auditable on its own"*, and what makes that checkable
 * is not the TypeScript — it is `FORMAT.md`, the two published artifacts, and the independent
 * Python verifier written from the document. Copying `files: ["dist/"]` from `@mnema/code`
 * would have shipped the engine with none of them, which is the #635 defect exactly: a page
 * promising what the artifact does not carry. So the chain tarball carries them, and the case
 * below RUNS the verifier out of an extracted tarball — with nothing else beside it — because
 * a list of filenames proves the files are present and not that they are enough.
 *
 * `@mnema/core` and `@mnema/copilot` carry `dist/` and no more. They are published because
 * `@mnema/code` depends on them and a `workspace:*` that does not resolve is an install that
 * fails, not because anybody should read them. Their pages say so.
 *
 * WHAT IT DOES NOT CHECK. Whether a publish would be ACCEPTED: that needs the registry, an
 * account and a scope that does not exist yet, and this delivery deliberately publishes
 * nothing. Nor the sourcemaps: every package ships `dist/**.js.map` and `dist/**.d.ts.map`
 * whose `sources` name `../src/*.ts` with no `sourcesContent`, so they resolve to nothing in
 * an installed tree — 72 of them in `@mnema/chain` alone. That is declared debt rather than a
 * silence here; it degrades a debugger, it breaks no promise a page makes, and fixing it is
 * a choice between shipping `src/` and dropping the maps that `@mnema/code` made before this
 * delivery existed.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * EVERY PACKAGE OF THE WORKSPACE, ASKED OF GIT. `pnpm-workspace.yaml` says `packages/*`, and
 * a list typed here would stay at four while a fifth arrived carrying whatever npm's defaults
 * decide — which is precisely the state this file was written to end.
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
  readonly files?: readonly string[];
  readonly publishConfig?: { readonly access?: string };
}

const read = (where: string): Manifest => {
  const parsed = JSON.parse(readFileSync(join(ROOT, where), 'utf-8')) as Omit<
    Manifest,
    'where' | 'dir'
  >;
  return { ...parsed, where, dir: join(ROOT, where, '..') };
};

const ALL: readonly Manifest[] = MANIFESTS.map(read);

/** The ones that would go to a registry: everything not held back by `private`. */
const PUBLISHABLE: readonly Manifest[] = ALL.filter((m) => m.private !== true);

/**
 * WHAT NPM WOULD PUT IN THE TARBALL, asked of npm.
 *
 * `--dry-run` writes nothing and reaches no registry; it applies npm's own packing rule to the
 * directory. Re-deriving that rule here — `files` as an allowlist, the always-included
 * manifest and README, the ignore files npm does and does not read — would be a second
 * implementation of the one thing this guard exists to observe, and the second implementation
 * is what would be wrong.
 */
function packs(dir: string): readonly string[] {
  const said = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const [report] = JSON.parse(said) as [{ files: { path: string }[] }];
  return (report?.files ?? []).map((file) => file.path);
}

const PACKED: ReadonlyMap<string, readonly string[]> = new Map(
  PUBLISHABLE.map((m) => [m.name, packs(m.dir)]),
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
    // THE FIELD TRAVELS INSIDE THE TARBALL. It is not a flag npm consults and leaves behind:
    // the manifest is packed verbatim, so a `private: true` left in place is published and
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

  it('decides what it carries, rather than letting npm decide', () => {
    // A package with no `files` publishes whatever npm's defaults leave behind, and this
    // workspace measured what that is: bytecode caches, test files, and a `tsconfig.json`
    // that extends a path outside the tarball. The point is not which list — it is that
    // there is one.
    const undecided = PUBLISHABLE.filter((m) => !Array.isArray(m.files) || m.files.length === 0);
    expect(undecided.map((m) => m.where)).toEqual([]);
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

  it('ships the built code in every one of them', () => {
    // NON-VACUITY, and it is not decorative: `packs` returns an empty list for a package
    // whose `dist/` has not been built, and an empty list satisfies all three cases above.
    const empty = [...PACKED]
      .filter(([, files]) => !files.some((path) => path.startsWith('dist/')))
      .map(([name]) => name);
    expect(empty, 'a package packed no dist/ — is the workspace built?').toEqual([]);
  });
});

/**
 * WHAT THE PROOF ENGINE HAS TO CARRY FOR ITS PAGE TO BE TRUE — the artifacts by name, read
 * off the manifest modules that resolve them rather than typed here twice.
 */
const AUDIT_ARTIFACTS = ['FORMAT.md', 'canonical-vectors.json', 'event-schema.json'] as const;

describe('the proof engine carries what makes it checkable', () => {
  const chain = () => carried('@mnema/chain');

  it('carries the document, the vectors and the declarations', () => {
    const missing = AUDIT_ARTIFACTS.filter((file) => !chain().includes(file));
    expect(missing).toEqual([]);
  });

  it('carries the second reader, all of it, and only its source', () => {
    // Against git rather than against a count: the verifier is twenty files today and the
    // number is not the promise — that every module the package tracks is in the tarball is.
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
 * packing". Extracted into a sandbox of its own (A6) with nothing of this workspace beside
 * it: no `node_modules`, no `src/`, no repository.
 */
describe('the second reader runs out of what the package publishes', () => {
  let sandbox: string;
  let unpacked: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-chain-tarball-'));
    const said = execFileSync('npm', ['pack', '--json', '--pack-destination', sandbox], {
      cwd: join(ROOT, 'packages/chain'),
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [made] = JSON.parse(said) as [{ filename: string }];
    execFileSync('tar', ['-xzf', join(sandbox, made?.filename ?? ''), '-C', sandbox]);
    unpacked = join(sandbox, 'package');
  }, 120_000);

  afterAll(() => {
    if (sandbox !== undefined) rmSync(sandbox, { recursive: true, force: true });
  });

  it('extracted the package, and nothing of this workspace came with it', () => {
    // NON-VACUITY: a sandbox that failed to extract would leave the case below running the
    // repository's own verifier through a path that happened to resolve.
    expect(readdirSync(unpacked).sort()).toEqual([
      'FORMAT.md',
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
      { encoding: 'utf-8', cwd: sandbox },
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
  const pycache = (files: readonly string[]): readonly string[] =>
    files.filter((path) => path.includes('__pycache__'));

  it('the tarball it is measured against is clean, or the mutations below prove nothing', () => {
    expect(missingArtifacts(carried('@mnema/chain'))).toEqual([]);
    expect(pycache(carried('@mnema/chain'))).toEqual([]);
  });

  it('reddens on the `files: ["dist/"]` that would have been copied from @mnema/code', () => {
    // The mutation that matters, because it is the one a reader of `@mnema/code`'s manifest
    // would make: the document, the vectors and the declarations all leave at once.
    const asIfCopied = carried('@mnema/chain').filter((path) => path.startsWith('dist/'));
    expect(missingArtifacts(asIfCopied)).toEqual([...AUDIT_ARTIFACTS]);
  });

  it('reddens when the second reader is dropped from what travels', () => {
    const without = carried('@mnema/chain').filter((path) => !path.startsWith('verifier/'));
    const tracked = carried('@mnema/chain').filter((path) => path.startsWith('verifier/'));
    expect(tracked.length).toBeGreaterThan(15);
    expect(tracked.filter((path) => !without.includes(path))).toHaveLength(tracked.length);
  });

  it('reddens on a bytecode cache, which is what `!verifier/**/__pycache__` keeps out', () => {
    const asIfUnfiltered = [
      ...carried('@mnema/chain'),
      'verifier/mnemaverify/__pycache__/framed.cpython-312.pyc',
    ];
    expect(pycache(asIfUnfiltered)).toHaveLength(1);
  });
});

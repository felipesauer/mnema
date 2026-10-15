/**
 * THE INSTALL IS WRITTEN ONCE. Until the packages are on npm, `npm i -g @mnema/code` answers 404,
 * and the install is from the source: the block of `docs/install.md` builds the workspace, packs the
 * five publishable packages and installs the tarballs together, the steps
 * `.github/the-packed-install/run.sh` proves on every push to `main`. `mnema doctor`, the plugin's
 * hand-over hook and the README's quick start say how to install too; none of them spells another
 * install. They give the address of that page and nothing else, so a second spelling (a release URL
 * for a tag that does not exist, a list of tarballs that grew a package) cannot go stale beside it.
 *
 * `docs/install.md` is the source: its package list is held to the packages that are not private, and
 * each of the other places must point at the page and carry no release URL.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE_URL = 'https://github.com/felipesauer/mnema/blob/main/docs/install.md';
const RELEASE_URL = /releases\/download|\.tgz/;

const page = readFileSync(join(REPO, 'docs', 'install.md'), 'utf-8');

/** The `sh` block of the page's binary section: the one that installs the packed tarballs. */
const BLOCK =
  [...page.matchAll(/```sh\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? '')
    .find((b) => b.includes('pnpm pack')) ?? '';

/** The packages of `packages/*` that are not private, as the install of the CI picks them. */
const PUBLISHABLE = readdirSync(join(REPO, 'packages'))
  .filter((dir) => {
    try {
      const manifest = JSON.parse(
        readFileSync(join(REPO, 'packages', dir, 'package.json'), 'utf-8'),
      );
      return manifest.private !== true;
    } catch {
      return false;
    }
  })
  .sort();

describe('the install from the source', () => {
  it('is one block on the page that builds, packs the publishable packages and installs the tarballs together', () => {
    expect(BLOCK).toContain('git clone https://github.com/felipesauer/mnema.git');
    expect(BLOCK).toContain('pnpm install --frozen-lockfile');
    expect(BLOCK).toContain('pnpm build');
    expect(BLOCK).toContain('npm i -g --prefix ~/.local "$dest"/*.tgz');
    expect(BLOCK).toContain('corepack enable --install-directory ~/.local/bin');
    expect(BLOCK).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(page).not.toMatch(/releases\/download/);
  });

  it('makes the shim directory and puts it on the PATH before the first pnpm runs', () => {
    const at = (needle: string): number => BLOCK.indexOf(needle);
    const bin = '$HOME/.local/bin';
    // `corepack enable --install-directory` does not create the directory: it stops on ENOENT
    expect(at(`mkdir -p "${bin}"`)).toBeGreaterThanOrEqual(0);
    expect(at(`export PATH="${bin}:$PATH"`)).toBeGreaterThanOrEqual(0);
    const firstPnpm = BLOCK.search(/\bpnpm /);
    expect(firstPnpm).toBeGreaterThan(0);
    // where pnpm exists only as that shim, a pnpm run before the export is `command not found`
    expect(at(`mkdir -p "${bin}"`)).toBeLessThan(at('corepack enable'));
    expect(at(`export PATH="${bin}:$PATH"`)).toBeLessThan(at('corepack enable'));
    expect(at('corepack enable')).toBeLessThan(firstPnpm);
  });

  it('packs every package that is not private, the dependencies first and `code` last', () => {
    const loop = BLOCK.match(/for p in ([^;]+); do/)?.[1]?.split(' ') ?? [];
    expect([...loop].sort()).toEqual(PUBLISHABLE);
    expect(PUBLISHABLE).toHaveLength(5);
    expect(loop.at(-1)).toBe('code');
    // the CI's own install packs the same set, so the page and the proof cannot part ways
    const proof = readFileSync(join(REPO, '.github', 'the-packed-install', 'run.sh'), 'utf-8');
    expect(proof).toContain('pnpm pack --pack-destination');
    expect(proof).toContain('npm i -g --prefix "$prefix"');
  });

  it('is not spelled by the README, which points at the page', () => {
    const readme = readFileSync(join(REPO, 'README.md'), 'utf-8');
    expect(readme).toContain('the exact lines are in docs/install.md');
    expect(readme).not.toMatch(RELEASE_URL);
    expect(readme).not.toMatch(/releases\/tag|\/releases"/);
  });

  it('is not spelled by the package README either', () => {
    const readme = readFileSync(join(REPO, 'packages', 'code', 'README.md'), 'utf-8');
    expect(readme).toContain('(../../docs/install.md)');
    expect(readme).not.toMatch(RELEASE_URL);
  });

  it('is what `mnema doctor` points at when there is no mnema on the PATH', () => {
    const report = runDoctor({
      cwd: REPO,
      env: { home: join(REPO, 'no-home') },
      processEnv: { PATH: '' },
      running: { file: join(REPO, 'no-such-mnema'), version: '0.0.0' },
    });
    const line = report.findings.find((one) => one.topic === 'binary')?.line ?? '';
    expect(line).toContain(PAGE_URL);
    expect(line).toContain('nothing is on npm yet');
    expect(line).not.toMatch(RELEASE_URL);
  });

  it('is what the plugin points at when the mnema on the PATH is another program', async () => {
    const { aStranger } = (await import(
      pathToFileURL(join(REPO, 'plugin', 'hooks', 'hand-over.mjs')).href
    )) as { aStranger: (stranger: { said: string; status: number | null }) => string };
    const text = aStranger({ said: 'hello', status: 0 });
    expect(text).toContain(PAGE_URL);
    expect(text).toContain('nothing is on npm yet');
    expect(text).not.toMatch(RELEASE_URL);
  });
});

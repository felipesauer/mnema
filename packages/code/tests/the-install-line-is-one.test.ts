// @reads-the-tree
/**
 * THE INSTALL LINE IS WRITTEN ONCE, AND IT IS THE NPM LINE. `docs/install.md` is the source: its first
 * `sh` block is `npm i -g @mnema/code`. `mnema doctor`, the plugin's hand-over hook, the README's quick
 * start and the package README say the same line, and none of them says the package is missing from the
 * registry, that the install answers 404, or that it is built from the source: a second spelling, or a
 * sentence from the days before the first publication, is a sentence that is wrong beside the page.
 * Running the `main` branch instead is the business of `docs/build-from-source.md`, which the install page
 * points at; the steps `.github/the-packed-install/run.sh` proves on every push to `main` are the ones
 * that page packs.
 *
 * The five published packages are held to the `packages/*` that are not private, and each one's README
 * carries the badge that shows the version npm serves.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PAGE_URL = 'https://github.com/felipesauer/mnema/blob/main/docs/install.md';
const INSTALL_LINE = 'npm i -g @mnema/code';
const RELEASE_URL = /releases\/download|\.tgz/;
/** What the pages said while nothing was on npm, in every spelling the repository used. */
const NOT_ON_NPM =
  /nothing is on npm|not on npm yet|is not on npm|answers 404|a 404 means|until the (first )?publication|built from the source|build it from the source|build from the source/i;

const read = (...parts: string[]): string => readFileSync(join(REPO, ...parts), 'utf-8');

const page = read('docs', 'install.md');
const buildPage = read('docs', 'build-from-source.md');

/** The first `sh` block of the page: the install. */
const FIRST_BLOCK = [...page.matchAll(/```sh\n([\s\S]*?)```/g)][0]?.[1] ?? '';

/** The packages of `packages/*` that are not private, as the install of the CI picks them. */
const PUBLISHABLE = readdirSync(join(REPO, 'packages'))
  .filter((dir) => {
    try {
      const manifest = JSON.parse(read('packages', dir, 'package.json'));
      return manifest.private !== true;
    } catch {
      return false;
    }
  })
  .sort();

describe('the install line', () => {
  it('is the first block of the install page, and the page never says nothing is on npm', () => {
    expect(FIRST_BLOCK.trim()).toBe(INSTALL_LINE);
    expect(page).toContain('npm i -g --prefix ~/.local @mnema/code');
    expect(page).not.toMatch(NOT_ON_NPM);
    expect(page).not.toMatch(RELEASE_URL);
  });

  it('is the line of the README quick start, and the README says nothing of 404 or the source', () => {
    const readme = read('README.md');
    const quick = readme.slice(readme.indexOf('## Quick start'), readme.indexOf('## How it works'));
    expect(quick).toContain(`${INSTALL_LINE} `);
    expect(readme).not.toMatch(NOT_ON_NPM);
    expect(readme).not.toMatch(RELEASE_URL);
    expect(readme).not.toMatch(/releases\/tag|\/releases"/);
    expect(readme).toContain('(docs/build-from-source.md)');
  });

  it('is the line of every published package page', () => {
    expect(PUBLISHABLE).toHaveLength(5);
    for (const dir of PUBLISHABLE) {
      const readme = read('packages', dir, 'README.md');
      expect(readme, dir).not.toMatch(NOT_ON_NPM);
      expect(readme, dir).not.toMatch(RELEASE_URL);
      expect(readme, dir).toContain(`https://img.shields.io/npm/v/@mnema/${dir}?`);
      expect(readme, dir).toContain(`https://www.npmjs.com/package/@mnema/${dir}`);
    }
    expect(read('packages', 'code', 'README.md')).toContain(`\`\`\`sh\n${INSTALL_LINE}\n\`\`\``);
    expect(read('docs', 'cli-reference.md')).not.toMatch(NOT_ON_NPM);
    expect(read('plugin', 'README.md')).not.toMatch(NOT_ON_NPM);
    expect(read('SECURITY.md')).not.toMatch(NOT_ON_NPM);
  });

  it('leaves the build from the source to its own page, which packs the publishable packages', () => {
    expect(page).toContain('(build-from-source.md)');
    expect(buildPage).toContain('git clone https://github.com/felipesauer/mnema.git');
    expect(buildPage).toContain('pnpm install --frozen-lockfile');
    expect(buildPage).toContain('npm i -g --prefix ~/.local "$dest"/*.tgz');
    const loop = buildPage.match(/for p in ([^;]+); do/)?.[1]?.split(' ') ?? [];
    expect([...loop].sort()).toEqual(PUBLISHABLE);
    expect(loop.at(-1)).toBe('code');
    const proof = read('.github', 'the-packed-install', 'run.sh');
    expect(proof).toContain('pnpm pack --pack-destination');
    expect(proof).toContain('npm i -g --prefix "$prefix"');
  });

  it('is what `mnema doctor` says when there is no mnema on the PATH', () => {
    const report = runDoctor({
      cwd: REPO,
      env: { home: join(REPO, 'no-home') },
      processEnv: { PATH: '' },
      running: { file: join(REPO, 'no-such-mnema'), version: '0.0.0' },
    });
    const line = report.findings.find((one) => one.topic === 'binary')?.line ?? '';
    expect(line).toContain(INSTALL_LINE);
    expect(line).toContain(PAGE_URL);
    expect(line).not.toMatch(NOT_ON_NPM);
    expect(line).not.toMatch(RELEASE_URL);
  });

  it('is what the plugin says when the mnema on the PATH is another program', async () => {
    const { aStranger } = (await import(
      pathToFileURL(join(REPO, 'plugin', 'hooks', 'hand-over.mjs')).href
    )) as { aStranger: (stranger: { said: string; status: number | null }) => string };
    const text = aStranger({ said: 'hello', status: 0 });
    expect(text).toContain(INSTALL_LINE);
    expect(text).toContain(PAGE_URL);
    expect(text).not.toMatch(NOT_ON_NPM);
    expect(text).not.toMatch(RELEASE_URL);
  });
});

/**
 * THE INSTALL LINE IS ONE. Until the packages are published, `npm i -g @mnema/code` answers 404,
 * and `docs/install.md` gives the install of the pre-release from the four tarballs of its GitHub
 * release. `mnema doctor` and the plugin's hand-over hook say how to install too; a third
 * spelling of the line would send a person to a URL that page does not give.
 *
 * `docs/install.md` is the source: its four URLs are read off the page and each of the other two must
 * carry exactly those, in that order.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { VERSION } from '../src/version.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TARBALL = /https:\/\/github\.com\/felipesauer\/mnema\/releases\/download\/[^\s\\]+\.tgz/g;

/** The four URLs of the install block of `docs/install.md`. */
const README_URLS = (
  readFileSync(join(REPO, 'docs', 'install.md'), 'utf-8').match(TARBALL) ?? []
).slice(0, 4);

describe('the install of the pre-release', () => {
  it('is four tarballs on the page, chain first and code last', () => {
    expect(README_URLS).toHaveLength(4);
    expect(README_URLS.map((url) => url.split('/').pop())).toEqual([
      expect.stringMatching(/^mnema-chain-/),
      expect.stringMatching(/^mnema-core-/),
      expect.stringMatching(/^mnema-context-/),
      expect.stringMatching(/^mnema-code-/),
    ]);
  });

  it('names the version of the package, in the page, in the doctor and in the hook', () => {
    expect(
      README_URLS.every((url) => url.includes(`/v${VERSION}/`) && url.endsWith(`-${VERSION}.tgz`)),
    ).toBe(true);
    expect(readFileSync(join(REPO, 'plugin', 'hooks', 'hand-over.mjs'), 'utf-8')).toContain(
      `const PRERELEASE = '${VERSION}';`,
    );
  });

  it('is what `mnema doctor` says when there is no mnema on the PATH', () => {
    const report = runDoctor({
      cwd: REPO,
      env: { home: join(REPO, 'no-home') },
      processEnv: { PATH: '' },
      running: { file: join(REPO, 'no-such-mnema'), version: '0.0.0' },
    });
    const line = report.findings.find((one) => one.topic === 'binary')?.line ?? '';
    expect(line.match(TARBALL)).toEqual(README_URLS);
    expect(line).toContain('npm i -g https://');
  });

  it('is what the plugin says when the mnema on the PATH is another program', async () => {
    const { aStranger } = (await import(
      pathToFileURL(join(REPO, 'plugin', 'hooks', 'hand-over.mjs')).href
    )) as { aStranger: (stranger: { said: string; status: number | null }) => string };
    const text = aStranger({ said: 'hello', status: 0 });
    expect(text.match(TARBALL)).toEqual(README_URLS);
    expect(text).toContain('npm i -g https://');
  });
});

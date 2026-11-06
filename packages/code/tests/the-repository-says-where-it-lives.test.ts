// @reads-the-tree
/**
 * THE REPOSITORY SAYS WHERE IT LIVES, AND SAYS IT ONCE. The repository is `mnema-work/mnema` and the site is
 * `https://mnema.work`. The old owner's address (`felipesauer/mnema`), the old Pages address
 * (`felipesauer.github.io`) and the old MCP Registry name (`io.github.felipesauer`) are in no tracked file but the few
 * that are history, each named below with its reason. An address that redirects still works for a reader, but it is an
 * address that says nothing is looked after, and a manifest, an install line or a link that prints it sends a stranger
 * through a redirect for as long as the redirect stands.
 *
 *   - `@felipesauer/mnema`, the deprecated 0.x alpha, is a package name and not an address: it is never a finding.
 *   - The marketplace is still named `mnema`, so `mnema@mnema`, the id of the plugin an installed user has, did not change.
 *
 * To see it red, put an old install line back in `docs/install.md`: the case names the file and the line.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** What the old owner's name makes of an address. A package scope (`@felipesauer/mnema`) is not one of them. */
const OLD = /(?<![@\w.-])felipesauer\/mnema|felipesauer\.github\.io|io\.github\.felipesauer/;

/** The tracked files that may hold an old address, and why. A directory is a prefix that ends in `/`. */
const HISTORY: Readonly<Record<string, string>> = {
  '.mnema/':
    'the record: signed, append-only events and tails, which say what was true on the day they were written',
  'measurements/':
    'the measurements were pre-registered and published at the old address, and their files are frozen by hash: they cite where they were published',
  'CHANGELOG.md':
    'the entries of past versions name the address of their day, and the alpha it points to lives at a commit of the old line',
  'packages/code/tests/the-repository-says-where-it-lives.test.ts':
    'this file names the patterns it forbids',
};

const allowed = (path: string): string | undefined =>
  Object.entries(HISTORY).find(([entry]) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry,
  )?.[0];

/** Every old address in `files`, as `path:line`, leaving out the files that are history. */
function findings(files: ReadonlyArray<{ path: string; text: string }>): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    if (allowed(path) !== undefined) continue;
    text.split('\n').forEach((line, index) => {
      if (OLD.test(line)) found.push(`${path}:${index + 1}`);
    });
  }
  return found;
}

/** The tracked text files of the repository, as git lists them and the disk holds them. */
function tracked(): Array<{ path: string; text: string }> {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const files: Array<{ path: string; text: string }> = [];
  for (const path of listed) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(join(REPO, path));
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;
    files.push({ path, text: buffer.toString('utf8') });
  }
  return files;
}

describe('where the repository says it lives', () => {
  const files = tracked();

  it('is the organization and its domain: no tracked file outside the history prints the old owner, the old Pages address or the old registry name', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(findings(files)).toEqual([]);
  });

  it('keeps each file it lets through honest: every entry of the list still holds an old address, or it is taken off', () => {
    for (const entry of Object.keys(HISTORY)) {
      const holds = files.some(({ path, text }) => allowed(path) === entry && OLD.test(text));
      expect(holds, `${entry} is on the list of history and holds no old address`).toBe(true);
    }
  });

  it('turns red, naming the file and the line, for the old install line put back in a page', () => {
    const page = files.find(({ path }) => path === 'docs/install.md');
    expect(page).toBeDefined();
    const text = (page?.text ?? '').split('\n');
    const at = text.findIndex((line) =>
      line.includes('claude plugin marketplace add mnema-work/mnema'),
    );
    expect(at).toBeGreaterThan(-1);
    text[at] = (text[at] ?? '').replace('mnema-work/mnema', 'felipesauer/mnema');
    expect(findings([{ path: 'docs/install.md', text: text.join('\n') }])).toEqual([
      `docs/install.md:${at + 1}`,
    ]);
  });

  it('does not take the deprecated package for an address', () => {
    expect(
      findings([{ path: 'SECURITY.md', text: '`npm view @felipesauer/mnema deprecated`' }]),
    ).toEqual([]);
  });

  it('did not rename what an installed user has: the marketplace is still `mnema`, so the plugin is still `mnema@mnema`', () => {
    const marketplace = JSON.parse(
      readFileSync(join(REPO, '.claude-plugin/marketplace.json'), 'utf8'),
    ) as {
      name: string;
      owner: { name: string; url: string };
      plugins: Array<{ name: string }>;
    };
    expect(marketplace.name).toBe('mnema');
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual([
      'mnema',
      'mnema-server-only',
    ]);
    expect(marketplace.owner).toEqual({ name: 'Mnema', url: 'https://github.com/mnema-work' });
    const install = readFileSync(join(REPO, 'docs/install.md'), 'utf8');
    expect(install).toContain(
      'claude plugin marketplace add mnema-work/mnema`, then `claude plugin install mnema@mnema`',
    );
  });
});

/**
 * The key root ignores itself in git — asked of git, not of the file's contents.
 *
 * The key root lives in the home, and a home kept under git is a repository: without this, `git add
 * .mnema` stages the machine's private key and its cold backup. Each case below writes key material
 * the way the product does and asks `git check-ignore` about the files it produced.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureBackupKey } from './backup.js';
import { deriveAnchor, generateKeyPair } from './keys.js';
import { ensureKeyRootIgnored, loadOrCreateKeyPair } from './keystore.js';

let home: string;
/** A key root inside a home that is itself a repository — the dotfiles case. */
let keyRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mnema-keystore-home-'));
  keyRoot = join(home, '.mnema', 'identity');
  const init = spawnSync('git', ['init', '-q'], { cwd: home });
  expect(init.status, String(init.stderr)).toBe(0);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Every file under the key root, relative to the home. */
function filesOfTheKeyRoot(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(home, path));
    }
  };
  walk(keyRoot);
  return out;
}

/** The files git would stage, of `paths` — the ones `check-ignore` does not claim. */
function notIgnored(paths: readonly string[]): string[] {
  return paths.filter(
    (path) => spawnSync('git', ['check-ignore', '-q', path], { cwd: home }).status !== 0,
  );
}

describe('the key root ignores itself in git', () => {
  it('from the moment a key is minted into it — the key, its public half, and the file itself', () => {
    const minted = loadOrCreateKeyPair({ root: keyRoot });
    const files = filesOfTheKeyRoot();
    expect(files).toContain(join('.mnema', 'identity', 'keys', `${minted.fingerprint}.key`));
    expect(notIgnored(files)).toEqual([]);
  });

  it('and for the cold backup, written before any key is', () => {
    const backup = ensureBackupKey({ root: keyRoot }, deriveAnchor(generateKeyPair().fingerprint));
    expect(backup?.created).toBe(true);
    const files = filesOfTheKeyRoot();
    expect(files.some((path) => path.includes('backup'))).toBe(true);
    expect(notIgnored(files)).toEqual([]);
  });

  it('leaves a `.gitignore` that is already there as it was — a person who edited it keeps the edit', () => {
    ensureKeyRootIgnored({ root: keyRoot });
    const theirs = '# mine\n*.key\n';
    writeFileSync(join(keyRoot, '.gitignore'), theirs);
    loadOrCreateKeyPair({ root: keyRoot });
    expect(readFileSync(join(keyRoot, '.gitignore'), 'utf-8')).toBe(theirs);
  });

  it('is asked of a directory git would otherwise stage — the case is not vacuous', () => {
    // Beside the key root, in the same repository, a file nothing ignores is staged: the
    // repository is live, and `check-ignore` says no when the answer is no.
    writeFileSync(join(home, 'a-dotfile'), 'x');
    expect(notIgnored(['a-dotfile'])).toEqual(['a-dotfile']);
  });
});

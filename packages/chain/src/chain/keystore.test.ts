/**
 * The key root ignores itself in git — asked of git, not of the file's contents.
 *
 * The key root lives in the home, and a home kept under git is a repository: without this, `git add
 * .mnema` stages the machine's private key and its cold backup. Each case below writes key material
 * the way the product does and asks `git check-ignore` about the files it produced.
 */

import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureBackupKey } from './backup.js';
import { deriveAnchor, generateKeyPair, privateKeyToPem, publicKeyToPem } from './keys.js';
import {
  ensureKeyRootIgnored,
  listAnchoredFingerprints,
  listPrivateKeyFingerprints,
  loadOrCreateKeyPair,
  persistKeyPair,
  writeAnchor,
} from './keystore.js';
import { keyRootLockPath, keysDir, privateKeyPath, publicKeyPath } from './layout.js';

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

describe('listAnchoredFingerprints — which keys have settled whom they speak for in a tree', () => {
  it('lists the keys with a local anchor, sorted, and nothing else in keys/', () => {
    const tree = { root: join(home, 'tree') };
    const [one, two] = [generateKeyPair().fingerprint, generateKeyPair().fingerprint];
    writeAnchor(tree, two, deriveAnchor(two));
    writeAnchor(tree, one, deriveAnchor(one));
    writeFileSync(join(tree.root, 'keys', `${one}.pub`), 'not an anchor');
    expect(listAnchoredFingerprints(tree)).toEqual([one, two].sort());
  });

  it('is empty for a tree with no keys directory — or no tree at all', () => {
    expect(listAnchoredFingerprints({ root: join(home, 'nothing-here') })).toEqual([]);
  });
});

/**
 * Two first writes in a new home make ONE key.
 *
 * Not a race, for the reason `tail-lock.test.ts` gives: what the race produces is a state, and
 * the case plants it — a process that found no key arriving at the mint while another process
 * holds the key root's lock and mints. The other process is a thread here: it holds the lock
 * (a record naming this live process, so nobody breaks it), writes its key the way the product
 * does, and lets go. Rounds with two processes released at one instant are a measurement, not
 * a case, and live with the delivery that measured them.
 */
describe('the first key of a machine is minted once', () => {
  it('a mint that found no key, arriving while another process mints, adopts that key', async () => {
    const layout = { root: keyRoot };
    ensureKeyRootIgnored(layout);
    const lock = keyRootLockPath(layout);
    writeFileSync(lock, `${process.pid} ${Date.now()}\n`);
    const theirs = generateKeyPair();
    const other = new Worker(
      "const { mkdirSync, writeFileSync, renameSync, unlinkSync } = require('node:fs');" +
        "const { workerData: w } = require('node:worker_threads');" +
        'setTimeout(() => {' +
        '  mkdirSync(w.keys, { recursive: true });' +
        '  writeFileSync(w.pub, w.publicPem);' +
        "  writeFileSync(w.priv + '.aside', w.privatePem, { mode: 0o600 });" +
        "  renameSync(w.priv + '.aside', w.priv);" +
        '  unlinkSync(w.lock);' +
        '}, 150);',
      {
        eval: true,
        workerData: {
          keys: keysDir(layout),
          pub: publicKeyPath(layout, theirs.fingerprint),
          priv: privateKeyPath(layout, theirs.fingerprint),
          publicPem: publicKeyToPem(theirs.publicKey),
          privatePem: privateKeyToPem(theirs.privateKey),
          lock,
        },
      },
    );
    const ours = loadOrCreateKeyPair(layout);
    await once(other, 'exit');
    expect(ours.fingerprint).toBe(theirs.fingerprint);
    expect(listPrivateKeyFingerprints(layout)).toEqual([theirs.fingerprint]);
    expect(existsSync(lock)).toBe(false);
  });

  it('a key root that holds a key is read without the lock', () => {
    // A lock nobody will ever release, held by a live process: a read that took it would wait
    // the whole budget out and refuse. The lock is paid once per machine, not once per write.
    const layout = { root: keyRoot };
    const mine = loadOrCreateKeyPair(layout);
    writeFileSync(keyRootLockPath(layout), `${process.pid} ${Date.now()}\n`);
    const started = Date.now();
    expect(loadOrCreateKeyPair(layout).fingerprint).toBe(mine.fingerprint);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('writes the private half aside and names it whole — no aside is left, and none is a key', () => {
    const layout = { root: keyRoot };
    const pair = generateKeyPair();
    persistKeyPair(layout, pair);
    expect(readdirSync(keysDir(layout)).sort()).toEqual(
      [`${pair.fingerprint}.key`, `${pair.fingerprint}.pub`].sort(),
    );
    // What a reader finds while another process is writing: the aside, under a name a listing
    // of keys does not take for one.
    writeFileSync(join(keysDir(layout), `${pair.fingerprint}.key.4242.writing`), '');
    expect(listPrivateKeyFingerprints(layout)).toEqual([pair.fingerprint]);
  });
});

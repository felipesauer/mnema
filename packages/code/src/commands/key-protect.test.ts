import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEY_PASSPHRASE_VARIABLE, listPrivateKeyFiles, loadOrCreateKeyPair } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runKeyProtect, runKeyUnprotect } from './key-protect.js';

let home: string;
const before = process.env[KEY_PASSPHRASE_VARIABLE];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mnema-key-protect-'));
  mkdirSync(join(home, 'identity'), { recursive: true });
  delete process.env[KEY_PASSPHRASE_VARIABLE];
});

afterEach(() => {
  if (before === undefined) delete process.env[KEY_PASSPHRASE_VARIABLE];
  else process.env[KEY_PASSPHRASE_VARIABLE] = before;
  rmSync(home, { recursive: true, force: true });
});

const ctx = () => ({ cwd: home, env: { home, mnemaHome: home } });

describe('mnema key protect and unprotect', () => {
  it('refuse to protect with no passphrase, by code, and change nothing', () => {
    loadOrCreateKeyPair({ root: join(home, 'identity') });
    const before = listPrivateKeyFiles({ root: join(home, 'identity') }).map((path) =>
      readFileSync(path, 'utf-8'),
    );
    const refused = runKeyProtect(ctx());
    expect(refused).toMatchObject({ ok: false, code: 'NO_PASSPHRASE' });
    expect(
      listPrivateKeyFiles({ root: join(home, 'identity') }).map((path) =>
        readFileSync(path, 'utf-8'),
      ),
    ).toEqual(before);
  });

  it('protect what is in the clear and unprotect it again, answering which files changed', () => {
    loadOrCreateKeyPair({ root: join(home, 'identity') });
    process.env[KEY_PASSPHRASE_VARIABLE] = 'p';
    const protectedNow = runKeyProtect(ctx());
    expect(protectedNow.ok && protectedNow.files.map((one) => one.changed)).toEqual([true]);
    const again = runKeyProtect(ctx());
    expect(again.ok && again.files.map((one) => one.changed)).toEqual([false]);
    const back = runKeyUnprotect(ctx());
    expect(back.ok && back.files.map((one) => one.changed)).toEqual([true]);
  });

  it('refuse to unprotect with a passphrase that does not open the key', () => {
    loadOrCreateKeyPair({ root: join(home, 'identity') });
    process.env[KEY_PASSPHRASE_VARIABLE] = 'p';
    runKeyProtect(ctx());
    process.env[KEY_PASSPHRASE_VARIABLE] = 'q';
    expect(runKeyUnprotect(ctx())).toMatchObject({ ok: false, code: 'KEY_PASSPHRASE_WRONG' });
  });
});

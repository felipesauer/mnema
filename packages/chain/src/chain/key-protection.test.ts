import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureBackupKey } from './backup.js';
import {
  isProtected,
  KEY_PASSPHRASE_VARIABLE,
  KeyIsProtectedError,
  KeyPassphraseWrongError,
  protectPem,
  readPrivateKeyPair,
  replaceKeyFile,
  unprotectPem,
} from './key-protection.js';
import { generateKeyPair, privateKeyToPem } from './keys.js';
import {
  listPrivateKeyFiles,
  loadOrCreateKeyPair,
  persistKeyPair,
  protectPrivateKeys,
  unprotectPrivateKeys,
} from './keystore.js';

let root: string;
const before = process.env[KEY_PASSPHRASE_VARIABLE];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-key-protection-'));
  delete process.env[KEY_PASSPHRASE_VARIABLE];
});

afterEach(() => {
  if (before === undefined) delete process.env[KEY_PASSPHRASE_VARIABLE];
  else process.env[KEY_PASSPHRASE_VARIABLE] = before;
  rmSync(root, { recursive: true, force: true });
});

describe('a key protected by a passphrase', () => {
  it('opens to the PEM it was made from, and to nothing else', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const protectedText = protectPem(pem, 'correct horse');
    expect(isProtected(protectedText)).toBe(true);
    expect(isProtected(pem)).toBe(false);
    expect(unprotectPem(protectedText, 'correct horse')).toBe(pem);
    expect(unprotectPem(protectedText, 'wrong horse')).toBeUndefined();
  });

  it('holds nothing of the key in the clear, and is not the same bytes twice', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const body = pem.split('\n')[1] as string;
    const one = protectPem(pem, 'p');
    expect(one).not.toContain(body);
    expect(one).not.toContain('PRIVATE KEY');
    expect(protectPem(pem, 'p')).not.toBe(one);
  });

  it('refuses a file changed by a single byte, as it refuses a wrong passphrase', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const text = protectPem(pem, 'p');
    const lines = text.split('\n');
    const middle = lines[1] as string;
    const flipped = `${middle.slice(0, 20)}${middle[20] === 'A' ? 'B' : 'A'}${middle.slice(21)}`;
    expect(unprotectPem([lines[0], flipped, ...lines.slice(2)].join('\n'), 'p')).toBeUndefined();
    expect(
      unprotectPem('-----BEGIN MNEMA PROTECTED KEY-----\nnot base64 json\n', 'p'),
    ).toBeUndefined();
  });

  it('refuses a body with a key written twice, even when the value read last would open it', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const lines = protectPem(pem, 'p').trim().split('\n');
    const body = Buffer.from(lines.slice(1, -1).join(''), 'base64').toString('utf-8');
    // A decoy salt first and the real one after it: a reader where the last value wins opens this.
    const doubled = body.replace('"salt":', '"salt":"AAAAAAAAAAAAAAAAAAAAAA==","salt":');
    expect(doubled).not.toBe(body);
    const text = [lines[0], Buffer.from(doubled, 'utf-8').toString('base64'), lines.at(-1)].join(
      '\n',
    );
    expect(unprotectPem(text, 'p')).toBeUndefined();
  });
});

describe('reading a private key file', () => {
  it('returns an ordinary file as it always did, needing nothing', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const path = join(root, 'plain.key');
    writeFileSync(path, pem);
    expect(readPrivateKeyPair(path, pem).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a protected file with no passphrase, and with the wrong one — each by its own code', () => {
    const pem = privateKeyToPem(generateKeyPair().privateKey);
    const path = join(root, 'protected.key');
    const text = protectPem(pem, 'right');
    writeFileSync(path, text);
    expect(() => readPrivateKeyPair(path, text)).toThrow(KeyIsProtectedError);
    process.env[KEY_PASSPHRASE_VARIABLE] = 'wrong';
    expect(() => readPrivateKeyPair(path, text)).toThrow(KeyPassphraseWrongError);
    process.env[KEY_PASSPHRASE_VARIABLE] = 'right';
    expect(readPrivateKeyPair(path, text).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('opens a replaced file again, rather than answering from the one it held', () => {
    const path = join(root, 'swapped.key');
    const first = generateKeyPair();
    const second = generateKeyPair();
    process.env[KEY_PASSPHRASE_VARIABLE] = 'p';
    const one = protectPem(privateKeyToPem(first.privateKey), 'p');
    replaceKeyFile(path, one);
    expect(readPrivateKeyPair(path, one).fingerprint).toBe(first.fingerprint);
    const two = protectPem(privateKeyToPem(second.privateKey), 'p');
    replaceKeyFile(path, two);
    expect(readPrivateKeyPair(path, two).fingerprint).toBe(second.fingerprint);
  });

  it('writes a key file replaced in place with mode 0600', () => {
    const path = join(root, 'mode.key');
    replaceKeyFile(path, 'x');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('a machine’s keys at rest', () => {
  function aMachine() {
    const layout = { root: join(root, 'identity') };
    mkdirSync(layout.root, { recursive: true });
    const pair = loadOrCreateKeyPair(layout);
    const backup = ensureBackupKey(
      layout,
      'mnid:0000000000000000000000000000000000000000000000000000000000000000',
    );
    return { layout, pair, backup };
  }

  it('protects the key and its cold backup, and signs with the same key afterwards', () => {
    const { layout, pair } = aMachine();
    expect(listPrivateKeyFiles(layout)).toHaveLength(2);
    const changed = protectPrivateKeys(layout, 'p');
    expect(changed.map((one) => one.changed)).toEqual([true, true]);
    for (const { path } of changed) expect(isProtected(readFileSync(path, 'utf-8'))).toBe(true);
    process.env[KEY_PASSPHRASE_VARIABLE] = 'p';
    expect(loadOrCreateKeyPair(layout).fingerprint).toBe(pair.fingerprint);
  });

  it('does not mint a second key when the only one is protected and cannot be opened', () => {
    const { layout } = aMachine();
    protectPrivateKeys(layout, 'p');
    expect(() => loadOrCreateKeyPair(layout)).toThrow(KeyIsProtectedError);
    expect(listPrivateKeyFiles(layout)).toHaveLength(2);
  });

  it('leaves a file that is already protected alone, and says so', () => {
    const { layout } = aMachine();
    protectPrivateKeys(layout, 'p');
    expect(protectPrivateKeys(layout, 'another').map((one) => one.changed)).toEqual([false, false]);
  });

  it('unprotects all of them or none: a wrong passphrase changes nothing', () => {
    const { layout } = aMachine();
    protectPrivateKeys(layout, 'p');
    const before = listPrivateKeyFiles(layout).map((path) => readFileSync(path, 'utf-8'));
    expect(() => unprotectPrivateKeys(layout, 'nope')).toThrow(KeyPassphraseWrongError);
    expect(listPrivateKeyFiles(layout).map((path) => readFileSync(path, 'utf-8'))).toEqual(before);
    expect(unprotectPrivateKeys(layout, 'p').map((one) => one.changed)).toEqual([true, true]);
    for (const path of listPrivateKeyFiles(layout)) {
      expect(isProtected(readFileSync(path, 'utf-8'))).toBe(false);
    }
  });

  it('writes a key protected from the start when asked to, and in the clear otherwise', () => {
    const layout = { root: join(root, 'identity') };
    const pair = generateKeyPair();
    const path = persistKeyPair(layout, pair, { passphrase: 'p' });
    expect(isProtected(readFileSync(path, 'utf-8'))).toBe(true);
    const plain = persistKeyPair({ root: join(root, 'other') }, pair);
    expect(isProtected(readFileSync(plain, 'utf-8'))).toBe(false);
  });
});

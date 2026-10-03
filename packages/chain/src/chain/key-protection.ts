/**
 * A passphrase for the private key, optional, and nothing the signed record can see.
 *
 * HOW THE KEY IS KEPT WHEN NOBODY ASKED FOR ANYTHING, because that is the baseline this adds to
 * and it was never written down. The private half of a machine's key is one file per key,
 * `<key root>/keys/<fingerprint>.key`, where the key root is `$MNEMA_HOME/identity` (or
 * `~/.mnema/identity`). It is the key's PKCS#8 PEM in the clear — an Ed25519 key, 48 bytes of
 * DER under a header — written with mode 0600 at creation and never re-checked afterwards, in a
 * directory made with the process's umask. Whoever can read that file can sign as the identity,
 * and a copy of the disk is a copy of the identity. The cold backup `init` makes sits in
 * `<key root>/backup/` in the same form and is meant to be moved off the machine.
 *
 * WHAT THE PASSPHRASE CHANGES, and it changes one thing: the bytes of that file. A key that is
 * PROTECTED is the same PKCS#8 PEM, encrypted with a key derived from the passphrase, in a
 * wrapper this module owns. Nothing else moves. The signature is the same Ed25519 signature,
 * the fingerprint is the same, the public half is the same file, no event and no checkpoint
 * names whether the key was protected, and `verify` never reads a private key at all — so
 * `FORMAT.md` is untouched and a verifier written from it cannot tell. A machine that never
 * protects a key behaves exactly as it did.
 *
 * THE WRAPPER AND WHY NOT OPENSSL'S. Node can encrypt a PKCS#8 key itself, and what it writes is
 * PBES2 with a PBKDF2 count the caller cannot set (OpenSSL's default is a few thousand rounds),
 * which is a passphrase guarded by the speed of a laptop in 2005. scrypt is in the standard
 * library, memory-hard, and tunable; the file below records its parameters, so a later setting
 * opens the files an earlier one wrote. The cipher is AES-256-GCM, so a wrong passphrase and a
 * damaged file are both refused outright rather than decoded to garbage.
 *
 * WHERE THE PASSPHRASE COMES FROM: the `MNEMA_KEY_PASSPHRASE` environment variable, and — for a
 * person at a terminal — a prompt, with nothing echoed (`terminal-passphrase.ts`). THE FIRST
 * VERSION HAD THE VARIABLE ALONE, on the ground that an agent's server and a hook have no
 * terminal to ask at and a prompt that worked for a person and hung for them would be the worse
 * design. That reasoning holds for the doors that have no terminal and is why they are never
 * asked: the prompt appears only where the input and the error stream are both a terminal. What
 * it falsified was the other half — that a person had no better way than to export their
 * passphrase into the shell — and the system keychain is a later source, not this one. It is
 * read when a key is opened, never written anywhere, and a decrypted key is held in memory for the life of the
 * process and nowhere else — which is also what keeps a long-lived server from paying the
 * derivation on every write (measured in the delivery's report).
 *
 * WHAT IT DOES NOT PROTECT, said so that it is not read as more than it is: a process that runs
 * as the same user can read the variable from its environment and the decrypted key from the
 * process that holds it; a keylogger sees the passphrase typed; and a weak passphrase is weak
 * however it is derived. It protects the key AT REST — a stolen disk, a backup, a synced home —
 * which is what the file in the clear did not.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { renameSync, statSync, writeFileSync } from 'node:fs';
import { parseStoredJson } from '../events/stored-json.js';
import { CodedError } from './coded-error.js';
import type { KeyPair } from './keys.js';
import { keyPairFromPrivatePem } from './keys.js';
import { askOnTheTerminal } from './terminal-passphrase.js';

/** The environment variable the passphrase is read from. */
export const KEY_PASSPHRASE_VARIABLE = 'MNEMA_KEY_PASSPHRASE';

const BEGIN = '-----BEGIN MNEMA PROTECTED KEY-----';
const END = '-----END MNEMA PROTECTED KEY-----';

/** Bound into the ciphertext, so a file of another kind cannot be opened as this one. */
const ASSOCIATED = Buffer.from('mnema-protected-key-v1', 'utf-8');

/** scrypt's parameters for a key written now: 32 MiB, one lane. They travel in the file. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;

/** Room scrypt is allowed to use: 128 * N * r bytes for the table, with slack. */
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

/** The key file is protected: it cannot be opened without the passphrase, and none was given. */
export class KeyIsProtectedError extends CodedError {
  override readonly name = 'KeyIsProtectedError';
  readonly code = 'KEY_IS_PROTECTED';

  constructor(readonly path: string) {
    super(
      `the private key at ${path} is protected by a passphrase and ${KEY_PASSPHRASE_VARIABLE} is ` +
        `not set, and there is no terminal to ask at. Set it to the passphrase the key was ` +
        'protected with — in the environment of the process that signs, which for an agent is the ' +
        'environment the host started the server in — or run the command in a terminal, which asks.',
    );
  }
}

/** The passphrase given does not open the key, or the file was damaged. */
export class KeyPassphraseWrongError extends CodedError {
  override readonly name = 'KeyPassphraseWrongError';
  readonly code = 'KEY_PASSPHRASE_WRONG';

  constructor(readonly path: string) {
    super(
      `the passphrase given does not open the private key at ${path}: the passphrase is ` +
        'wrong, or the file was changed. Nothing was written.',
    );
  }
}

/** `mnema key protect` was asked with no passphrase to protect with. */
export class NoPassphraseToProtectWithError extends CodedError {
  override readonly name = 'NoPassphraseToProtectWithError';
  readonly code = 'NO_PASSPHRASE';

  constructor() {
    super(
      `no passphrase was given: ${KEY_PASSPHRASE_VARIABLE} is not set, or is empty, and there is no ` +
        'terminal to ask at (or the two answers differed). Set the variable, or run the command in a ' +
        'terminal, which asks twice; it is the passphrase for every later use of the key.',
    );
  }
}

/** Whether a key file's text is a protected key. */
export function isProtected(text: string): boolean {
  return text.trimStart().startsWith(BEGIN);
}

/** The passphrase in the environment, or undefined when it is unset or empty. */
export function passphraseFromEnvironment(): string | undefined {
  const given = process.env[KEY_PASSPHRASE_VARIABLE];
  return given === undefined || given === '' ? undefined : given;
}

/** What was typed at the terminal this process, once: asked for once and then held, like the key. */
let typed: string | undefined;

/**
 * The passphrase to OPEN a key with: the environment variable, else — at a terminal — what the
 * person types, asked once for the life of the process. `undefined` where neither can answer.
 */
export function passphraseToOpen(path: string): string | undefined {
  const given = passphraseFromEnvironment();
  if (given !== undefined) return given;
  typed ??= askOnTheTerminal(`Passphrase for the private key at ${path}: `);
  return typed;
}

/**
 * The passphrase to PROTECT keys with: the environment variable, else — at a terminal — what the
 * person types twice. The second asking is not decoration: a passphrase mistyped once is a key
 * nobody can open, and a record cannot be edited to forgive it. `undefined` where neither can
 * answer or the two did not agree.
 */
export function passphraseToProtectWith(): string | undefined {
  const given = passphraseFromEnvironment();
  if (given !== undefined) return given;
  const first = askOnTheTerminal('New passphrase for the private key: ');
  if (first === undefined) return undefined;
  const again = askOnTheTerminal('Again: ');
  return again === first ? first : undefined;
}

/** `pem`, encrypted under `passphrase`, as the text of a key file. */
export function protectPem(pem: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { ...SCRYPT, maxmem: SCRYPT_MAX_MEMORY });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(ASSOCIATED);
  const data = Buffer.concat([cipher.update(pem, 'utf-8'), cipher.final()]);
  const body = JSON.stringify({
    v: 1,
    kdf: 'scrypt',
    ...SCRYPT,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
  const wrapped =
    Buffer.from(body, 'utf-8')
      .toString('base64')
      .match(/.{1,64}/g) ?? [];
  return `${BEGIN}\n${wrapped.join('\n')}\n${END}\n`;
}

/**
 * The PEM inside a protected key file, or `undefined` when the passphrase does not open it or the
 * file is not what it says it is. The two are one answer on purpose: a wrong passphrase and a
 * damaged file are both "this cannot be opened with that", and a caller that could tell them
 * apart could be asked to. The wrapper's JSON is read by `parseStoredJson`, which refuses a
 * duplicate key but not a re-spelling (it is not a line of the record, and a changed value fails
 * the authentication), so a body with a key written twice is refused as a damaged file rather
 * than opened with whichever value came last.
 */
export function unprotectPem(text: string, passphrase: string): string | undefined {
  try {
    const encoded = text
      .trim()
      .split('\n')
      .filter((line) => line !== BEGIN && line !== END)
      .join('');
    const body = parseStoredJson(Buffer.from(encoded, 'base64').toString('utf-8')) as {
      v: number;
      kdf: string;
      N: number;
      r: number;
      p: number;
      salt: string;
      iv: string;
      tag: string;
      data: string;
    };
    if (body.v !== 1 || body.kdf !== 'scrypt') return undefined;
    const key = scryptSync(passphrase, Buffer.from(body.salt, 'base64'), 32, {
      N: body.N,
      r: body.r,
      p: body.p,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(body.iv, 'base64'));
    decipher.setAAD(ASSOCIATED);
    decipher.setAuthTag(Buffer.from(body.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(body.data, 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * What a decrypted file was, held for the life of the process: the same file, unchanged, opened
 * with the same passphrase, answers from here. Keyed by what identifies the bytes it was read
 * from (path, size, modification time) and the passphrase it was opened with, so a file that was
 * replaced, or a variable that was changed, is opened again.
 */
const OPENED = new Map<string, { readonly signature: string; readonly pem: string }>();

/**
 * The PEM a private key file holds — decrypted when it is protected.
 *
 * @throws {KeyIsProtectedError} when the file is protected and no passphrase is set.
 * @throws {KeyPassphraseWrongError} when the passphrase does not open it.
 */
export function readPrivatePem(path: string, text: string): string {
  if (!isProtected(text)) return text;
  const passphrase = passphraseToOpen(path);
  if (passphrase === undefined) throw new KeyIsProtectedError(path);
  const { size, mtimeMs } = statSync(path);
  const signature = `${size}:${mtimeMs}:${passphrase}`;
  const held = OPENED.get(path);
  if (held?.signature === signature) return held.pem;
  const pem = unprotectPem(text, passphrase);
  if (pem === undefined) throw new KeyPassphraseWrongError(path);
  OPENED.set(path, { signature, pem });
  return pem;
}

/** The key pair a private key file holds, opened with the passphrase when it has one. */
export function readPrivateKeyPair(path: string, text: string): KeyPair {
  return keyPairFromPrivatePem(readPrivatePem(path, text));
}

/**
 * Writes `text` to `path` the way a key file is written: to a file beside it first and renamed
 * over it, so a process that stops in the middle leaves the old key and not half of the new one,
 * and with mode 0600 from the first byte.
 */
export function replaceKeyFile(path: string, text: string): void {
  const aside = `${path}.${process.pid}.replacing`;
  writeFileSync(aside, text, { encoding: 'utf-8', mode: 0o600 });
  renameSync(aside, path);
}

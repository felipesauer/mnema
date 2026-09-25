/**
 * Persisting and loading a person's key pair, materializing its public half into
 * a chain, and minting a chain's installation id.
 *
 * The key belongs to the PERSON and lives in ONE place — a key root, separate
 * from any chain — so a single identity can write to several chains (a project's
 * public tree, its private one, a global one) without copying the private key.
 * The key root holds the full pair; a chain never does. A chain instead gets the
 * public half MATERIALIZED into it ({@link materializePublicKey}), named by
 * fingerprint and committed, so a verifier — a collaborator, an anonymous clone
 * — finds the key it needs without ever touching the key root.
 *
 * The private key is written under the key root and never committed. Generating
 * a fresh pair on first use means a reinstalled machine simply gets a new
 * identity, and past checkpoints stay verifiable against their (still committed)
 * public keys.
 *
 * The installation id is a random value minted once PER CHAIN and, like the
 * private key, kept local and never committed. It is what separates one person's
 * several chains (and two installations that share ONE copied key): each chain
 * mints its own id, so their tail directories differ and none overwrites another
 * on a merge, while all still authorize as the one anchor the key derives.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';

import {
  deriveAnchor,
  fingerprintOf,
  generateKeyPair,
  type KeyObject,
  type KeyPair,
  type PublicHalf,
  privateKeyFromPem,
  privateKeyToPem,
  publicKeyFromPem,
  publicKeyToPem,
} from './keys.js';
import {
  ANCHOR_SUFFIX,
  anchorPath,
  type ChainLayout,
  gitignorePath,
  installationIdPath,
  keysDir,
  privateKeyPath,
  publicKeyPath,
} from './layout.js';
import { sleepSync } from './sleep.js';

/**
 * Loads this machine's key pair, generating and persisting one if none exists.
 * A machine is identified by having BOTH a private and a public key on disk; if
 * only the public keys of OTHER machines are present, a new pair is minted.
 */
export function loadOrCreateKeyPair(layout: ChainLayout): KeyPair {
  const existing = findLocalKeyPair(layout);
  if (existing !== null) return existing;

  const keyPair = generateKeyPair();
  persistKeyPair(layout, keyPair);
  return keyPair;
}

const PRIVATE_KEY_SUFFIX = '.key';

/**
 * Every private key present at a key root, by fingerprint, in the order the
 * filesystem lists them — the candidates {@link loadOrCreateKeyPair} picks this
 * machine's identity from.
 *
 * The CHOICE is the hazard, which is why this is exposed: the machine adopts the
 * FIRST pair it finds, so a second private key here makes WHICH key it speaks as
 * depend on directory order. An operation that installs a key must be able to see
 * what is already there before creating that ambiguity — and a name is all it
 * needs, so no private key is read to answer.
 */
export function listPrivateKeyFingerprints(layout: ChainLayout): string[] {
  const dir = keysDir(layout);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(PRIVATE_KEY_SUFFIX))
    .map((name) => name.slice(0, -PRIVATE_KEY_SUFFIX.length));
}

/** Finds a local key pair (a public key whose matching private key is present). */
function findLocalKeyPair(layout: ChainLayout): KeyPair | null {
  for (const fingerprint of listPrivateKeyFingerprints(layout)) {
    const pubPath = publicKeyPath(layout, fingerprint);
    if (!existsSync(pubPath)) continue;
    const privateKey = privateKeyFromPem(
      readFileSync(privateKeyPath(layout, fingerprint), 'utf-8'),
    );
    const publicKey = publicKeyFromPem(readFileSync(pubPath, 'utf-8'));
    return { privateKey, publicKey, fingerprint };
  }
  return null;
}

/**
 * Writes both halves of a key pair to disk (the key root's own copy) and returns
 * where the private half landed. The path is reported for the same reason a
 * backup key's is: an operation that INSTALLS a key has to be able to tell the
 * person where their key now lives.
 */
export function persistKeyPair(layout: ChainLayout, keyPair: KeyPair): string {
  ensureKeyRootIgnored(layout);
  mkdirSync(keysDir(layout), { recursive: true });
  writeFileSync(publicKeyPath(layout, keyPair.fingerprint), publicKeyToPem(keyPair.publicKey), {
    encoding: 'utf-8',
  });
  const privatePath = privateKeyPath(layout, keyPair.fingerprint);
  writeFileSync(privatePath, privateKeyToPem(keyPair.privateKey), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return privatePath;
}

/**
 * Materializes ONLY the public half of a key into a chain, so an anonymous
 * verifier finds it there without the key root. Writes `<chain>/keys/<fp>.pub`
 * if it is absent; the private key is NEVER written to a chain — which is why it
 * asks for a {@link PublicHalf}, not a pair: a key whose private half has left
 * the machine (a cold backup) materializes exactly like one that never did.
 *
 * Idempotent — a chain already carrying the key is left untouched — and it never
 * overwrites: a
 * `.pub` already present (materialized before, or, in the pathological case,
 * swapped) stays as-is, because a swapped public key is caught by the verifier's
 * fingerprint binding (it re-derives the loaded key's fingerprint), not here.
 */
export function materializePublicKey(chainLayout: ChainLayout, key: PublicHalf): void {
  const path = publicKeyPath(chainLayout, key.fingerprint);
  if (existsSync(path)) return;
  mkdirSync(keysDir(chainLayout), { recursive: true });
  writeFileSync(path, publicKeyToPem(key.publicKey), { encoding: 'utf-8' });
}

/**
 * Reads a public key MATERIALIZED into a chain, bound to the name it is filed
 * under — {@link materializePublicKey}'s inverse. Returns null when the key is
 * absent, unreadable, or is not the key its filename names.
 *
 * The fingerprint is re-derived from the loaded key and compared, because the
 * filename is the only thing tying a file to a fingerprint: without that check,
 * swapping `keys/<fp>.pub` for another key would let a signature THAT key made
 * pass as this fingerprint's. Anyone deciding something about a committed key —
 * whether it consented to join an identity, say — needs the key it names, not
 * whatever the file now holds.
 *
 * It reads a CHAIN root, so what it returns is the committed, shareable half: no
 * key root, no private material, nothing local. An anonymous clone answers the
 * same question with the same bytes.
 */
export function committedPublicKey(
  chainLayout: ChainLayout,
  fingerprint: string,
): PublicHalf | null {
  const path = publicKeyPath(chainLayout, fingerprint);
  if (!existsSync(path)) return null;
  let publicKey: KeyObject;
  try {
    publicKey = publicKeyFromPem(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
  if (fingerprintOf(publicKey) !== fingerprint) return null;
  return { publicKey, fingerprint };
}

/**
 * Loads this installation's id for the given key, minting and persisting one on
 * first use. The id is 16 random bytes as hex — no dashes, so it never disturbs
 * the single `<fingerprint>-<installationId>` split, and wide enough that two
 * installations of the same copied key never collide.
 *
 * It is keyed by fingerprint but the FILE is local and uncommitted, so a machine
 * that receives a copied private key finds no `.inst` beside it and mints its
 * own — the mechanism that keeps the two on separate tails.
 *
 * TWO PROCESSES OF ONE KEY GET ONE ID, and they did not. This wrote the file with
 * `writeFileSync` and read an empty file as an absent one, and the two together forked
 * an installation. Two fresh processes that both found the file absent both minted, and
 * the second write won: with the two aligned, 19 of 20 rounds ended with two ids, the
 * window one to three milliseconds wide (the race the tail lock cannot see — its path is
 * derived FROM this id, so two ids take two locks). And `writeFileSync` creates the file
 * before it writes it: a process that read it in between — 5 of 5, on a simulation over
 * this function — minted another id over it, and the process that minted first went on
 * writing a tail nothing would ever open again. Both measured over this function and its
 * callers, with a barrier releasing the two processes at one instant.
 *
 * So the id is created EXCLUSIVELY (`O_EXCL`, the primitive the tail lock already relies
 * on): of two processes that both mint, the kernel lets one create the file, and the
 * other adopts what it wrote — 0 of 360 rounds forked under the same barrier. And an
 * empty file is read as what it is, an id being written ({@link readInstallationId}).
 * `keystore.test.ts` plants both states the race produces.
 *
 * @throws {UnwrittenInstallationIdError} if the file exists and stays empty past
 * {@link INSTALLATION_ID_WAIT_MS}. Nothing of the chain has been touched at that point.
 */
export function loadOrCreateInstallationId(layout: ChainLayout, fingerprint: string): string {
  const path = installationIdPath(layout, fingerprint);
  const deadline = Date.now() + INSTALLATION_ID_WAIT_MS;
  for (;;) {
    const existing = readInstallationId(path, deadline);
    if (existing !== undefined) return existing;
    mkdirSync(keysDir(layout), { recursive: true });
    const minted = mintInstallationId(path);
    if (minted !== undefined) return minted;
    // Another process created it between the read above and this mint: its id is this
    // installation's, and the next read waits for it to be written.
  }
}

/**
 * How long a reader waits for an installation id another process has created and not yet
 * written, before it refuses. The honest wait is the time between two system calls of one
 * process (`open` and `write`), which is microseconds, and milliseconds under heavy I/O; two
 * seconds is the tail lock's budget (`DEFAULT_WAIT_MS`) on the same argument — reaching it
 * means the writer stopped, not that it is slow.
 */
export const INSTALLATION_ID_WAIT_MS = 2_000;

/** How long that reader sleeps between looks — the tail lock's poll, for the same reason. */
const INSTALLATION_ID_POLL_MS = 5;

/**
 * An installation id file that exists and stayed empty: created by a process that stopped
 * before writing it. The machine cannot tell which tail is its own in this chain, and it
 * refuses to guess, because guessing is the fork {@link loadOrCreateInstallationId} exists
 * to prevent.
 */
export class UnwrittenInstallationIdError extends Error {
  readonly code = 'UNWRITTEN_INSTALLATION_ID';

  constructor(
    readonly path: string,
    waitedMs: number,
  ) {
    super(
      `${path} is empty and stayed empty for ${waitedMs}ms: an installation id was created and ` +
        'never written, which is what a process stopped between the two leaves behind. This ' +
        'machine will not guess which tail of this chain is its own, so it refuses the write. If ' +
        'no mnema process is writing here, remove the file: the next write mints a new id.',
    );
    this.name = 'UnwrittenInstallationIdError';
  }
}

/**
 * The installation id recorded at `path`, or undefined when there is no file there.
 *
 * AN EMPTY FILE IS NOT AN ABSENT ONE: it is an id another process has created and not yet
 * written — the moment between its `O_EXCL` and its write — so this waits for the id to land.
 * It refuses once `deadline` passes instead of answering "absent", because the caller would
 * then mint over a file somebody else is about to fill.
 */
function readInstallationId(path: string, deadline: number): string | undefined {
  for (;;) {
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const id = text.trim();
    if (id.length > 0) return id;
    if (Date.now() >= deadline) {
      throw new UnwrittenInstallationIdError(path, INSTALLATION_ID_WAIT_MS);
    }
    sleepSync(INSTALLATION_ID_POLL_MS);
  }
}

/**
 * Creates the installation id file at `path` holding a fresh id, EXCLUSIVELY, and returns the
 * id — or undefined when the file already exists, whoever created it: the caller then reads the
 * id that is there instead of writing over it.
 *
 * Exported inside the package for the test that plants the state the race produces (a mint that
 * found nothing, arriving after another process created the file), not beyond it.
 *
 * A write that fails after the create removes the file, so a full disk cannot leave behind the
 * empty `.inst` that every later reader would wait out and refuse.
 */
export function mintInstallationId(path: string): string | undefined {
  const installationId = randomBytes(16).toString('hex');
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    throw error;
  }
  try {
    writeSync(fd, `${installationId}\n`);
  } catch (error) {
    closeSync(fd);
    rmSync(path, { force: true });
    throw error;
  }
  closeSync(fd);
  return installationId;
}

/**
 * Reads the anchor this key serves, or null when none is recorded yet. Local
 * and uncommitted, like the installation id: it says WHICH anchor this
 * installation authorizes as. A machine with no recorded anchor founds its own
 * on first use.
 */
export function readAnchor(layout: ChainLayout, fingerprint: string): string | null {
  const path = anchorPath(layout, fingerprint);
  if (!existsSync(path)) return null;
  const value = readFileSync(path, 'utf-8').trim();
  return value.length > 0 ? value : null;
}

/**
 * Who signs in one chain as an installation of a key: the key's fingerprint, and the anchor
 * that installation serves there. It is everything a decision about identity reads, and
 * nothing that writes.
 */
export interface ChainSigner {
  /** The full fingerprint of the key that signs. */
  readonly signerFingerprint: string;
  /**
   * The anchor this installation authorizes as: the one it recorded, or, until it records
   * one, the anchor its key derives, which is the one it would found.
   */
  readonly anchor: string;
  /** Whether an anchor is recorded for this key in this chain yet. */
  readonly hasAnchor: boolean;
}

/**
 * The installation of `fingerprint` in the chain at `layout`, as a {@link ChainSigner} — read
 * from local material each time it is asked, never cached, so it answers what the disk holds.
 *
 * THE ONE READING of which anchor an installation serves. The writer's own `anchor` and
 * `hasAnchor` are this, and so is the signer a caller asks for without opening anything
 * (`signerAt`): a decision taken before a writer exists and the write that follows it read the
 * same rule, so the two cannot come to disagree about who is writing.
 */
export function signerOf(layout: ChainLayout, fingerprint: string): ChainSigner {
  return {
    signerFingerprint: fingerprint,
    get anchor(): string {
      return readAnchor(layout, fingerprint) ?? deriveAnchor(fingerprint);
    },
    get hasAnchor(): boolean {
      return readAnchor(layout, fingerprint) !== null;
    },
  };
}

/**
 * The key root's own `.gitignore`: everything in it, always.
 */
const KEY_ROOT_GITIGNORE = [
  "# Managed by mnema — this machine's private keys live here, and nothing in this directory",
  '# is ever committed: not the key, not its cold backup, not a registration.',
  '*',
  '',
].join('\n');

/**
 * Makes a key root ignore itself in git, unless it already carries a `.gitignore` of its own —
 * called by the two functions that write private key material ({@link persistKeyPair} and
 * `ensureBackupKey`), so it is there before the first private byte is.
 *
 * WHY THE KEY ROOT, AND WHY NOW. The key root lives in the home — `~/.mnema/identity`, or under
 * wherever `MNEMA_HOME` puts it — and a home kept under git, as dotfiles often are, is a
 * repository in which `git add .mnema` staged the private key and its backup. The tools that
 * write a directory into somebody's tree say so the same way (pytest's cache, ruff's, mypy's,
 * Python's `venv`: a `.gitignore` holding `*` in the directory they create); the ones that hold
 * keys write none, which is this product's reason to. It goes in the key root and not in the data
 * directory above it: the private half is what must never travel, while the global tree is the
 * person's to version or not — and only here does it hold wherever the key root sits, including a
 * data directory that already carries a `.gitignore` written for something else, like a project
 * tree's, which covers `keys/*.key` and not `identity/keys/*.key`.
 *
 * One that exists is left as it is, as a project tree's is (`ensureTree`): a person who edited it
 * keeps the edit.
 */
export function ensureKeyRootIgnored(keyRoot: ChainLayout): void {
  mkdirSync(keyRoot.root, { recursive: true });
  const path = gitignorePath(keyRoot);
  if (existsSync(path)) return;
  writeFileSync(path, KEY_ROOT_GITIGNORE, 'utf-8');
}

/**
 * Every key that has an anchor recorded in this tree, by fingerprint — which installations of
 * this machine have settled, locally, whom they speak for here. Empty for a tree with none, or no
 * tree at all.
 *
 * A write that settles an anchor where there was none is a key's first write into the tree —
 * the only moment it can found an identity — so a surface that lists these before and after a
 * write knows whether that moment passed, without asking the write.
 */
export function listAnchoredFingerprints(layout: ChainLayout): string[] {
  const dir = keysDir(layout);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(ANCHOR_SUFFIX))
    .map((name) => name.slice(0, -ANCHOR_SUFFIX.length))
    .sort();
}

/**
 * Records the anchor this key serves — the anchor it founded (its own) or one it
 * enrolled into. Written once and never committed; a second write with the same
 * value is a harmless no-op, a write with a different value would change which
 * identity this installation speaks for and is the caller's decision to make.
 */
export function writeAnchor(layout: ChainLayout, fingerprint: string, anchor: string): void {
  mkdirSync(keysDir(layout), { recursive: true });
  writeFileSync(anchorPath(layout, fingerprint), `${anchor}\n`, { encoding: 'utf-8', mode: 0o600 });
}

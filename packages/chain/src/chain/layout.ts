/**
 * On-disk layout, of two kinds of root: a CHAIN root (what a chain writes and a
 * verifier reads) and a KEY root (where a person's private key lives, separate
 * from any chain — see keystore.ts). The paths below serve both; which files
 * appear depends on the root's kind.
 *
 * Everything a machine writes to a chain lives under its own tail directory, so
 * two machines never touch the same file and an offline merge is just copying
 * directories — no in-file merge, ever. A tail is a run of sealed segment files
 * plus its append-only checkpoints.
 *
 * A tail id is `<fingerprint>-<installationId>`: the signing key's fingerprint,
 * then a random id minted once per installation and kept local. The fingerprint
 * prefix ties the tail to a committed key (its owner); the installation suffix
 * keeps a key's several installations — one per chain, or two of the same copied
 * key — on separate tails, so they merge without overwriting each other.
 *
 *   <chainRoot>/
 *     tails/
 *       <fingerprint>-<installationId>/
 *         000001.jsonl        segment (sealed once it passes the size cap)
 *         000002.jsonl        ...
 *         checkpoints.jsonl   append-only signed checkpoints for this tail
 *         tailproof.json      the key's signature over this tail's own id
 *     keys/
 *       <fingerprint>.pub     MATERIALIZED public key, committed (the private
 *                             half is NOT here — it lives in the key root)
 *       <fingerprint>.inst    LOCAL installation id for this chain (never committed)
 *       <fingerprint>.anchor  LOCAL anchor this installation serves (never committed)
 *
 *   <keyRoot>/
 *     keys/
 *       <fingerprint>.pub     the person's public key
 *       <fingerprint>.key     the person's LOCAL private key (never committed,
 *                             never copied into a chain)
 */

import { join } from 'node:path';

const SEGMENT_DIGITS = 6;

export interface ChainLayout {
  readonly root: string;
}

export function tailsDir(layout: ChainLayout): string {
  return join(layout.root, 'tails');
}

export function tailDir(layout: ChainLayout, tailId: string): string {
  return join(tailsDir(layout), tailId);
}

/** Zero-padded segment file path for a given segment number (1-based). */
export function segmentPath(layout: ChainLayout, tailId: string, segment: number): string {
  const name = `${String(segment).padStart(SEGMENT_DIGITS, '0')}.jsonl`;
  return join(tailDir(layout, tailId), name);
}

/** True if a filename is a segment file (NNNNNN.jsonl). */
export function isSegmentFile(name: string): boolean {
  return new RegExp(`^\\d{${SEGMENT_DIGITS}}\\.jsonl$`).test(name);
}

/** Extracts the segment number from a segment filename. */
export function segmentNumberOf(name: string): number {
  return Number.parseInt(name.slice(0, SEGMENT_DIGITS), 10);
}

export function checkpointsPath(layout: ChainLayout, tailId: string): string {
  return join(tailDir(layout, tailId), 'checkpoints.jsonl');
}

export function tailProofPath(layout: ChainLayout, tailId: string): string {
  return join(tailDir(layout, tailId), 'tailproof.json');
}

export function keysDir(layout: ChainLayout): string {
  return join(layout.root, 'keys');
}

export function publicKeyPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.pub`);
}

export function privateKeyPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.key`);
}

/**
 * Path to the LOCAL installation id for a key — never committed, like the
 * private key. It holds the random suffix that distinguishes this installation's
 * tail from another installation of the same key.
 */
export function installationIdPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.inst`);
}

/**
 * Path to the LOCAL anchor this key serves — never committed, like the private
 * key. It records WHICH anchor this installation's events authorize as: the
 * anchor it founded (its own, `deriveAnchor(fingerprint)`), or one it enrolled
 * into (another key's anchor). Kept local because committing it would let a
 * copied key drag a fixed anchor across machines and defeat the per-installation
 * separation the `.inst` provides. When absent, the machine has not yet recorded
 * an anchor and founds its own on first use.
 */
export function anchorPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.anchor`);
}

/**
 * Path to the chain's OWN `.gitignore` — the one the chain writes and owns, at
 * the root of its own tree. It exists only for a project tree that is meant to
 * be committed: it keeps the tree's local-only material (the private subtree,
 * private keys, installation ids, anchors) out of git while letting the proof
 * files (public keys, segments, checkpoints, tail proofs) through. It is never
 * the project's own `.gitignore` — the chain touches only what it owns.
 */
export function gitignorePath(layout: ChainLayout): string {
  return join(layout.root, '.gitignore');
}

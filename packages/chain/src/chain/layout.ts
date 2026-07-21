/**
 * On-disk layout of a chain.
 *
 * Everything a machine writes lives under its own tail directory, so two
 * machines never touch the same file and an offline merge is just copying
 * directories — no in-file merge, ever. A tail is a run of sealed segment
 * files plus its append-only checkpoints.
 *
 *   <root>/
 *     tails/
 *       <tailId>/
 *         000001.jsonl        segment (sealed once it passes the size cap)
 *         000002.jsonl        ...
 *         checkpoints.jsonl   append-only signed checkpoints for this tail
 *     keys/
 *       <fingerprint>.pub     committed public keys (one per machine)
 *       <fingerprint>.key     LOCAL private key (never committed)
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

export function keysDir(layout: ChainLayout): string {
  return join(layout.root, 'keys');
}

export function publicKeyPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.pub`);
}

export function privateKeyPath(layout: ChainLayout, fingerprint: string): string {
  return join(keysDir(layout), `${fingerprint}.key`);
}

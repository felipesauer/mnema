/**
 * One key, one installation id per chain — even when two processes of that key reach for it at once.
 *
 * The id picks the tail a machine writes (`<fingerprint>-<installationId>`), so two ids minted for
 * one key in one chain are one machine writing two tails, and the one nothing opens again is an
 * orphan. Two ways produced it, each a race a few milliseconds wide:
 *
 *   - two fresh processes that both found the file absent both minted, and the second write won;
 *   - a process that read the file between another one's create and its write found it EMPTY,
 *     read that as absent, and minted over it.
 *
 * WHY THESE CASES ARE NOT A RACE, for the reason `tail-lock.test.ts` gives: two processes spawned
 * to hit a window are a probe with a probability. What the race PRODUCES is a state, and each case
 * plants it and asks the product what it does with it — a mint arriving after another process
 * created the file, and a file created and not yet written. Rounds and rates, with a barrier
 * releasing two processes at one instant, are a measurement, not a case.
 */

import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateKeyPair } from './keys.js';
import {
  INSTALLATION_ID_WAIT_MS,
  loadOrCreateInstallationId,
  mintInstallationId,
  UnwrittenInstallationIdError,
} from './keystore.js';
import { type ChainLayout, installationIdPath } from './layout.js';

let root: string;
let layout: ChainLayout;
/** A real key's fingerprint — the only kind the product ever files an id under. */
let fingerprint: string;
let path: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-installation-id-'));
  layout = { root };
  fingerprint = generateKeyPair().fingerprint;
  path = installationIdPath(layout, fingerprint);
  mkdirSync(dirname(path), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An id as the product mints one: sixteen random bytes, as hex. */
const anId = (): string => randomBytes(16).toString('hex');

describe('two processes of one key get one installation id', () => {
  it('mints once, and reads the same id back after', () => {
    const minted = loadOrCreateInstallationId(layout, fingerprint);
    expect(minted).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(path, 'utf-8')).toBe(`${minted}\n`);
    expect(loadOrCreateInstallationId(layout, fingerprint)).toBe(minted);
  });

  it('a mint that finds the id already created adopts it, and never writes over it', () => {
    // The state the first race leaves: another process minted and wrote a moment ago, and this
    // one — which found nothing when it looked — is minting now.
    const theirs = loadOrCreateInstallationId(layout, fingerprint);
    expect(mintInstallationId(path)).toBeUndefined();
    expect(readFileSync(path, 'utf-8')).toBe(`${theirs}\n`);
    expect(loadOrCreateInstallationId(layout, fingerprint)).toBe(theirs);
  });

  it('an id another process has created and not yet written is waited for, never minted over', async () => {
    // The state the second race leaves: the file exists and is empty, and the process that made
    // it writes its id a moment later — here a thread, since this one is blocked reading.
    writeFileSync(path, '', { mode: 0o600 });
    const theirs = anId();
    const writer = new Worker(
      "const { writeFileSync } = require('node:fs');" +
        "const { workerData } = require('node:worker_threads');" +
        "setTimeout(() => writeFileSync(workerData.path, workerData.id + '\\n'), 150);",
      { eval: true, workerData: { path, id: theirs } },
    );
    const ours = loadOrCreateInstallationId(layout, fingerprint);
    await once(writer, 'exit');
    expect(ours).toBe(theirs);
    expect(readFileSync(path, 'utf-8')).toBe(`${theirs}\n`);
  });

  it('an id that stays empty is refused, and the file is left for a person to look at', {
    timeout: 10_000,
  }, () => {
    // Created and never written: what a process stopped between its create and its write
    // leaves. Minting over it would be the fork; the refusal names the file instead.
    writeFileSync(path, '', { mode: 0o600 });
    const started = Date.now();
    let refusal: unknown;
    try {
      loadOrCreateInstallationId(layout, fingerprint);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(UnwrittenInstallationIdError);
    expect((refusal as UnwrittenInstallationIdError).code).toBe('UNWRITTEN_INSTALLATION_ID');
    expect((refusal as Error).message).toContain(path);
    expect(Date.now() - started).toBeGreaterThanOrEqual(INSTALLATION_ID_WAIT_MS);
    expect(readFileSync(path, 'utf-8')).toBe('');
  });
});

/**
 * `mnema witness stamp` JUDGES EACH TREE ONCE, however many tails it stamps in it.
 *
 * The act refuses to stamp a tree that is not fully signed, and it used to ask that of the
 * WHOLE tree once per TAIL: a tree two machines write to was verified twice, one written
 * by ten machines ten times — and a verification is a pass over every event of the tree.
 * The level is the tree's, so every one of those passes gave the answer the first one
 * gave. It is asked once per tree now, after every tail's checkpoint has been read, so what
 * each tail stamps is still a checkpoint the verification that follows its read proved.
 *
 * Counted where it is paid: the verifier the act calls is wrapped, and every root it is
 * handed is written down. Nothing here reaches the network — the calendar is this file's.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, type Fetcher, verify as verifyChainAt } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees, tailsHeld } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runWitnessStamp } from './witness.js';

/** Every chain root the act asked the verifier about, in order. */
const judged = vi.hoisted(() => ({ roots: [] as string[] }));

vi.mock('@mnema/chain', async (importActual) => {
  const actual = await importActual<typeof import('@mnema/chain')>();
  return {
    ...actual,
    verify: (...args: Parameters<typeof actual.verify>) => {
      judged.roots.push(args[0]);
      return actual.verify(...args);
    },
  };
});

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-witness-once-'));
  judged.roots.length = 0;
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * What a calendar says when it has only just been asked — the promise `witness.test.ts`
 * spells out byte by byte, for the operator address it stamps with.
 */
const CALENDAR = 'https://alice.btc.calendar.opentimestamps.org';
const PROMISE = Buffer.from(
  '0083dfe30d2ef90c8e2e2d68747470733a2f2f616c6963652e6274632e63616c656e6461722e6f70656e74696d657374616d70732e6f7267',
  'hex',
);
const fetch: Fetcher = async () => new Response(PROMISE, { status: 200 });

describe('stamping a tree two machines write to', () => {
  it('verifies the tree once and stamps both of its tails', async () => {
    const repo = join(sandbox, 'repo');
    mkdirSync(repo, { recursive: true });
    const first: DiscoveryEnv = { home: join(sandbox, 'first-home') };
    const second: DiscoveryEnv = { home: join(sandbox, 'second-home') };
    runInit({ cwd: repo, env: first });
    runMemory({ cwd: repo, env: first }, { content: 'written on the first machine' });
    runMemory({ cwd: repo, env: second }, { content: 'written on the second machine' });
    const root = join(repo, '.mnema');
    // The world the case is about: ONE tree, TWO tails, fully signed — a stamp is only
    // ever asked of a tree that is.
    const held = tailsHeld(resolveTrees(repo, first), catalogUpcasters()).filter(
      (tail) => tail.scope === 'public',
    );
    expect(held).toHaveLength(2);
    expect(verifyChainAt(root, catalogUpcasters()).level).toBe('fully-signed');
    judged.roots.length = 0;

    const act = await runWitnessStamp(
      { cwd: repo, env: first, global: false },
      { calendars: [CALENDAR], fetch },
    );

    expect(act.ok).toBe(true);
    if (!act.ok) return;
    expect(act.outcomes.map((outcome) => outcome.did)).toEqual(['stamped', 'stamped']);
    expect(judged.roots).toEqual([root]);
  });
});

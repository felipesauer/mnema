/**
 * `runRecall` — the notes a session opens with, read out of every tree this machine holds.
 *
 * The two properties that make it a verb of its own are asserted first: it reads the tree
 * that does NOT travel (where an agent's note lands), which the document may not carry;
 * and it decides nothing about which notes or in what order — the index does — so its cut
 * and its order are the index's, observed here as values rather than restated.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiscoveryEnv, SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderPlain } from '../presentation/plain.js';
import { registerRecall } from '../wiring/recall.js';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runObserve } from './observe.js';
import { runRecall } from './recall.js';
import { runSwitch } from './switch.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-recall-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  // Both halves of the discovery environment inside the sandbox: the personal tree is
  // one of the three this reads, and it must be this sandbox's and not the machine's.
  env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const here = () => ({ cwd: repo, env });

/** The id a write minted, or a thrown error naming why there was none. */
function minted(result: { ok: boolean; id?: string }): string {
  if (!result.ok || result.id === undefined) throw new Error(JSON.stringify(result));
  return result.id;
}

describe('runRecall — the latest notes out of every tree this machine holds', () => {
  it('refuses where there is no project', () => {
    expect(runRecall(here())).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('reads the committed tree, this machine’s own and the personal one', () => {
    runInit(here());
    const committed = minted(runMemory(here(), { content: 'the invoice job runs at 02:00' }));
    const mine = minted(
      runMemory(here(), { content: 'staging resets every night', scope: 'private' }),
    );
    const personal = minted(
      runMemory(here(), { content: 'I review diffs before lunch', scope: 'global' }),
    );
    const observed = minted(
      runObserve(here(), { about: committed, topic: 'schedule', text: 'moved from 01:00' }),
    );

    const recalled = runRecall(here());
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;
    // Every tree, each note once, and the tree each came from on the hit — the private one
    // being the note the committed document is not allowed to carry.
    expect(recalled.memories.hits.map((hit) => [hit.id, hit.scope]).sort()).toEqual(
      [
        [committed, 'public'],
        [mine, 'private'],
        [personal, 'global'],
      ].sort(),
    );
    expect(recalled.memories.total).toBe(3);
    // An observation's line is its topic, which is what the index knows it by; its text is
    // one read away.
    expect(recalled.observations.hits.map((hit) => [hit.id, hit.title])).toEqual([
      [observed, 'schedule'],
    ]);
    expect(recalled.linkBreaks).toEqual([]);
  });

  it('serves the newest first, in the order the index serves', () => {
    runInit(here());
    const older = minted(runMemory(here(), { content: 'the older of two notes' }));
    const newer = minted(runMemory(here(), { content: 'the newer of two notes' }));
    const recalled = runRecall(here());
    if (!recalled.ok) throw new Error(JSON.stringify(recalled));
    expect(recalled.memories.hits.map((hit) => hit.id)).toEqual([newer, older]);
  });

  it('cuts where the index cuts, and says how many there are in all', () => {
    runInit(here());
    const written = SEARCH_DEFAULT_LIMIT + 3;
    for (let i = 0; i < written; i += 1) {
      minted(runMemory(here(), { content: `note number ${i}` }));
    }
    const recalled = runRecall(here());
    if (!recalled.ok) throw new Error(JSON.stringify(recalled));
    // The index's own limit and the index's own total — nothing here restates either.
    expect(recalled.memories.hits).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect(recalled.memories.total).toBe(written);
    expect(recalled.observations).toEqual({ hits: [], total: 0 });
  });

  it('refuses while its own channel is switched off, naming who switched it', () => {
    const founded = runInit(here());
    minted(runMemory(here(), { content: 'a note the switch keeps out' }));
    const switched = runSwitch(here(), { channel: 'recall-document', on: false, reason: 'x' });
    expect(switched.ok).toBe(true);

    const refused = runRecall(here());
    expect(refused).toMatchObject({
      ok: false,
      reason: 'SWITCHED_OFF',
      channel: 'recall-document',
      by: founded.anchor,
      travels: true,
    });
    // Two switches, and the document's is not this one: switching the rules off leaves the
    // notes arriving, which is the reason the channel has a switch of its own.
    runSwitch(here(), { channel: 'recall-document', on: true });
    runSwitch(here(), { channel: 'brief-document', on: false });
    expect(runRecall(here()).ok).toBe(true);
  });
});

describe('mnema recall — the verb', () => {
  it('is a read, and takes no option at all', () => {
    // What its wiring says it is, asked of the registration itself: a verb that PRODUCES a
    // channel a session opens with is still a read — it appends nothing — and it has no
    // `--scope` to leave out the private notes it exists to bring back, and no `--limit` to
    // disagree with the index about which notes are the latest.
    const declared = registerRecall(new Command(), {
      io: { out: () => undefined, err: () => undefined, fail: () => undefined },
      render: renderPlain,
      renderingAt: () => renderPlain,
      pinnedRun: () => undefined,
    });
    expect(declared.act.name()).toBe('recall');
    expect(declared.effect).toBe('reads');
    expect(declared.act.options.map((option) => option.long)).toEqual([]);
  });
});

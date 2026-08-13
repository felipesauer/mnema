/**
 * The adapter behind `mnema tail prune`: which tree it writes to, what it forwards,
 * and what it hands back.
 *
 * The two things this file exists for are the two the wiring cannot check. The
 * WAIVER FOLLOWS THE TAIL — a waiver in a tree other than the tail's is a signed fact
 * the per-tree census never meets — and every OPTION REACHES THE EVENT, which is the
 * defect class this workspace has paid for four times: an option plumbed to the end
 * with nothing feeding it passes every test of the code under the gap.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees, type Scope } from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTailPrune } from './tail-prune.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tail-prune-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/** The root of one of the project's trees. */
function rootOf(repo: string, env: DiscoveryEnv, scope: Scope): string {
  const trees = resolveTrees(repo, env);
  if (scope === 'public') return trees.projectPublic as string;
  if (scope === 'private') return trees.projectPrivate as string;
  return trees.global;
}

/**
 * A second machine's tail, merged into the tree at `into` the way an offline copy is:
 * its files, and the public half of the key that signed them.
 *
 * The tail a waiver names is always somebody else's — the door refuses one naming the
 * tail it is written to — so this is the only fixture that can reach the happy path.
 */
function mergeAForeignTail(into: string, label: string): { tail: string; anchor: string } {
  const machine = join(sandbox, label);
  mkdirSync(machine, { recursive: true });
  const writer = openChainForWriting(machine, { keyRoot: machine });
  const created = createTask(
    { writer, layout: { root: machine }, upcasters: catalogUpcasters() },
    { title: 'work another machine did' },
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);
  writer.checkpoint();
  for (const tail of readdirSync(join(machine, 'tails'))) {
    cpSync(join(machine, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(machine, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(into, 'keys', key));
  }
  return { tail: writer.tail, anchor: writer.anchor };
}

/** The one `tail.pruned` on a tree, or a failure naming what was there instead. */
function waiverOn(root: string) {
  const events = orderedEvents({ root }, catalogUpcasters());
  const waiver = events.find((event) => event.kind === 'tail.pruned');
  if (waiver?.kind !== 'tail.pruned') {
    throw new Error(`no waiver in ${root}: ${events.map((e) => e.kind).join(', ')}`);
  }
  return waiver;
}

describe('mnema tail prune', () => {
  it('writes the waiver into the tree that holds the tail, and reports what it claims', () => {
    const { repo, env } = setup();
    const publicRoot = rootOf(repo, env, 'public');
    const foreign = mergeAForeignTail(publicRoot, 'other-machine');

    const result = runTailPrune(
      { cwd: repo, env },
      { tail: foreign.tail, reason: 'the person asked to be taken out of the record' },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(result.scope).toBe('public');
    expect(result.tail).toBe(foreign.tail);
    // The claim came off the disk: the founding, the task's two events, and the
    // anchor that tail served — none of them supplied by this caller.
    expect(result.eventCount).toBe(3);
    expect(result.anchor).toBe(foreign.anchor);
    // WHO AUTHORIZED IS NOT WHOSE TAIL IT WAS, and the case the verb exists for is
    // exactly the one where they differ: one person asking to be taken out, another
    // authorizing it.
    expect(result.authorizedBy).not.toBe(foreign.anchor);
    expect(result.tailDirectory).toBe(join(publicRoot, 'tails', foreign.tail));

    const waiver = waiverOn(publicRoot);
    expect(waiver.payload.tail).toBe(foreign.tail);
    expect(waiver.payload.throughHash).toBe(result.throughHash);
    expect(waiver.payload.eventCount).toBe(3);
    expect(waiver.subject).toBe(foreign.anchor);
    expect(waiver.who).toBe(result.authorizedBy);
  });

  it('follows the tail into the PRIVATE tree rather than defaulting to the public one', () => {
    // The rule this adapter carries. A waiver is read by a per-tree census, so one
    // written to the public tree about a private tail is a signed fact nobody looking
    // at that tree will ever meet — and the tail it names would be gone by then.
    const { repo, env } = setup();
    const privateRoot = rootOf(repo, env, 'private');
    mkdirSync(join(privateRoot, 'tails'), { recursive: true });
    mkdirSync(join(privateRoot, 'keys'), { recursive: true });
    const foreign = mergeAForeignTail(privateRoot, 'other-machine');

    const result = runTailPrune(
      { cwd: repo, env },
      { tail: foreign.tail, reason: 'this machine is being wiped' },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe('private');
    expect(waiverOn(privateRoot).payload.tail).toBe(foreign.tail);
    // And the public tree holds no waiver at all — asked by the reader that would
    // find one, rather than by counting files.
    expect(
      orderedEvents({ root: rootOf(repo, env, 'public') }, catalogUpcasters()).some(
        (event) => event.kind === 'tail.pruned',
      ),
    ).toBe(false);
  });

  it('carries the reason, the agent and the run all the way onto the event', () => {
    // THE LINK. Each of these is an option the surface declares, and an option fed by
    // no caller is the defect this assertion exists to make impossible: the values are
    // read back off the stored event, never off the result the adapter returned.
    const { repo, env } = setup();
    const publicRoot = rootOf(repo, env, 'public');
    const foreign = mergeAForeignTail(publicRoot, 'other-machine');

    const result = runTailPrune(
      { cwd: repo, env },
      {
        tail: foreign.tail,
        reason: 'the person asked to be taken out of the record',
        which: 'agent-alpha',
        run: '01980000-0000-7000-8000-000000000001',
      },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const waiver = waiverOn(publicRoot);
    expect(waiver.payload.reason).toBe('the person asked to be taken out of the record');
    expect(waiver.which).toBe('agent-alpha');
    expect(waiver.run).toBe('01980000-0000-7000-8000-000000000001');
  });

  it('screens the reason like any other prose a caller writes', () => {
    const { repo, env } = setup();
    const publicRoot = rootOf(repo, env, 'public');
    const foreign = mergeAForeignTail(publicRoot, 'other-machine');

    const result = runTailPrune(
      { cwd: repo, env },
      { tail: foreign.tail, reason: 'rotating out, key was AKIAIOSFODNN7EXAMPLE' },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toEqual(['aws-access-key']);
    expect(waiverOn(publicRoot).payload.reason).toBe(
      'rotating out, key was <SECRET:aws-access-key>',
    );
  });

  it('refuses a tail no visible tree holds, without opening a writer on a guess', () => {
    const { repo, env } = setup();
    const result = runTailPrune(
      { cwd: repo, env },
      { tail: `${'a'.repeat(64)}-nowhere`, reason: 'a tail from another world' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNKNOWN_TAIL');
  });

  it('refuses the tail this write would land on, in the core’s own words', () => {
    const { repo, env } = setup();
    const trees = resolveTrees(repo, env);
    const publicRoot = trees.projectPublic as string;
    const mine = readdirSync(join(publicRoot, 'tails'))[0] as string;

    const result = runTailPrune({ cwd: repo, env }, { tail: mine, reason: 'cut myself' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('REFUSED');
    expect(result.code).toBe('TAIL_IS_OWN');
  });

  it('refuses outside a project, where there is no record to account for', () => {
    const empty = join(sandbox, 'nowhere');
    mkdirSync(empty, { recursive: true });
    const result = runTailPrune(
      { cwd: empty, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } },
      { tail: `${'a'.repeat(64)}-nowhere`, reason: 'nothing to account for' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NO_PROJECT');
  });
});

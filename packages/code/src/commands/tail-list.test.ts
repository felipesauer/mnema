/**
 * The adapter behind `mnema tail list`: what it enumerates, and that the verb beside
 * it agrees with the enumeration.
 *
 * The two things this file exists for are the two a reader of the output cannot
 * check. THE SET IS `prune`'S — a tail listed here and refused there would be an
 * offer the record turns down, and a tail hidden here and accepted there a cut
 * nobody could have decided on. And EVERY TREE OF THE TOPOLOGY IS IN IT: a project
 * whose committed and private trees both hold a tail shows both, each saying its
 * own, which a fixture with one tree would never notice.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting, tailDir } from '@mnema/chain';
import {
  type DiscoveryEnv,
  locateTailScope,
  orderedEvents,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTailList } from './tail-list.js';
import { runTailPrune } from './tail-prune.js';
import { runTask } from './task.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tail-list-'));
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
 * A second machine's tail, merged into the tree at `into` the way an offline copy
 * is — the fixture `tail-prune.test.ts` uses, for the same reason: the tail a waiver
 * names is always somebody else's, so it is the only one a happy path can reach.
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
  mkdirSync(join(into, 'tails'), { recursive: true });
  mkdirSync(join(into, 'keys'), { recursive: true });
  for (const tail of readdirSync(join(machine, 'tails'))) {
    cpSync(join(machine, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(machine, 'keys'))) {
    if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(into, 'keys', key));
  }
  return { tail: writer.tail, anchor: writer.anchor };
}

describe('mnema tail list', () => {
  it('names a tail in EVERY tree of the topology, each saying its own standing', () => {
    // The case a simple fixture never reaches: this machine writes to all three
    // trees, so ONE tail id exists three times over with a different history in
    // each. A listing that read the committed tree alone would look perfectly
    // healthy here — and would hide two of the three tails a cut can be authorized
    // for.
    const { repo, env } = setup();
    const ctx = { cwd: repo, env };
    expect(runTask(ctx, { title: 'a private chore', scope: 'private' }).ok).toBe(true);
    expect(runTask(ctx, { title: 'an errand for the machine', scope: 'global' }).ok).toBe(true);

    const listing = runTailList(ctx);
    expect(listing.tails.map((held) => held.scope)).toEqual(['public', 'private', 'global']);
    // ONE PERSON, THREE TAILS: the installation suffix is minted per chain, so one
    // person writing to three trees leaves three distinct tail ids — all of them
    // serving the same anchor. Each is its own thing to authorize a cut of, and a
    // reading that showed one would be hiding two whole histories.
    expect(new Set(listing.tails.map((held) => held.tail)).size).toBe(3);
    expect(new Set(listing.tails.map((held) => held.standing.who)).size).toBe(1);
    // And each row says ITS OWN standing, checked against what that tree holds read
    // by a different path — the replay every projection is built on. One tail per
    // tree here, so the tail's count is the tree's.
    for (const held of listing.tails) {
      const events = orderedEvents({ root: rootOf(repo, env, held.scope) }, catalogUpcasters());
      expect(held.standing.eventCount, `${held.scope} holds ${events.length}`).toBe(events.length);
    }
    // The head is the tail's own, so no two of the three agree on it.
    expect(new Set(listing.tails.map((held) => held.standing.throughHash)).size).toBe(3);
  });

  it('agrees with `prune` about the set: every tail it names is locatable, and only those', () => {
    const { repo, env } = setup();
    const ctx = { cwd: repo, env };
    expect(runTask(ctx, { title: 'a private chore', scope: 'private' }).ok).toBe(true);
    const foreign = mergeAForeignTail(rootOf(repo, env, 'global'), 'other-machine');

    const trees = resolveTrees(repo, env);
    const upcasters = catalogUpcasters();
    const listing = runTailList(ctx);
    expect(listing.tails.length).toBe(3);
    for (const held of listing.tails) {
      // Locatable, and located in the tree the FIRST row for that id names — which
      // is the tree `prune` opens a writer on.
      const first = listing.tails.find(
        (row) => row.tail === held.tail,
      ) as (typeof listing.tails)[0];
      expect(locateTailScope(trees, held.tail, upcasters)).toBe(first.scope);
    }
    expect(locateTailScope(trees, foreign.tail, upcasters)).toBe('global');

    // The other direction, over the two shapes that are not in the list: a tail from
    // another world, and a tail DIRECTORY with nothing in it — the ordinary residue
    // of a session that only read, which neither reading counts as held.
    const absent = `${'a'.repeat(64)}-nowhere`;
    expect(listing.tails.some((held) => held.tail === absent)).toBe(false);
    expect(locateTailScope(trees, absent, upcasters)).toBeUndefined();

    const hollow = `${'b'.repeat(64)}-empty`;
    mkdirSync(tailDir({ root: rootOf(repo, env, 'public') }, hollow), { recursive: true });
    expect(runTailList(ctx).tails.some((held) => held.tail === hollow)).toBe(false);
    expect(locateTailScope(trees, hollow, upcasters)).toBeUndefined();
  });

  it('says which tails a waiver already authorizes the cut of — and which it does not', () => {
    // Two assertions and they are the point: an implementation that answered
    // `authorized` for every tail would pass the first one alone, and somebody
    // reading the list would authorize a cut that is already on the record twice.
    const { repo, env } = setup();
    const ctx = { cwd: repo, env };
    const foreign = mergeAForeignTail(rootOf(repo, env, 'public'), 'other-machine');

    const before = runTailList(ctx);
    expect(before.tails.every((held) => !held.authorized)).toBe(true);

    const authorized = runTailPrune(ctx, {
      tail: foreign.tail,
      reason: 'the person asked to be taken out of the record',
    });
    expect(authorized.ok, JSON.stringify(authorized)).toBe(true);

    const after = runTailList(ctx);
    const byTail = new Map(after.tails.map((held) => [held.tail, held]));
    expect(byTail.get(foreign.tail)?.authorized).toBe(true);
    // This machine's own tail is in the same tree and carries the waiver — carrying
    // one is not being named by one.
    const own = [...byTail.keys()].find((tail) => tail !== foreign.tail) as string;
    expect(byTail.get(own)?.authorized).toBe(false);
  });

  it('counts a waiver only in the tree that holds the tail', () => {
    // The rule `prune` follows when it picks a tree, asked from the other end. A
    // waiver about a tail lives with that tail, so one found in another tree is a
    // signed fact the census that reads it never meets — and reporting it here would
    // tell a reader a cut is accounted for when the record it lands in says nothing.
    const { repo, env } = setup();
    const ctx = { cwd: repo, env };
    const foreign = mergeAForeignTail(rootOf(repo, env, 'private'), 'other-machine');
    // The same tail, also merged into the GLOBAL tree, where nothing authorizes it.
    cpSync(
      tailDir({ root: rootOf(repo, env, 'private') }, foreign.tail),
      tailDir({ root: rootOf(repo, env, 'global') }, foreign.tail),
      { recursive: true },
    );

    expect(
      runTailPrune(ctx, { tail: foreign.tail, reason: 'this machine is being wiped' }).ok,
    ).toBe(true);

    const rows = runTailList(ctx).tails.filter((held) => held.tail === foreign.tail);
    expect(rows.map((held) => [held.scope, held.authorized])).toEqual([
      ['private', true],
      ['global', false],
    ]);
  });

  it('names the trees it looked in, even when it found nothing', () => {
    const { repo, env } = setup();
    expect(runTailList({ cwd: repo, env }).trees).toEqual(['public', 'private', 'global']);

    // Outside a project there is one tree to look in and it is still worth looking:
    // the machine-global tree holds tails of its own. So the answer is empty and it
    // says where empty was measured, rather than refusing.
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });
    const outside = runTailList({
      cwd: nowhere,
      env: { xdgDataHome: join(sandbox, 'empty-data'), home: join(sandbox, 'empty-home') },
    });
    expect(outside.tails).toEqual([]);
    expect(outside.trees).toEqual(['global']);
  });
});

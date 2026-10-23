/**
 * THE FACTS A SESSION ASKS OF EVERY PROJECT ARE KEPT BESIDE THE TREE, AND THEY ARE BELIEVED ONLY
 * WHILE THE TREE IS AS THEY SAW IT.
 *
 * What is asserted, off the real chain in a sandbox and against the projection itself (a replay
 * of the same tree) as the independent source of the expected lists:
 *
 *   - the second reader of an unmoved tree gets the lists WITHOUT opening it, and they are the
 *     lists a replay gives, field for field;
 *   - it is read again, and the file replaced, as soon as the tree moved: an append, a sealed
 *     segment rewritten, a file that is garbage, a mark of other code;
 *   - a reader that remembers the extent does not even read the file, and reads again when the
 *     extent moved;
 *   - a tree with no tail keeps nothing and is read every time, and a directory that does not
 *     exist is not founded by asking.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, listTails, openChainForWriting, orderedSegments } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { switchChannel } from '../workflow/channel-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { endRun, startRun } from '../workflow/session-operations.js';
import { ProjectionCache } from './cache.js';
import { type Known, type TreeFacts, treeFactsFrom, treeIndexFile } from './tree-index.js';

const upcasters = catalogUpcasters();

let root: string;
let keys: string;
let indexFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-tree-index-'));
  keys = mkdtempSync(join(tmpdir(), 'mnema-tree-index-keys-'));
  indexFile = treeIndexFile(keys, root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
});

function writing(maxSegmentBytes?: number): WriteContext {
  return {
    writer: openChainForWriting(root, {
      keyRoot: keys,
      ...(maxSegmentBytes !== undefined ? { maxSegmentBytes } : {}),
    }),
    layout: { root },
    upcasters,
  };
}

function landed<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

/** What a replay of the tree lists: the independent source of what the index must say. */
function replayedFacts(): TreeFacts {
  const cache = ProjectionCache.open(root, { upcasters });
  try {
    cache.rebuild();
    return { runs: cache.listRuns(), channelSwitches: cache.channelSwitches() };
  } finally {
    cache.close();
  }
}

/** A reader that counts how many times it had to open the tree. */
function reader(): { read: () => TreeFacts; opened: () => number } {
  let opened = 0;
  return {
    read: () => {
      opened += 1;
      return replayedFacts();
    },
    opened: () => opened,
  };
}

function aTreeWithARun(): WriteContext {
  const ctx = writing();
  const run = landed(startRun(ctx, { agent: 'an-agent', goal: 'to be found' }));
  landed(switchChannel(ctx, { channel: 'a-channel', on: false, reason: 'because' }));
  landed(endRun(ctx, { run: run.id, which: 'an-agent', outcome: 'done' }));
  return ctx;
}

describe('the facts of a tree that has not moved', () => {
  it('come from the file the tree keeps, without opening the tree, and are what a replay lists', () => {
    aTreeWithARun();
    const first = reader();
    treeFactsFrom({ root }, indexFile, first.read);
    expect(first.opened()).toBe(1);
    expect(existsSync(indexFile)).toBe(true);

    const second = reader();
    const served = treeFactsFrom({ root }, indexFile, second.read);
    expect(second.opened()).toBe(0);
    expect(served.facts).toEqual(replayedFacts());
    expect(served.facts.runs).toHaveLength(1);
    expect(served.facts.runs[0]).toMatchObject({
      agent: 'an-agent',
      goal: 'to be found',
      open: false,
    });
    expect(served.facts.channelSwitches).toMatchObject([{ channel: 'a-channel', on: false }]);
  });

  it('are not even read from the file by a reader that remembers the extent, until it moves', () => {
    const ctx = aTreeWithARun();
    const first = treeFactsFrom({ root }, indexFile, reader().read);
    expect(first.extent).toBeDefined();
    rmSync(indexFile);
    const again = reader();
    const served = treeFactsFrom({ root }, indexFile, again.read, first as Known);
    expect(again.opened()).toBe(0);
    expect(served.facts).toEqual(first.facts);
    expect(existsSync(indexFile)).toBe(false);

    landed(startRun(ctx, { agent: 'an-agent', goal: 'a later run' }));
    const moved = treeFactsFrom({ root }, indexFile, again.read, first as Known);
    expect(again.opened()).toBe(1);
    expect(moved.facts.runs).toHaveLength(2);
  });
});

describe('the facts of a tree that moved', () => {
  it('are read again after an append, and the file says what the replay says', () => {
    const ctx = aTreeWithARun();
    treeFactsFrom({ root }, indexFile, reader().read);
    landed(startRun(ctx, { agent: 'an-agent', goal: 'a later run' }));

    const again = reader();
    const served = treeFactsFrom({ root }, indexFile, again.read);
    expect(again.opened()).toBe(1);
    expect(served.facts.runs.map((run) => run.goal).sort()).toEqual(['a later run', 'to be found']);
    expect(served.facts).toEqual(replayedFacts());
    const third = reader();
    treeFactsFrom({ root }, indexFile, third.read);
    expect(third.opened()).toBe(0);
  });

  it('are read again when a sealed segment is not the file it was marked at', () => {
    const ctx = writing(400);
    for (let at = 0; at < 6; at += 1)
      landed(startRun(ctx, { agent: 'an-agent', goal: `run ${at}` }));
    const [tail] = listTails({ root });
    const sealed = orderedSegments({ root }, tail as string).slice(0, -1);
    expect(sealed.length).toBeGreaterThan(0);
    treeFactsFrom({ root }, indexFile, reader().read);

    const held = reader();
    treeFactsFrom({ root }, indexFile, held.read);
    expect(held.opened()).toBe(0);

    const later = new Date(Date.now() + 60_000);
    utimesSync(sealed[0] as string, later, later);
    const touched = reader();
    treeFactsFrom({ root }, indexFile, touched.read);
    expect(touched.opened()).toBe(1);
  });

  it('are read again when the file is garbage or carries the mark of other code', () => {
    aTreeWithARun();
    treeFactsFrom({ root }, indexFile, reader().read);
    const path = indexFile;

    writeFileSync(path, '{not json');
    const garbage = reader();
    expect(treeFactsFrom({ root }, indexFile, garbage.read).facts).toEqual(replayedFacts());
    expect(garbage.opened()).toBe(1);
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();

    const kept = JSON.parse(readFileSync(path, 'utf8')) as { mark: string; facts: TreeFacts };
    const foreign = JSON.parse(kept.mark) as { stamp: string };
    writeFileSync(
      path,
      JSON.stringify({ ...kept, mark: JSON.stringify({ ...foreign, stamp: 'other code' }) }),
    );
    const other = reader();
    treeFactsFrom({ root }, indexFile, other.read);
    expect(other.opened()).toBe(1);
  });
});

/** The size of every live segment of the tree, to say two trees are the same size to the byte. */
function liveSizes(): number[] {
  return listTails({ root }).map(
    (tail) => statSync(orderedSegments({ root }, tail).at(-1) as string).size,
  );
}

/**
 * Two continuations of one base, as two branches of a checkout are: the files of each, kept
 * apart, and the tree is made to be one then the other by replacing it whole.
 */
function twoBranchesOfOneBase(
  base: (ctx: WriteContext) => void,
  branches: readonly [(ctx: WriteContext) => void, (ctx: WriteContext) => void],
): { checkout: (which: 0 | 1) => void } {
  base(writing());
  const seed = join(keys, 'seed');
  cpSync(root, seed, { recursive: true });
  const saved = branches.map((branch, at) => {
    rmSync(root, { recursive: true, force: true });
    cpSync(seed, root, { recursive: true });
    branch(writing());
    const kept = join(keys, `branch-${at}`);
    cpSync(root, kept, { recursive: true });
    return kept;
  });
  return {
    checkout: (which) => {
      rmSync(root, { recursive: true, force: true });
      cpSync(saved[which] as string, root, { recursive: true });
    },
  };
}

describe('the facts of a tree whose live segment was swapped for one of the same size', () => {
  it('are the runs of the tree that is there now, not of the one that was read', () => {
    const base = (ctx: WriteContext): void => {
      landed(startRun(ctx, { agent: 'an-agent', goal: 'the base' }));
    };
    const branch = (goal: string) => (ctx: WriteContext) => {
      landed(startRun(ctx, { agent: 'an-agent', goal }));
    };
    const { checkout } = twoBranchesOfOneBase(base, [branch('goal-AAAA'), branch('goal-BBBB')]);

    checkout(0);
    const sizeOfX = liveSizes();
    treeFactsFrom({ root }, indexFile, reader().read);
    checkout(1);
    expect(liveSizes()).toEqual(sizeOfX);

    const onY = reader();
    const served = treeFactsFrom({ root }, indexFile, onY.read);
    expect(onY.opened()).toBe(1);
    expect(served.facts).toEqual(replayedFacts());
    expect(served.facts.runs.map((run) => run.goal)).toContain('goal-BBBB');
    expect(served.facts.runs.map((run) => run.goal)).not.toContain('goal-AAAA');
  });

  it('say where a channel stands in the tree that is there now', () => {
    const base = (ctx: WriteContext): void => {
      landed(startRun(ctx, { agent: 'an-agent', goal: 'the base' }));
    };
    const { checkout } = twoBranchesOfOneBase(base, [
      (ctx) => {
        landed(switchChannel(ctx, { channel: 'tool-call-count', on: false, reason: 'aaaaaaa' }));
      },
      (ctx) => {
        landed(switchChannel(ctx, { channel: 'tool-call-count', on: true, reason: 'bbbbbbbb' }));
      },
    ]);

    checkout(0);
    const sizeOfX = liveSizes();
    const onX = treeFactsFrom({ root }, indexFile, reader().read);
    expect(onX.facts.channelSwitches).toMatchObject([{ on: false }]);
    checkout(1);
    expect(liveSizes()).toEqual(sizeOfX);

    const served = treeFactsFrom({ root }, indexFile, reader().read);
    expect(served.facts).toEqual(replayedFacts());
    expect(served.facts.channelSwitches).toMatchObject([{ on: true }]);
  });
});

describe('an index whose rows are not the rows a projection gives', () => {
  it.each([
    ['a null run', { runs: [null], channelSwitches: [] }],
    ['an empty run', { runs: [{}], channelSwitches: [] }],
    ['a run of the wrong types', { runs: [{ id: 1, open: 'yes' }], channelSwitches: [] }],
    ['a null switch', { runs: [], channelSwitches: [null] }],
    ['an empty switch', { runs: [], channelSwitches: [{}] }],
    ['no facts at all', null],
  ])('is not believed with %s: the tree is read and the file made again', (_name, facts) => {
    aTreeWithARun();
    treeFactsFrom({ root }, indexFile, reader().read);
    const kept = JSON.parse(readFileSync(indexFile, 'utf8')) as { mark: string };
    writeFileSync(indexFile, JSON.stringify({ mark: kept.mark, facts }));

    const again = reader();
    const served = treeFactsFrom({ root }, indexFile, again.read);
    expect(again.opened()).toBe(1);
    expect(served.facts).toEqual(replayedFacts());
    const third = reader();
    treeFactsFrom({ root }, indexFile, third.read);
    expect(third.opened()).toBe(0);
  });
});

describe('a tree with nothing to mark', () => {
  it('keeps no file and is read every time', () => {
    mkdirSync(root, { recursive: true });
    const each = reader();
    treeFactsFrom({ root }, indexFile, each.read);
    treeFactsFrom({ root }, indexFile, each.read);
    expect(each.opened()).toBe(2);
    expect(existsSync(indexFile)).toBe(false);
  });

  it('does not found a directory that is not there', () => {
    const missing = join(root, 'not-a-tree');
    treeFactsFrom({ root: missing }, indexFile, () => ({ runs: [], channelSwitches: [] }));
    expect(existsSync(missing)).toBe(false);
  });
});

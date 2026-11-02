/**
 * What a writer of a relink reads before it writes (`relink-plan.ts`): the plan read over two
 * trees at once, the tree written in first, as `doctor --fix private-tree` reads the tree that
 * stays and the one that moves into it; and the tails a cut of a relink's host would turn back
 * into their record. The refusals one by one, and the readers' rule asked before a write, are
 * held over the product's own writes in `@mnema/core` (`relink-operations.test.ts`).
 */

import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { identityFounded, memoryCaptured, tailPruned, tailRelinked } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { planRelinks, tailsACutWouldUnrelink } from './relink-plan.js';
import { namesOfTails } from './tail-names.js';
import { tailStanding } from './waiver.js';
import type { ChainWriter } from './writer.js';

const upcasters = catalogUpcasters();
let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-relink-plan-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const at = (): string => new Date().toISOString();

/** A note in the tree at `root`, by the key at `keys`, founded first: the writer that wrote it. */
function noted(root: string, keys: string, content: string): ChainWriter {
  const w = openChainForWriting(root, { keyRoot: join(sandbox, keys) });
  if (!w.hasAnchor) {
    w.append(
      identityFounded(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
        { foundingFp: w.signerFingerprint },
      ),
    );
    w.recordAnchor(w.anchor);
  }
  w.append(
    memoryCaptured(
      { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: content },
      { content },
    ),
  );
  w.checkpoint();
  return w;
}

describe('the plan read over two trees', () => {
  it('reads a tail of the second tree, and joins it to the record the first names', () => {
    const stays = join(sandbox, 'stays');
    const moves = join(sandbox, 'moves');
    const host = noted(stays, 'person', 'in the tree that stays').tail;
    const tail = noted(moves, 'person', 'in the tree that moves').tail;
    const planned = planRelinks([{ root: stays }, { root: moves }], upcasters, { tails: [tail] });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    expect(planned.relinks.map((one) => [one.tail, one.from, one.into, one.eventCount])).toEqual([
      [tail, namesOfTails({ root: moves }).get(tail), namesOfTails({ root: stays }).get(host), 2],
    ]);
    expect(planned.relinks[0]?.brings.identity).toEqual([{ kind: 'identity.founded', count: 1 }]);
  });
});

describe('the tails a cut of a host would turn back', () => {
  /** Y in `y` by the person, and a tail of X by the person copied in, relinked from `w`. */
  function relinkedFrom(cover: boolean) {
    const y = join(sandbox, 'y');
    const w = noted(y, 'person', 'in Y');
    const tail = noted(join(sandbox, 'x'), 'person', 'in X').tail;
    cpSync(join(sandbox, 'x', 'tails', tail), join(y, 'tails', tail), { recursive: true });
    const names = namesOfTails({ root: y });
    const held = tailStanding({ root: y }, tail, upcasters);
    if (held === undefined) throw new Error('the tail holds nothing');
    w.append(
      tailRelinked(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
        {
          tail,
          from: names.get(tail) as string,
          into: names.get(w.tail) as string,
          throughHash: held.throughHash,
          eventCount: held.eventCount,
          reason: 'joined',
        },
      ),
    );
    if (cover) w.checkpoint();
    return { y, w, tail };
  }

  it('are the tails its covered relinks name, still on disk', () => {
    const { y, w, tail } = relinkedFrom(true);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([tail]);
  });

  it('are none for a relink above its last checkpoint, which counts for nothing', () => {
    const { y, w } = relinkedFrom(false);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
  });

  it('are none once the cut of the relinked tail is authorized, or once it is gone', () => {
    const { y, w, tail } = relinkedFrom(true);
    const pruner = noted(y, 'pruner', 'the pruner');
    const standing = tailStanding({ root: y }, tail, upcasters);
    if (standing === undefined) throw new Error('the relinked tail holds nothing');
    pruner.append(
      tailPruned(
        { at: at(), who: pruner.anchor, signerFp: pruner.signerFingerprint, subject: w.anchor },
        {
          tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount,
          reason: 'cut too',
        },
      ),
    );
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
    rmSync(join(y, 'tails', tail), { recursive: true });
    expect(readdirSync(join(y, 'tails'))).not.toContain(tail);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
  });
});

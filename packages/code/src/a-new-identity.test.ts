import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, deriveAnchor, generateKeyPair, openChainForWriting } from '@mnema/chain';
import { type FoundedBeside, shortenAnchors } from '@mnema/core';
import { captureMemory } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  anchorsBefore,
  FoundingWatch,
  foundingSentence,
  foundingsSince,
} from './a-new-identity.js';

/** An anchor the product could have derived — from a key it could have minted. */
function anAnchor(): string {
  return deriveAnchor(generateKeyPair().fingerprint);
}

/** A founding beside `n` identities, every value one a write can produce. */
function foundedBeside(n: number): FoundedBeside {
  return {
    anchor: anAnchor(),
    foundingFp: generateKeyPair().fingerprint,
    at: '2026-09-24T10:00:00.000Z',
    besides: Array.from({ length: n }, anAnchor),
  };
}

describe('foundingSentence — one sentence, both surfaces', () => {
  it('names the identity founded and the one beside it, and hands over the command to copy', () => {
    const founded = foundedBeside(1);
    const short = shortenAnchors([founded.anchor, ...founded.besides]);
    const said = foundingSentence(founded, 'public');
    expect(said).toContain(
      `in the public tree, ${short.get(founded.anchor)}, beside 1 already there`,
    );
    expect(said).toContain(`(${short.get(founded.besides[0] as string)})`);
    expect(said).toContain('Someone new to this record reads exactly this and has nothing to do.');
    expect(said).toContain('If that identity is you — on another machine, or under another key —');
    expect(said).toContain('this tree counts you twice from now on');
    expect(said).toContain(
      `\`mnema key request --anchor ${short.get(founded.besides[0] as string)}\` here`,
    );
    expect(said).not.toContain('\n');
  });

  it('gives the trees kept on one machine their own words — no other machine wrote there', () => {
    for (const scope of ['private', 'global'] as const) {
      const said = foundingSentence(foundedBeside(1), scope);
      expect(said, scope).toContain(`in the ${scope} tree`);
      expect(said, scope).toContain('kept on this machine alone');
      expect(said, scope).toContain('— under another key —');
      expect(said, scope).not.toContain('on another machine');
      expect(said, scope).not.toContain('Someone new');
    }
  });

  it('names three of many, counts the rest, and points where they are all named', () => {
    const founded = foundedBeside(5);
    const said = foundingSentence(founded, 'public');
    expect(said).toContain('beside 5 already there (');
    expect(said).toContain('and 2 more — `mnema accountability` names them');
    expect(said).toContain('If one of them is you');
    expect(said).toContain('`mnema key request --anchor <that identity>` here');
  });
});

describe('what is owed after a write, read off the disk and the record', () => {
  let tree: string;
  let scratch: string[];

  beforeEach(() => {
    scratch = [];
    tree = made('mnema-a-new-identity-tree-');
  });

  afterEach(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  function made(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratch.push(dir);
    return dir;
  }

  /** A first write into the tree by a key of its own. */
  function aKeyWrites(note: string): void {
    const writer = openChainForWriting(tree, { keyRoot: made('mnema-a-new-identity-key-') });
    const captured = captureMemory(
      { writer, layout: { root: tree }, upcasters: catalogUpcasters() },
      { content: note },
    );
    if (!captured.ok) throw new Error(`setup: ${captured.message}`);
    writer.checkpoint();
  }

  it('owes nothing for the first identity of a tree, and one sentence for the next', () => {
    const empty = anchorsBefore([{ root: tree, scope: 'public' }]);
    aKeyWrites('the first');
    expect(foundingsSince(empty)).toEqual([]);

    const one = anchorsBefore([{ root: tree, scope: 'public' }]);
    aKeyWrites('a second key');
    const owed = foundingsSince(one);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toContain('beside 1 already there');
  });

  it('owes it once — a watch forgets what it said', () => {
    aKeyWrites('the first');
    const watch = new FoundingWatch();
    watch.opened(tree, 'public');
    aKeyWrites('a second key');
    expect(watch.take()).toHaveLength(1);
    expect(watch.take()).toEqual([]);
  });
});

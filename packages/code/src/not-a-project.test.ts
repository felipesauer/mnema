/**
 * What the product says about a `.mnema/` it passes over — the words, the count, and when
 * it says nothing.
 *
 * The count is asserted against events the product's own writer stored, and read back by
 * the reading `mnema tail list` counts with, so "N event(s)" here means what it means
 * there. The silence is asserted beside the line: a sentence owed for every data directory
 * would be a line on every command of every machine without `$XDG_DATA_HOME`.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { chainRootForScope, type DiscoveryEnv, type ResolvedTrees } from '@mnema/core';
import { captureMemory, openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  heldIn,
  passedOverFrom,
  passedOverSentence,
  passedOverSentences,
  WHY_NO_PROJECT_ROOT,
} from './not-a-project.js';

let sandbox: string;
let home: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-not-a-project-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A memory written into `tree` as a project's, by the product's own writer. */
function writtenInto(tree: string, note: string): void {
  const trees: ResolvedTrees = {
    projectPublic: tree,
    projectPrivate: join(tree, 'private'),
    global: join(sandbox, 'data', 'mnema', 'global'),
    keyRoot: join(sandbox, 'data', 'mnema', 'identity'),
  };
  const writer = openTreeForWriting(trees, 'public');
  const layout = { root: chainRootForScope(trees, 'public') as string };
  const captured = captureMemory(
    { writer, layout, upcasters: catalogUpcasters() },
    { content: note },
  );
  if (!captured.ok) throw new Error(`setup: refused: ${captured.message}`);
  writer.checkpoint();
}

describe('what a passed-over tree holds', () => {
  it('counts its events and its tails, by the reading `tail list` counts with', () => {
    const tree = join(home, '.mnema');
    writtenInto(tree, 'one');
    writtenInto(tree, 'two');
    // The founding and the two memories, in the one tail this machine writes.
    expect(heldIn(tree)).toEqual({ events: 3, tails: 1, unreadable: 0 });
  });

  it('counts a tail that will not parse as unreadable, instead of throwing at the verb', () => {
    const tree = join(home, '.mnema');
    writtenInto(tree, 'one');
    const [tail] = readdirSync(join(tree, 'tails'));
    appendFileSync(join(tree, 'tails', tail as string, '000001.jsonl'), 'not an entry\n{}\n');
    expect(heldIn(tree)).toEqual({ events: 0, tails: 0, unreadable: 1 });
  });

  it('holds nothing where there are no tails — a data directory’s key and global tree are not counted', () => {
    const dataDir = join(home, '.mnema');
    mkdirSync(join(dataDir, 'identity', 'keys'), { recursive: true });
    mkdirSync(join(dataDir, 'global', 'tails', 'x'), { recursive: true });
    expect(heldIn(dataDir)).toEqual({ events: 0, tails: 0, unreadable: 0 });
  });
});

describe('the sentence', () => {
  it('names the tree, why it is no project, and the count — on one line', () => {
    const tree = join(home, '.mnema');
    const said = passedOverSentence({ tree, why: 'home' }, { events: 5, tails: 2, unreadable: 0 });
    expect(said).toBe(
      `${tree} is not taken for a project: ${WHY_NO_PROJECT_ROOT.home}. It holds 5 event(s) in ` +
        '2 tail(s), recorded there as a project’s — left as they are: nothing here reads them ' +
        'into an answer, and nothing is written beside them.',
    );
  });

  it('says the tails it could not read, rather than a count that leaves them out', () => {
    const said = passedOverSentence(
      { tree: join(home, '.mnema'), why: 'data-directory' },
      { events: 2, tails: 1, unreadable: 1 },
    );
    expect(said).toContain('2 event(s) in 1 tail(s), and 1 tail(s) that could not be read');
    expect(said).toContain(WHY_NO_PROJECT_ROOT['data-directory']);
  });

  it('is owed nothing where nothing is held', () => {
    expect(
      passedOverSentence(
        { tree: join(home, '.mnema'), why: 'home' },
        { events: 0, tails: 0, unreadable: 0 },
      ),
    ).toBeUndefined();
  });

  it('keeps a directory name holding a newline on one line', () => {
    const tree = join(sandbox, 'odd\nname', '.mnema');
    const said = passedOverSentence({ tree, why: 'home' }, { events: 1, tails: 1, unreadable: 0 });
    expect(said).not.toContain('\n');
  });
});

describe('the sentences a walk owes', () => {
  it('names the home tree the walk from a folder under it passed over — and only that', () => {
    writtenInto(join(home, '.mnema'), 'a note that landed in the home tree');
    const folder = join(home, 'work', 'x');
    mkdirSync(folder, { recursive: true });
    const said = passedOverFrom(folder, env);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`${join(home, '.mnema')} is not taken for a project`);
    expect(said[0]).toContain('It holds 2 event(s) in 1 tail(s)');
  });

  it('owes nothing from inside a project, where the walk never reached the home', () => {
    writtenInto(join(home, '.mnema'), 'a note that landed in the home tree');
    const app = join(home, 'code', 'app');
    mkdirSync(join(app, '.mnema'), { recursive: true });
    expect(passedOverFrom(app, env)).toEqual([]);
  });

  it('owes nothing for a passed-over tree that holds nothing', () => {
    mkdirSync(join(home, '.mnema', 'identity'), { recursive: true });
    expect(passedOverSentences([{ tree: join(home, '.mnema'), why: 'home' }])).toEqual([]);
  });
});

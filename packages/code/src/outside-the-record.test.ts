/**
 * THE DOCUMENTS THIS CHECKOUT HOLDS THAT THE RECORD HAS NO DECISION FOR.
 *
 * The end-to-end half — that `mnema status` prints the section, and that it is absent
 * when there is nothing to say — is `tests/where-things-stand.test.ts`, beside the
 * contrast case that makes it mean something. What is here is the reading's OWN rules,
 * and each of them is a way the answer can be wrong while looking right:
 *
 *   - THE DIRECTORIES COME OUT OF THE RECORD and are never guessed. A base nobody
 *     imported from is a base this says nothing about, whatever the repository holds.
 *   - EVERY TREE IS READ. A file imported into the private tree is imported, and
 *     reporting it as outside would send somebody to import it twice.
 *   - A `derived-from` TARGET IS WHATEVER SOMEBODY TYPED. The relation is open and
 *     `mnema link` writes any target at all, so this reading turns untrusted strings
 *     into a directory it then LISTS — and the filter that stands between the two is
 *     the one thing here that is a door rather than a tidiness.
 *
 * The record is written by the PRODUCT in every case: the proposals come from
 * `decision import` and the strange targets from `link`, which is the verb a person
 * uses to write one. Nothing here fabricates an edge, which is what keeps the filter
 * being tested against input the product can actually produce.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adrFileNames, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecisionImport } from './commands/decision-import.js';
import { runInit } from './commands/init.js';
import { runLink } from './commands/link.js';
import { decisionsOutsideTheRecord } from './outside-the-record.js';
import { withScopedCaches } from './tree-sources.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-outside-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A founded project of its own, with its own data home — nothing leaks between cases. */
function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/**
 * One decision document in the shape the reader accepts — a level-1 title and a named
 * `##` section, which is what `adr-tools` and every published template write.
 */
function adr(repo: string, path: string, title: string): void {
  const full = join(repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `# ${title}\n\n## Context\n\nwhy ${title}\n`);
}

/** The reading, over every tree the project can see — the shape `runStatus` takes. */
function outside(repo: string, env: DiscoveryEnv) {
  const trees = resolveTrees(repo, env);
  return withScopedCaches(trees, (sources) => decisionsOutsideTheRecord(sources, repo));
}

describe('which decision documents this checkout holds that the record has none for', () => {
  it('names no directory the record did not name first', () => {
    // `scanAdrDirectory`'s rule kept, and it is the reason this reading can exist at
    // all: the caller names the base and nothing guesses one. A repository full of
    // decision documents nobody imported is a repository this says nothing about.
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    adr(repo, 'docs/adr/0001-ids.md', 'Mint ids as uuidv7');
    expect(outside(repo, env)).toEqual([]);

    // NOT VACUOUS: pointing the import at ONE of them makes that one — and only that
    // one — a base this reading knows about.
    runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: true });
    adr(repo, 'docs/decisions/0002-zones.md', 'Store zones as IANA names');
    adr(repo, 'docs/adr/0002-retries.md', 'Retry three times');
    expect(outside(repo, env)).toEqual([{ directory: 'docs/decisions', outside: 1 }]);
  });

  it('counts what is OUTSIDE, not what the base holds', () => {
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    adr(repo, 'docs/decisions/0002-ids.md', 'Mint ids as uuidv7');
    runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: true });
    // Two in, nothing outside — and the entry is ABSENT rather than reported as zero,
    // because a base with nothing outside has no fact to carry.
    expect(outside(repo, env)).toEqual([]);

    adr(repo, 'docs/decisions/0003-zones.md', 'Store zones as IANA names');
    expect(outside(repo, env)).toEqual([{ directory: 'docs/decisions', outside: 1 }]);
    adr(repo, 'docs/decisions/0004-retry.md', 'Retry three times');
    // Two different values of the count, over one base of four documents: a reading
    // that answered with the base's own size would have said three and then four.
    expect(outside(repo, env)).toEqual([{ directory: 'docs/decisions', outside: 2 }]);
  });

  it('reads EVERY tree — a file imported privately is imported', () => {
    // The idempotency `decision import` already has, kept here. Asking only the tree
    // that travels would report a privately imported file as outside, and send
    // somebody to record a second decision from the same document.
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    adr(repo, 'docs/decisions/0002-ids.md', 'Mint ids as uuidv7');
    runDecisionImport(
      { cwd: repo, env },
      { from: 'docs/decisions', write: true, scope: 'private' },
    );
    expect(outside(repo, env)).toEqual([]);

    // NOT VACUOUS: the private tree really is where they landed, so the silence above
    // is the union answering and not an empty directory.
    adr(repo, 'docs/decisions/0003-zones.md', 'Store zones as IANA names');
    expect(outside(repo, env)).toEqual([{ directory: 'docs/decisions', outside: 1 }]);
  });

  it('skips the furniture, by the SAME rule the import skips it by', () => {
    // A `README.md` and a `template.md` are a decision base's own furniture, and the
    // scan excludes them by name. A second reading with its own list would count a
    // README as a document outside the record — for ever, since the import will never
    // propose one and the count would never come down.
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: true });
    adr(repo, 'docs/decisions/README.md', 'The decisions of this project');
    adr(repo, 'docs/decisions/template.md', 'Short title of solved problem');
    writeFileSync(join(repo, 'docs/decisions/notes.txt'), 'not markdown at all');
    expect(outside(repo, env)).toEqual([]);

    // NOT VACUOUS: a real document in the same directory is still counted.
    adr(repo, 'docs/decisions/0002-ids.md', 'Mint ids as uuidv7');
    expect(outside(repo, env)).toEqual([{ directory: 'docs/decisions', outside: 1 }]);
  });

  it('drops a `derived-from` target that is not a path under this project', () => {
    // THE DOOR. The relation is open and `mnema link` writes whatever target somebody's
    // command line sends — a record id, an absolute path, a `..` climbing out of the
    // repository — and this reading turns a target into a directory it LISTS. Every one of
    // these is written by the product, through the verb a person would use.
    //
    // EVERY FORGED BASE HOLDS A REAL DOCUMENT, and that is the whole of what makes this
    // case worth running. The first version pointed at directories that do not exist, so
    // the door could be opened wide and the answer stayed empty for a reason that had
    // nothing to do with the door — mutation said so: `insideRoot` made to return `true`
    // for everything left 4697 of 4697 green. With the directories PRESENT, the same
    // mutation makes this reading walk out of the repository and report what it finds
    // there, which is the defect the filter is for.
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    const imported = runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: true });
    if (!imported.ok) throw new Error('fixture: the import refused');
    const subject = imported.proposals[0]?.id;
    if (subject === undefined) throw new Error('fixture: the import proposed nothing');

    // A base OUTSIDE the repository, reachable by climbing, holding a real document.
    mkdirSync(join(sandbox, 'outside'), { recursive: true });
    writeFileSync(
      join(sandbox, 'outside', '0001-elsewhere.md'),
      '# Somebody else’s decision\n\n## Context\n\nnot this project’s\n',
    );
    // A document at the ROOT of the repository, which no target below names: the root is a
    // legitimate base when the record names it (the case beside this one), so what this
    // proves is that it does not become one by accident.
    adr(repo, '0001-at-the-root.md', 'A decision at the root');
    // And an ABSOLUTE path whose tail, joined onto the root, is a directory that exists.
    adr(repo, 'etc/decisions/0001-absolute.md', 'A decision under a forged absolute');

    for (const target of [
      '../outside/0001-elsewhere.md',
      'docs/../outside/0001-elsewhere.md',
      '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b01',
      '/etc/decisions/0001-absolute.md',
      'https://example.invalid/adr/0001.md',
    ]) {
      const linked = runLink({ cwd: repo, env }, { subject, target, rel: 'derived-from' });
      expect(linked.ok, target).toBe(true);
    }
    // Not one of them became a base: the only directory named is the one the import wrote,
    // and it has nothing outside.
    expect(outside(repo, env)).toEqual([]);

    // NOT VACUOUS, in both directions. The edges really are in the record…
    const held = withScopedCaches(
      resolveTrees(repo, env),
      (sources) => sources.flatMap((source) => source.cache.linksByRelation('derived-from')).length,
    );
    expect(held).toBe(6);
    // …and every forged base really does hold a document this reading would report, which
    // is what the door is standing between. Asked of the one thing that can answer it: the
    // same file-name reading the walk itself uses.
    for (const base of [join(sandbox, 'outside'), repo, join(repo, 'etc', 'decisions')]) {
      expect(adrFileNames(base).length, base).toBeGreaterThan(0);
    }
  });

  it('takes the repository ROOT as a base when the record names it, and not before', () => {
    // `mnema decision import .` is a legitimate run — a project that keeps its decisions at
    // the top of the repository — and the provenance it records is a bare file name, with
    // no directory in it. So a target with no slash names the root, which is why the case
    // above can prove that a document lying there does NOT make the root a base on its own:
    // what decides is whether the record named it.
    const { repo, env } = setup();
    adr(repo, '0001-utc.md', 'Use UTC everywhere');
    expect(outside(repo, env)).toEqual([]);

    runDecisionImport({ cwd: repo, env }, { from: '.', write: true });
    adr(repo, '0002-ids.md', 'Mint ids as uuidv7');
    expect(outside(repo, env)).toEqual([{ directory: '.', outside: 1 }]);
  });

  it('names its bases in order, and only the ones with something outside', () => {
    const { repo, env } = setup();
    adr(repo, 'docs/decisions/0001-utc.md', 'Use UTC everywhere');
    adr(repo, 'adr/0001-ids.md', 'Mint ids as uuidv7');
    runDecisionImport({ cwd: repo, env }, { from: 'docs/decisions', write: true });
    runDecisionImport({ cwd: repo, env }, { from: 'adr', write: true });
    adr(repo, 'adr/0002-zones.md', 'Store zones as IANA names');
    adr(repo, 'docs/decisions/0002-retry.md', 'Retry three times');
    adr(repo, 'docs/decisions/0003-locks.md', 'Take the lock before the write');
    // Directory order, which is a property of the CONTENT rather than of the order the
    // edges happen to be read in — two trees rebuilt in either order answer the same.
    expect(outside(repo, env)).toEqual([
      { directory: 'adr', outside: 1 },
      { directory: 'docs/decisions', outside: 2 },
    ]);
  });
});

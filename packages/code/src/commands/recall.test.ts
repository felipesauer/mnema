/**
 * `runRecall` — the notes a session opens with, read out of every tree this machine holds.
 *
 * The two properties that make it a verb of its own are asserted first: it reads the tree
 * that does NOT travel (where an agent's note lands), which the document may not carry;
 * and its cut and its ranking are the index's, observed here as values rather than
 * restated. This said it *"decides nothing about which notes or in what order"*, and it
 * does decide one thing now: the notes that share a word with what the session touches
 * come first. The last block holds that to a repository built in the sandbox — the theme
 * the tree touches ahead of the newest, the newest where nothing is touched, the same
 * bytes for the same tree, and a hostile path read as words.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type DiscoveryEnv, SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../tests/support/git-without-maintenance.js';
import { renderPlain } from '../presentation/plain.js';
import { recallDocument } from '../presentation/recall.js';
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
  env = { home: join(sandbox, 'home') };
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

describe('runRecall — the notes out of every tree this machine holds', () => {
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
    expect(recalled.observations).toEqual({ hits: [], total: 0, pertinent: 0 });
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
  it('is a read, and takes one option — the copy a hook carries', () => {
    // What its wiring says it is, asked of the registration itself: a verb that PRODUCES a
    // channel a session opens with is still a read — it appends nothing — and it has no
    // `--scope` to leave out the private notes it exists to bring back, and no `--limit` to
    // disagree with the index about where the list is cut. THIS CASE WAS "takes no option at
    // all", and `--hook` is the one it takes now: the plugin's handler asks for the copy that
    // stays inside what a hook carries, and nothing else about the answer moves with it.
    const declared = registerRecall(new Command(), {
      io: { out: () => undefined, err: () => undefined, fail: () => undefined },
      render: renderPlain,
      renderingAt: () => renderPlain,
      pinnedRun: () => undefined,
    });
    expect(declared.act.name()).toBe('recall');
    expect(declared.effect).toBe('reads');
    expect(declared.act.options.map((option) => option.long)).toEqual(['--hook']);
  });
});

describe('runRecall — the notes near what the session touches come first', () => {
  /** `git <args>` in the sandbox's repository, as every git a test writes a repository with runs. */
  function git(...args: string[]): void {
    const ran = spawnSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
        GIT_AUTHOR_NAME: 'a',
        GIT_AUTHOR_EMAIL: 'a@example.com',
        GIT_COMMITTER_NAME: 'a',
        GIT_COMMITTER_EMAIL: 'a@example.com',
      },
    });
    if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
  }

  /** A file in the sandbox's repository, with its directories. */
  function write(path: string): void {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), 'x\n');
  }

  /**
   * A record of two themes, the one the tree will touch written FIRST: three notes about
   * invoices, then more notes about the login screen than the index serves. By date alone,
   * not one invoice note is handed over.
   */
  function twoThemes(): { readonly invoice: string[]; readonly login: string[] } {
    runInit(here());
    const invoice = [
      'the invoice rounding job runs nightly',
      'invoices round half up',
      'the invoice totals are cached',
    ].map((content) => minted(runMemory(here(), { content })));
    const login: string[] = [];
    for (let i = 0; i < SEARCH_DEFAULT_LIMIT; i += 1) {
      login.push(minted(runMemory(here(), { content: `the login screen keeps the session ${i}` })));
    }
    return { invoice, login };
  }

  it('hands over the notes of the theme the tree touches ahead of the newest', () => {
    mkdirSync(join(sandbox, 'git-home'), { recursive: true });
    git('init', '-q', '-b', 'main');
    const { invoice, login } = twoThemes();
    write('src/billing/invoice.ts');

    const recalled = runRecall(here());
    if (!recalled.ok) throw new Error(JSON.stringify(recalled));
    expect(recalled.touched.words).toEqual(['src', 'billing', 'invoice']);
    const served = recalled.memories.hits.map((hit) => hit.id);
    // The three invoice notes lead, though they are the three OLDEST in the record.
    expect(served.slice(0, 3).sort()).toEqual([...invoice].sort());
    expect(recalled.memories.pertinent).toBe(3);
    // Then the newest of the rest, newest first, to the index's own cut.
    expect(served.slice(3)).toEqual([...login].reverse().slice(0, SEARCH_DEFAULT_LIMIT - 3));
    expect(recalled.memories.total).toBe(invoice.length + login.length);
    // And the text says so, in one line.
    const text = recallDocument(recalled);
    expect(text.filter((line) => line.startsWith('Nearest first: '))).toHaveLength(1);
    expect(text).toContain('The first 3 share a word with what this session touches.');
  });

  it('hands over the newest, as before, where nothing is touched', () => {
    // Outside git and with no task in progress there is nothing to be near.
    const { invoice, login } = twoThemes();
    const recalled = runRecall(here());
    if (!recalled.ok) throw new Error(JSON.stringify(recalled));
    expect(recalled.touched.words).toEqual([]);
    expect(recalled.memories.pertinent).toBe(0);
    expect(recalled.memories.hits.map((hit) => hit.id)).toEqual(
      [...login].reverse().slice(0, SEARCH_DEFAULT_LIMIT),
    );
    expect(recalled.memories.hits.map((hit) => hit.id)).not.toContain(invoice[0]);
    const text = recallDocument(recalled);
    expect(text.filter((line) => line.startsWith('Newest first: '))).toHaveLength(1);
  });

  it('is the same text, byte for byte, for the same tree and the same record', () => {
    mkdirSync(join(sandbox, 'git-home'), { recursive: true });
    git('init', '-q', '-b', 'ledger-export');
    twoThemes();
    write('src/billing/invoice.ts');
    git('add', 'src');
    git('commit', '-q', '-m', 'invoice');
    write('src/login/screen.ts');

    const text = () => {
      const recalled = runRecall(here());
      if (!recalled.ok) throw new Error(JSON.stringify(recalled));
      return recallDocument(recalled).join('\n');
    };
    const first = text();
    expect(text()).toBe(first);
    // Not a text that never moves: a change to the tree is a change to it.
    rmSync(join(repo, 'src', 'login'), { recursive: true });
    expect(text()).not.toBe(first);
  });

  it('reads a hostile path as words, never as the index’s syntax', () => {
    mkdirSync(join(sandbox, 'git-home'), { recursive: true });
    git('init', '-q', '-b', 'main');
    const { invoice } = twoThemes();
    // A quote, a prefix star, NEAR( and a leading minus: each is FTS5 grammar, raw.
    write('docs/"invoice" NEAR(rounding -x) star*.md');
    const recalled = runRecall(here());
    if (!recalled.ok) throw new Error(JSON.stringify(recalled));
    expect(recalled.touched.words).toEqual(['docs', 'invoice', 'NEAR', 'rounding', 'star']);
    expect(recalled.memories.hits[0]?.id).toBe(invoice[0]);
  });
});

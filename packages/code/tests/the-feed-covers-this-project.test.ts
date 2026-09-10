/**
 * WHAT LEAVES THE MACHINE IS WHAT THE PERSON CHOSE — the tree lock on `mnema export`.
 *
 * MEASURED on the built binary before this existed. Two projects on one disk; a personal
 * note written to the machine-GLOBAL tree from inside project B; `export` run inside
 * project A. The id, the instant and the author of B's fact came out in A's feed, and
 * there was no flag to prevent it. `export` is the only read of this product that leaves
 * the machine — whoever forwards the feed to a company's SIEM was forwarding what they
 * had written at home, in another repository.
 *
 * THE FORM IS THE ONE THE PRODUCT ALREADY DECIDED, FOUR TIMES. `verify --global` and the
 * three `witness` subcommands all declare `--global`, default off, because the
 * machine-global tree belongs to no project and is present in every one. The study
 * proposed a repeatable `--scope public|private|global` instead, which would have been a
 * third vocabulary for one axis. It is `--global` here, with the same sentence, and the
 * sentence now lives in one place (`vocabulary.ts`) because this verb was the fourth to
 * ask.
 *
 * ADDITIVE, AND THAT IS WHAT MAKES THE WORST SHAPE UNREPRESENTABLE. A selector that could
 * ask for the global tree ALONE would fabricate a broken session in the feed: a run opens
 * in the public tree and pins facts written in the global one, so a global-only cut shows
 * lines correlated to a session that never opens. `--global` can only ADD, so the public
 * tree is in every feed this verb emits.
 *
 * AND THE COVERAGE IS DECLARED, because a cut with nothing saying so is worse than no cut.
 * NDJSON has no header, and every line names the tree it came FROM — which says where a
 * fact was and nothing about where the reader was not allowed to look. So "no global fact
 * exists" and "the global tree was left out" arrive identical. The verb writes what it
 * covered on stderr, because stdout carries records and nothing else.
 *
 * WHAT THIS DOES NOT FIX, and it is measured rather than assumed: the same global tree
 * reaches an agent through the MCP with BODIES — `read_record` returns a global memory's
 * whole content, `search` with no term lists the titles of all three trees, and
 * `bootstrap` carried a global skill written in another project into `awaitingJudgement`.
 * So the claim that this lock "closes the only real leak" is FALSE. What it closes is the
 * leanest of the exits — an envelope, no body — and it is the one a person pushes
 * somewhere permanent on purpose. The bodies reaching an agent are a decision nobody has
 * taken, and it is not this one.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExport } from '../src/commands/export.js';
import { runInit } from '../src/commands/init.js';
import { runMemory } from '../src/commands/memory.js';
import { runTask } from '../src/commands/task.js';
import { globalTreeGloss } from '../src/vocabulary.js';

/** A word nothing else in this fixture contains. */
const MARKER = 'GLOBALFROMB';

let sandbox: string;
let env: DiscoveryEnv;
let projectA: string;
let projectB: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-feed-covers-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'xdg') };
  mkdirSync(env.home, { recursive: true });
  projectA = join(sandbox, 'a');
  projectB = join(sandbox, 'b');
  for (const dir of [projectA, projectB]) {
    mkdirSync(dir, { recursive: true });
    runInit({ cwd: dir, env });
  }
  // Project A's own work, in its two trees.
  const task = runTask({ cwd: projectA, env }, { title: 'a public task of project A' });
  if (!task.ok) throw new Error(`setup: task refused: ${task.reason}`);
  const mine = runMemory(
    { cwd: projectA, env },
    { content: 'a private note of A', scope: 'private' },
  );
  if (!mine.ok) throw new Error(`setup: private memory refused: ${mine.reason}`);
  // And a personal note written to the MACHINE-GLOBAL tree from inside the OTHER project.
  const elsewhere = runMemory(
    { cwd: projectB, env },
    { content: `${MARKER} a personal note about the acme merger`, scope: 'global' },
  );
  if (!elsewhere.ok) throw new Error(`setup: global memory refused: ${elsewhere.reason}`);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The feed A emits, and which trees it says it covered. */
function feedOfA(global?: boolean): {
  readonly trees: readonly string[];
  readonly logs: readonly string[];
  readonly kinds: readonly string[];
} {
  const done = runExport({ cwd: projectA, env }, global === undefined ? {} : { global });
  if (!done.ok) throw new Error(`export refused: ${done.reason}`);
  return {
    trees: done.trees,
    logs: done.events.map((event) => event.metadata.log_name),
    kinds: done.events.map((event) => event.metadata.event_code),
  };
}

describe('the feed covers this project, and says which trees that was', () => {
  it('keeps the other project’s global fact out — the leak, measured shut', () => {
    const feed = feedOfA();
    // WHAT THE LOCK PREVENTS, prevented: not one line from the machine-global tree.
    expect(feed.logs).not.toContain('global');
    expect(feed.trees).toEqual(['public', 'private']);
  });

  it('lets this project’s own record through — both of its trees', () => {
    // WHAT THE LOCK MUST LET PASS, passing. Without this the case above would be
    // satisfied by an `export` that emitted nothing at all.
    const feed = feedOfA();
    expect(feed.logs).toContain('public');
    expect(feed.logs).toContain('private');
    expect(feed.kinds).toContain('task.created');
    expect(feed.kinds).toContain('memory.captured');
    expect(feed.logs.length).toBeGreaterThan(2);
  });

  it('brings the global tree back when it is asked for, and adds rather than replaces', () => {
    const feed = feedOfA(true);
    expect(feed.trees).toEqual(['public', 'private', 'global']);
    expect(feed.logs).toContain('global');
    // ADDITIVE: the public tree is still there. A cut that could leave it out would put
    // facts in the feed correlated to a session that never opens in it.
    expect(feed.logs).toContain('public');
    expect(feed.logs).toContain('private');
    // And the fact that comes back is the one written in the OTHER project — which is
    // what makes the default a lock and not an accident of this fixture.
    expect(feed.logs.filter((log) => log === 'global').length).toBeGreaterThan(0);
  });

  it('declares a coverage that DIFFERS between the two, so a cut can be seen', () => {
    // The half that makes the lock legible. NDJSON has no header and every line names
    // the tree a fact came from, so the two feeds below could otherwise be told apart
    // only by a reader who already knew what to expect.
    expect(feedOfA().trees).not.toEqual(feedOfA(true).trees);
    expect(feedOfA().trees).toHaveLength(2);
    expect(feedOfA(true).trees).toHaveLength(3);
  });

  it('says it in the words the other three verbs say it in', () => {
    // ONE AXIS, ONE SENTENCE. It was spelled two ways before this verb needed it —
    // `witness` shared one string across three subcommands, `verify` had a longer one
    // of its own — and a third spelling was one verb away. The shared half is asserted
    // here; the clause that varies is each verb's own consequence.
    const shared = "also cover this machine's global tree — left out by default";
    expect(globalTreeGloss('and this is the only read that leaves the machine')).toContain(shared);
    expect(globalTreeGloss('x')).toContain('belongs to no project and is present in every one');
    // The consequence really varies, or the parameter buys nothing.
    expect(globalTreeGloss('one thing')).not.toBe(globalTreeGloss('another thing'));
  });
});

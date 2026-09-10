/**
 * AN ADDRESS WHOSE SUBJECT DOES NOT RESOLVE IS NOT A RULE THAT GOVERNS.
 *
 * MEASURED in a clone, on the built binary, before any of this existed. `mnema link
 * --scope public --rel governs <a-private-decision> <path>` is accepted today: the edge
 * is committed and reaches every clone, and the decision it names never leaves the
 * machine. Over one such record with two of them, the four readings of that graph
 * disagreed about the same committed bytes:
 *
 *     mnema rules src        3 govern this path      two printed `(unresolved)`
 *     governing_rules        counts.governing: 3     two entries with no kind, no state
 *     mnema brief            1 of the rules …        right
 *     the edit gate          named one rule          right
 *
 * `3 govern this path` where ONE governs is the product asserting a false fact to the
 * stranger who clones — on its public surface, in a number that presents itself as a
 * whole answer.
 *
 * AND THE TWO THAT WERE RIGHT WERE RIGHT BY ACCIDENT, which is why the fix is a NAMED
 * rule and not four repairs. `brief` and the gate narrow to what is IN FORCE, and an
 * unresolved subject has no state — so it fell out because it has no state, not because
 * anything asked whether it resolved. A correctness nothing states is a correctness the
 * next reading does not inherit, and the two that were wrong are the demonstration.
 *
 * WHAT THIS FILE ASSERTS, and it is deliberately over a CLONE:
 *   - the four readings agree, over bytes that really travelled;
 *   - THE CONTRAST, without which the first would pass over a product that counted
 *     nothing at all: an address whose subject DOES resolve still counts, in all four;
 *   - the unreadable address is not dropped — it is counted and named in its own class,
 *     because the record holds it and an absence nobody counted is one nobody fixes;
 *   - the WRITE says so, at the moment the person can still record the rule where the
 *     address is. That half is the other order the decision set, and it is the only
 *     moment the sentence is worth anything.
 *
 * WHAT IT DOES NOT DECIDE: whether a clone should be told about a rule its owner chose
 * to keep private. That is the owner's question and it is open. What was never open is
 * the product asserting a count that is false.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { governingRules, rulesInForceAt } from '@mnema/copilot';
import { type DiscoveryEnv, PROJECT_DIR, ProjectionCache } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBrief } from '../src/commands/brief.js';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { runRules } from '../src/commands/rules.js';

let sandbox: string;
let env: DiscoveryEnv;
let repo: string;

/** A decision, accepted, in whichever tree is asked for — the shape a rule really has. */
function aRule(title: string, scope: 'public' | 'private'): string {
  const made = runDecision({ cwd: repo, env }, { title, rationale: 'Because so.', scope });
  if (!made.ok) throw new Error(`decision refused: ${made.reason}`);
  const moved = runDecisionTransition(
    { cwd: repo, env },
    { id: made.id, action: 'accept', proof: { note: 'reviewed' } },
  );
  if (!moved.ok) throw new Error(`accept refused: ${moved.reason}`);
  return made.id;
}

/** A `governs` edge in the tree that TRAVELS, whatever tree its subject is in. */
function addressPublicly(rule: string, path: string): ReturnType<typeof runLink> {
  const linked = runLink(
    { cwd: repo, env },
    { subject: rule, target: path, rel: 'governs', scope: 'public' },
  );
  if (!linked.ok) throw new Error(`link refused: ${linked.reason}`);
  return linked;
}

/**
 * The committed tree, copied ALONE — the way `git clone` delivers it.
 *
 * The private subtree is left behind because that is what the `.gitignore` does: it is
 * inside the committed tree on disk and outside the repository.
 */
function cloneOfTheCommittedTree(): string {
  const clone = join(sandbox, 'clone');
  mkdirSync(clone, { recursive: true });
  cpSync(join(repo, PROJECT_DIR), join(clone, PROJECT_DIR), {
    recursive: true,
    filter: (from) => basename(from) !== 'private',
  });
  mkdirSync(join(clone, 'src'), { recursive: true });
  cpSync(join(repo, 'src'), join(clone, 'src'), { recursive: true });
  return clone;
}

/** What `mnema rules` answers in a directory, through the read the CLI calls. */
function rulesIn(project: string, path: string): ReturnType<typeof runRules> {
  return runRules({ cwd: project, env }, { path });
}

/** What the pushing channel and the gate see, out of the clone's own caches. */
function pushedIn(project: string, path: string): readonly { id: string }[] {
  const root = join(project, PROJECT_DIR);
  const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
  try {
    cache.rebuild();
    return rulesInForceAt([{ scope: 'public', chainRoot: root, cache }], {
      path: join(project, path),
      root: project,
      onDisk: () => true,
    }).rules;
  } finally {
    cache.close();
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-address-opens-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'xdg') };
  mkdirSync(env.home, { recursive: true });
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('an address names a rule a reader can open, or it is not a rule that governs', () => {
  it('counts one where one governs, in a clone that holds two more addresses', () => {
    // The record the defect needs: ONE rule that travels, and TWO public addresses whose
    // subjects are private decisions.
    addressPublicly(aRule('Collate in one place', 'public'), 'src');
    addressPublicly(aRule('A private rule', 'private'), 'src');
    addressPublicly(aRule('Another private rule', 'private'), 'src');
    const clone = cloneOfTheCommittedTree();

    const reading = rulesIn(clone, 'src');
    if (!reading.ok) throw new Error(`rules refused: ${reading.reason}`);
    // ONE governs, and the two others are counted apart rather than folded in.
    expect(reading.governed.counts.governing).toBe(1);
    expect(reading.governed.counts.matching).toBe(1);
    expect(reading.governed.counts.unresolved).toBe(2);
    expect(reading.governed.rules).toHaveLength(1);
    expect(reading.governed.unresolved).toHaveLength(2);
    // NOT stale: the two are different repairs, and reporting one as the other would
    // send a reader to move an address whose rule they cannot read.
    expect(reading.governed.counts.stale).toBe(0);

    // AND THE FOUR READINGS AGREE. `brief` counts RULES and this counts ADDRESSES, so
    // the numbers coincide here because each rule carries one address — which is what
    // makes this record the one where the disagreement was visible at all.
    const document = runBrief({ cwd: clone, env });
    if (!document.ok) throw new Error(`brief refused: ${document.reason}`);
    expect(document.brief.addressed).toBe(1);
    expect(pushedIn(clone, 'src')).toHaveLength(1);
  });

  it('still counts an address whose subject DOES resolve — the contrast', () => {
    // Without this the case above is satisfied by a product that counts nothing.
    addressPublicly(aRule('Collate in one place', 'public'), 'src');
    addressPublicly(aRule('Name things once', 'public'), 'src');
    const clone = cloneOfTheCommittedTree();

    const reading = rulesIn(clone, 'src');
    if (!reading.ok) throw new Error(`rules refused: ${reading.reason}`);
    expect(reading.governed.counts.governing).toBe(2);
    expect(reading.governed.counts.matching).toBe(2);
    expect(reading.governed.counts.unresolved).toBe(0);
    expect(reading.governed.unresolved).toEqual([]);
    const document = runBrief({ cwd: clone, env });
    if (!document.ok) throw new Error(`brief refused: ${document.reason}`);
    expect(document.brief.addressed).toBe(2);
    expect(pushedIn(clone, 'src')).toHaveLength(2);
  });

  it('names the unreadable ones rather than only counting them', () => {
    // A count of broken addresses is fixed by making the count smaller; a list is fixed
    // by looking at what it names. The id is all there is to carry, and it is what a
    // reader takes back to the machine that holds the rule.
    const hidden = aRule('A private rule', 'private');
    addressPublicly(hidden, 'src');
    const clone = cloneOfTheCommittedTree();

    const reading = rulesIn(clone, 'src');
    if (!reading.ok) throw new Error(`rules refused: ${reading.reason}`);
    const [named] = reading.governed.unresolved;
    expect(named?.rule).toBe(hidden);
    // Nothing is invented for what was not read, and the EDGE is still fully attributed:
    // the assertion is a fact of the record even when its subject is not here.
    expect(named?.kind).toBeUndefined();
    expect(named?.name).toBeUndefined();
    expect(named?.state).toBeUndefined();
    expect(named?.assertedIn).toBe('public');
    expect(named?.address).toBe('src');
  });

  it('says so at the WRITE, when the rule can still be recorded where the address is', () => {
    // The other half of the order the decision set. Read afterwards it is somebody
    // else's puzzle in a clone; said here it is a sentence the person can act on.
    const inTheOtherTree = addressPublicly(aRule('A private rule', 'private'), 'src');
    expect(inTheOtherTree.ok && inTheOtherTree.subjectScope).toBe('private');

    // THE CONTRAST at the write too: the ordinary case reports the ordinary thing, so
    // the field is not a constant.
    const travelling = addressPublicly(aRule('Collate in one place', 'public'), 'src');
    expect(travelling.ok && travelling.subjectScope).toBe('public');

    // And an id no tree holds is ABSENT rather than a scope — a rule nobody wrote is
    // not a rule in some tree, and the two need different repairs.
    const nowhere = addressPublicly('01a08c99-0000-7000-8000-000000000000', 'src');
    expect(nowhere.ok && nowhere.subjectScope).toBeUndefined();
  });

  it('leaves the derivation one function, asked by every reading', () => {
    // A1: the rule is applied at one site and the readings ask it. This drives the
    // copilot's own entry points directly, so a fifth surface added tomorrow gets the
    // same answer without a line of its own — and a surface that grew a walk of its own
    // would answer differently here than the reading above.
    addressPublicly(aRule('A private rule', 'private'), 'src');
    const clone = cloneOfTheCommittedTree();
    const root = join(clone, PROJECT_DIR);
    const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
    try {
      cache.rebuild();
      const sources = [{ scope: 'public' as const, chainRoot: root, cache }];
      const asked = { path: join(clone, 'src'), root: clone, onDisk: () => true };
      expect(governingRules(sources, asked).counts.governing).toBe(0);
      expect(governingRules(sources, asked).counts.unresolved).toBe(1);
      expect(rulesInForceAt(sources, asked).rules).toEqual([]);
    } finally {
      cache.close();
    }
  });
});

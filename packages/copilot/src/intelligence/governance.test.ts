import { rmSync } from 'node:fs';
import type { ProjectionCache, Scope } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthSkill,
  capture,
  link,
  makeBench,
  moveDecision,
  moveSkill,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { type GovernanceQuery, governingRules } from './governance.js';

let benches: Bench[] = [];
let caches: ProjectionCache[] = [];

afterEach(() => {
  for (const c of caches) c.close();
  for (const b of benches) rmSync(b.root, { recursive: true, force: true });
  caches = [];
  benches = [];
});

function bench(): Bench {
  const b = makeBench();
  benches.push(b);
  return b;
}

/** The project every query below is about — a directory, never touched on disk. */
const ROOT = '/work/repo';

function tree(
  b: Bench,
  scope: Scope = 'public',
  project: string | undefined = undefined,
): ScopedCache {
  const cache = b.cache();
  caches.push(cache);
  return { scope, chainRoot: b.root, cache, ...(project !== undefined ? { project } : {}) };
}

/**
 * A query over a working tree the test DECLARES, rather than one it creates.
 *
 * The derivation takes the disk probe as a parameter precisely so a case can say
 * what exists — which is what lets the stale count be tested against an address
 * whose file was deleted, without a case having to delete one.
 */
function asking(path: string, present: readonly string[] = []): GovernanceQuery {
  return { path, root: ROOT, onDisk: (relative) => present.includes(relative) };
}

/**
 * The gate's three numbers when no case in this file records one.
 *
 * Named rather than spelled at each assertion, and it is a claim rather than boilerplate:
 * every case below is about the relation that INFORMS, so the relation that stops somebody
 * must read zero in all three — and it reading anything else would mean the two walks had
 * started sharing a list. The gate's own cases live with the charge that stands on them
 * (`code/tests/the-record-asks-for-a-person.test.ts`).
 */
const NO_GATE = { matching: 0, addressed: 0, stale: 0 };

/** The rules of a reading, as `address → id`, in the order the reading put them. */
const addresses = (rules: readonly { address?: string; rule: string }[]): string[] =>
  rules.map((rule) => `${rule.address ?? '(nowhere)'} → ${rule.rule}`);

describe('governance — an address is a prefix by segment', () => {
  it('governs the path it names and everything under it', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    link(b, 'dec-1', 'src/collate', 'governs');

    const under = governingRules([tree(b)], asking('src/collate/fold.ts', ['src/collate']));
    expect(addresses(under.rules)).toEqual(['src/collate → dec-1']);

    const itself = governingRules([tree(b)], asking('src/collate', ['src/collate']));
    expect(addresses(itself.rules)).toEqual(['src/collate → dec-1']);
  });

  it('does NOT govern a sibling whose name merely starts the same', () => {
    // The case the whole segment comparison exists for: `src/collate_test.rb` shares
    // every character of `src/collate` and is not under it. A string prefix would
    // hand this file a rule nobody addressed, and would do it in silence.
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    link(b, 'dec-1', 'src/collate', 'governs');

    const reading = governingRules([tree(b)], asking('src/collate_test.rb', ['src/collate']));
    expect(reading.rules).toEqual([]);
    // And it is not that nothing was read: the address IS in the project.
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 1,
      stale: 0,
      asks: NO_GATE,
    });
  });

  it('governs everything from the project root, which is an address like any other', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how this repository works');
    link(b, 'dec-1', '.', 'governs');

    const reading = governingRules([tree(b)], asking('src/anywhere/at/all.ts', ['.']));
    expect(addresses(reading.rules)).toEqual(['. → dec-1']);
  });

  it('reads no meaning into any other relation', () => {
    // `rel` is an open string and only ONE label carries an address. A `relates-to`
    // whose target happens to look like a path is not a rule about that path.
    const b = bench();
    birthDecision(b, 'dec-1', 'a call about the collator');
    link(b, 'dec-1', 'src/collate', 'relates-to');
    link(b, 'dec-1', 'src/collate', 'derived-from');

    const reading = governingRules([tree(b)], asking('src/collate/fold.ts', ['src/collate']));
    expect(reading.rules).toEqual([]);
    expect(reading.counts.governing).toBe(0);
  });
});

describe('governance — the order comes from the data', () => {
  it('puts the most specific address first', () => {
    const b = bench();
    birthDecision(b, 'wide', 'how the source tree is laid out');
    birthDecision(b, 'narrow', 'how this one module works');
    link(b, 'wide', 'src', 'governs');
    link(b, 'narrow', 'src/a/b.rb', 'governs');

    const reading = governingRules([tree(b)], asking('src/a/b.rb', ['src', 'src/a/b.rb']));
    expect(addresses(reading.rules)).toEqual(['src/a/b.rb → narrow', 'src → wide']);
  });

  it('breaks a tie by address and then by rule, so the order is total', () => {
    const b = bench();
    birthDecision(b, 'dec-2', 'the second call');
    birthDecision(b, 'dec-1', 'the first call');
    // Two rules at the SAME depth, written in the order that would come back wrong.
    link(b, 'dec-2', 'src/a', 'governs');
    link(b, 'dec-1', 'src/a', 'governs');

    const reading = governingRules([tree(b)], asking('src/a/file.ts', ['src/a']));
    expect(addresses(reading.rules)).toEqual(['src/a → dec-1', 'src/a → dec-2']);
  });
});

describe('governance — three numbers, always', () => {
  it('answers with all three when there is nothing at all', () => {
    const b = bench();
    capture(b, 'mem-1', 'a note that addresses nothing');

    const reading = governingRules([tree(b)], asking('src/whatever.ts'));
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 0,
      stale: 0,
      asks: NO_GATE,
    });
    expect(reading.rules).toEqual([]);
    expect(reading.stale).toEqual([]);
  });

  it('tells an address that has gone stale from one that never existed', () => {
    // The half of G5 this reading owes: a rule whose file was moved or deleted stops
    // governing SILENTLY, and the count is what makes the silence sayable.
    const b = bench();
    birthDecision(b, 'living', 'about the part that is still here');
    birthDecision(b, 'orphan', 'about the part that was deleted');
    link(b, 'living', 'src/here', 'governs');
    link(b, 'orphan', 'src/gone', 'governs');

    const reading = governingRules([tree(b)], asking('src/here/file.ts', ['src/here']));
    expect(reading.counts).toEqual({
      matching: 1,
      governing: 2,
      stale: 1,
      asks: NO_GATE,
    });
    // NAMED, not merely counted — a count of dead addresses is fixed by making the
    // count smaller, and a list is fixed by looking at what it names.
    expect(addresses(reading.stale)).toEqual(['src/gone → orphan']);
    expect(reading.stale[0]?.onDisk).toBe(false);
    expect(reading.rules[0]?.onDisk).toBe(true);
  });

  it('counts the stale ones whatever the question was about', () => {
    // Asking about an unrelated file still reports the project's dead addresses:
    // they are news to whoever asked, and nothing else would report them.
    const b = bench();
    birthDecision(b, 'orphan', 'about the part that was deleted');
    link(b, 'orphan', 'src/gone', 'governs');

    const reading = governingRules([tree(b)], asking('docs/readme.md', ['docs/readme.md']));
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 1,
      stale: 1,
      asks: NO_GATE,
    });
    expect(addresses(reading.stale)).toEqual(['src/gone → orphan']);
  });

  it('counts a rule addressed twice as two addresses', () => {
    // The counts are over ADDRESSES and not over rules, because each address matches
    // or goes stale on its own.
    const b = bench();
    birthDecision(b, 'dec-1', 'one call, two places');
    link(b, 'dec-1', 'src/here', 'governs');
    link(b, 'dec-1', 'src/gone', 'governs');

    const reading = governingRules([tree(b)], asking('src/here/file.ts', ['src/here']));
    expect(reading.counts).toEqual({
      matching: 1,
      governing: 2,
      stale: 1,
      asks: NO_GATE,
    });
  });
});

describe('governance — what it normalizes, and what it does not', () => {
  it('compares a relative path, an absolute one and a climbing one the same way', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    link(b, 'dec-1', 'src/collate', 'governs');
    const sources = [tree(b)];
    const present = ['src/collate'];

    for (const path of [
      'src/collate/fold.ts',
      './src/collate/fold.ts',
      'src//collate//fold.ts',
      'src/collate/',
      'src/other/../collate/fold.ts',
      `${ROOT}/src/collate/fold.ts`,
      `${ROOT}/../repo/src/collate/fold.ts`,
    ]) {
      const reading = governingRules(sources, asking(path, present));
      expect(addresses(reading.rules), path).toEqual(['src/collate → dec-1']);
    }
  });

  it('normalizes the ADDRESS the same way it normalizes the question', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    link(b, 'dec-1', './src/collate/', 'governs');

    const reading = governingRules([tree(b)], asking('src/collate/fold.ts', ['src/collate']));
    expect(addresses(reading.rules)).toEqual(['src/collate → dec-1']);
    // And the record's own bytes travel beside the compared form, never instead of it.
    expect(reading.rules[0]?.recorded).toBe('./src/collate/');
  });

  it('says a path is outside the project rather than answering an empty list', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    link(b, 'dec-1', 'src/collate', 'governs');

    for (const outside of ['/elsewhere/src/collate/fold.ts', '../sibling/src/collate/fold.ts']) {
      const reading = governingRules([tree(b)], asking(outside, ['src/collate']));
      // The absence of a relative path is the answer; the list being empty is not.
      expect(reading.relative, outside).toBeUndefined();
      expect(reading.rules, outside).toEqual([]);
      // And the project's own addresses are still counted, which is what says the
      // mechanism is not empty.
      expect(reading.counts.governing, outside).toBe(1);
    }
  });

  it('treats an address outside the project as addressing nothing here', () => {
    // A rule recorded on another machine with an absolute path of its own. It is not
    // refused and it is not silently dropped: it is an address that names nothing in
    // this working tree, which is exactly what the third count is.
    const b = bench();
    birthDecision(b, 'foreign', 'a call carrying somebody else’s absolute path');
    link(b, 'foreign', '/somebody/else/src/collate', 'governs');

    const reading = governingRules([tree(b)], asking('src/collate/fold.ts', ['src/collate']));
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 1,
      stale: 1,
      asks: NO_GATE,
    });
    expect(reading.stale[0]?.address).toBeUndefined();
    expect(reading.stale[0]?.recorded).toBe('/somebody/else/src/collate');
  });

  it('does not read a backslash as a separator', () => {
    // A backslash is a legal character in a POSIX name, so an address written with
    // one addresses a file whose name contains it — and matches nothing else. The
    // behaviour is DECLARED here rather than fixed: guessing would make one address
    // mean two things.
    const b = bench();
    birthDecision(b, 'dec-1', 'a call written on another kind of machine');
    link(b, 'dec-1', 'src\\collate', 'governs');

    const reading = governingRules([tree(b)], asking('src/collate/fold.ts', ['src/collate']));
    expect(reading.rules).toEqual([]);
    expect(reading.counts.governing).toBe(1);
  });
});

describe('governance — whose addresses these are', () => {
  it('ignores the addresses of another project', () => {
    // An address is relative to A ROOT. A sibling project's `src/` is not this one's,
    // and importing it would make a rule govern code nobody addressed.
    const mine = bench();
    const theirs = bench();
    birthDecision(mine, 'ours', 'our call');
    link(mine, 'ours', 'src', 'governs');
    birthDecision(theirs, 'theirs', 'their call');
    link(theirs, 'theirs', 'src', 'governs');

    const reading = governingRules(
      [tree(mine, 'public', ROOT), tree(theirs, 'public', '/work/other')],
      asking('src/file.ts', ['src']),
    );
    expect(addresses(reading.rules)).toEqual(['src → ours']);
    expect(reading.counts.governing).toBe(1);
  });

  it('ignores the machine-global tree, which belongs to no project', () => {
    const b = bench();
    birthDecision(b, 'personal', 'a convention of mine');
    link(b, 'personal', 'src', 'governs');

    const reading = governingRules([tree(b, 'global')], asking('src/file.ts', ['src']));
    expect(reading.rules).toEqual([]);
    expect(reading.counts.governing).toBe(0);
  });

  it('reads the project’s PRIVATE tree, and says the address came from it', () => {
    // Not refused, and not hidden: a private rule is invisible to a clone, so a charge
    // citing one cites something a teammate cannot open. The reading reports the tree
    // so that whoever charges can decide; deciding it here is not this read's business.
    const b = bench();
    birthDecision(b, 'kept-here', 'a call this machine keeps');
    link(b, 'kept-here', 'src', 'governs');

    const reading = governingRules([tree(b, 'private')], asking('src/file.ts', ['src']));
    expect(addresses(reading.rules)).toEqual(['src → kept-here']);
    expect(reading.rules[0]?.assertedIn).toBe('private');
  });

  it('takes an unlabelled project tree as the asking project’s', () => {
    // The command line's shape: it resolves ONE project's trees and labels neither.
    const b = bench();
    birthDecision(b, 'dec-1', 'a call');
    link(b, 'dec-1', 'src', 'governs');

    const reading = governingRules([tree(b, 'public', undefined)], asking('src/file.ts', ['src']));
    expect(addresses(reading.rules)).toEqual(['src → dec-1']);
  });
});

describe('governance — what a rule IS travels with it, and is never judged', () => {
  it('carries the kind, the name and the state as the record holds them', () => {
    const b = bench();
    birthDecision(b, 'dec-1', 'how collation works');
    moveDecision(b, 'dec-1', 'proposed', 'accepted', 'accept');
    link(b, 'dec-1', 'src', 'governs');

    const [rule] = governingRules([tree(b)], asking('src/file.ts', ['src'])).rules;
    expect(rule).toMatchObject({
      rule: 'dec-1',
      kind: 'decision',
      name: 'how collation works',
      state: 'accepted',
      scope: 'public',
      assertedIn: 'public',
      who: b.who,
    });
  });

  it('reports a rule that no longer holds rather than filtering it out', () => {
    // Deciding "in force" here would be a SECOND rule that can come to disagree with
    // `decisionsInForce`, and the disagreement would be silent. The state travels;
    // the judgement is the caller's.
    const b = bench();
    birthDecision(b, 'old', 'the call that was replaced');
    moveDecision(b, 'old', 'proposed', 'accepted', 'accept');
    moveDecision(b, 'old', 'accepted', 'superseded', 'supersede', { by: 'new' });
    link(b, 'old', 'src', 'governs');

    const [rule] = governingRules([tree(b)], asking('src/file.ts', ['src'])).rules;
    expect(rule?.state).toBe('superseded');
  });

  it('names an adopted pattern the way the record names it', () => {
    const b = bench();
    birthSkill(b, 'skill-1', 'always write the rollback first');
    moveSkill(b, 'skill-1', 'proposed', 'reviewed', 'review');
    moveSkill(b, 'skill-1', 'reviewed', 'adopted', 'adopt');
    link(b, 'skill-1', 'src', 'governs');

    const [rule] = governingRules([tree(b)], asking('src/file.ts', ['src'])).rules;
    expect(rule).toMatchObject({
      kind: 'skill',
      name: 'always write the rollback first',
      state: 'adopted',
    });
  });

  it('reports a rule no visible tree authored, without inventing one', () => {
    const b = bench();
    link(b, 'never-written', 'src', 'governs');

    const [rule] = governingRules([tree(b)], asking('src/file.ts', ['src'])).rules;
    expect(rule?.rule).toBe('never-written');
    expect(rule?.kind).toBeUndefined();
    expect(rule?.name).toBeUndefined();
    expect(rule?.scope).toBeUndefined();
    // And the edge itself is still fully attributed — the assertion is a fact.
    expect(rule?.assertedIn).toBe('public');
  });

  it('gives a memory no name rather than excerpting one', () => {
    const b = bench();
    capture(b, 'mem-1', 'the whole content of a memory, which is not a title');
    link(b, 'mem-1', 'src', 'governs');

    const [rule] = governingRules([tree(b)], asking('src/file.ts', ['src'])).rules;
    expect(rule?.kind).toBe('memory');
    expect(rule?.name).toBeUndefined();
    expect(rule?.state).toBeUndefined();
  });
});

/**
 * P4 — THE BRIEF IS A FUNCTION OF THE RECORD, held over generated records: the same decisions
 * read in any order the trees and their tails can be listed in print the same bytes.
 *
 * `the-document-is-a-function-of-the-record.test.ts` holds the half that asks what the printer
 * may REACH (no clock, no path, no environment). This holds the other half, the one a reader
 * checks with `mnema brief | diff - AGENTS.md`: that nothing about the ORDER the reading met
 * the record in gets into the bytes. Two projects' trees are drawn with a small range of
 * instants, so settled-at ties between decisions of different trees and different tails are
 * the common case, and each is written with its machines opened in a drawn order and read
 * with the trees listed in a drawn order.
 *
 * THE ORACLE is the record as it was drawn: the titles the document lists are exactly the
 * decisions that ended accepted, found by looking at what was written and not by asking the
 * reading what it holds.
 *
 * The seed is fixed so the CI is the same run every time; `FC_SEED` explores another.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  openChainForWriting,
} from '@mnema/chain';
import { type Brief, brief } from '@mnema/context';
import { ProjectionCache } from '@mnema/core';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { briefDocument } from '../src/presentation/brief.js';

vi.setConfig({ testTimeout: 120_000 });

const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const upcasters = catalogUpcasters();
const MACHINES = 2;
const CHANNELS = {
  editPush: 'edit-rules-push',
  asksAPerson: 'edit-asks-a-person',
  refusesAWrite: 'edit-refuses-a-write',
};

const keyRoots: string[] = [];
beforeAll(() => {
  for (let machine = 0; machine < MACHINES; machine += 1) {
    keyRoots.push(mkdtempSync(join(tmpdir(), `mnema-brief-key-${machine}-`)));
  }
});
afterAll(() => {
  for (const dir of keyRoots) rmSync(dir, { recursive: true, force: true });
});

/** One decision of a tree: written by one machine, settled at an instant of the machine's clock. */
interface Rule {
  readonly machine: number;
  readonly born: number;
  readonly settled: number;
  readonly outcome: 'accepted' | 'rejected' | 'open';
}

const ruleArb: fc.Arbitrary<Rule> = fc.record({
  machine: fc.integer({ min: 0, max: MACHINES - 1 }),
  born: fc.integer({ min: 0, max: 3 }),
  settled: fc.integer({ min: 0, max: 3 }),
  outcome: fc.constantFrom('accepted', 'rejected', 'open'),
});

const iso = (second: number): string => new Date(Date.UTC(2026, 6, 21, 0, 0, second)).toISOString();

/** Writes a tree's rules, the machines opened in `open` order; titles are unique across trees. */
function writeTree(
  root: string,
  tree: number,
  rules: readonly Rule[],
  open: readonly number[],
): void {
  const writers = new Map<number, ReturnType<typeof openChainForWriting>>();
  for (const machine of open) {
    if (rules.some((rule) => rule.machine === machine)) {
      writers.set(
        machine,
        openChainForWriting(root, {
          keyRoot: keyRoots[machine] as string,
          maxUnsignedEvents: 10_000,
        }),
      );
    }
  }
  rules.forEach((rule, index) => {
    const writer = writers.get(rule.machine) as ReturnType<typeof openChainForWriting>;
    const id = `dec-${tree}-${index}`;
    const env = (at: number) => ({
      at: iso(at),
      who: writer.anchor,
      signerFp: writer.signerFingerprint,
      subject: id,
    });
    for (const event of decisionBirth(env(rule.born), {
      title: `Rule ${tree}.${index}`,
      rationale: 'because',
      adr: `ADR-${index + 1}`,
      initial: 'proposed',
    })) {
      writer.append(event);
    }
    if (rule.outcome !== 'open') {
      writer.append(
        decisionTransitioned(env(rule.settled), {
          from: 'proposed',
          to: rule.outcome,
          action: rule.outcome === 'accepted' ? 'accept' : 'reject',
          fields: { note: `${rule.outcome} by hand` },
        }),
      );
    }
  });
}

/** The document over the trees, listed in the given order. */
function documentOver(roots: readonly string[]): { bytes: string; titles: string[] } {
  const caches = roots.map((root) => {
    const cache = ProjectionCache.open(root, { upcasters });
    cache.rebuild();
    return { scope: 'public' as const, chainRoot: root, cache };
  });
  try {
    const governance: Brief = brief(caches, CHANNELS);
    return {
      bytes: briefDocument(governance).join('\n'),
      titles: governance.decisions.map((decision) => decision.title),
    };
  } finally {
    for (const { cache } of caches) cache.close();
  }
}

describe('P4: the brief prints the same bytes whatever order the record is met in', () => {
  it('trees listed either way, machines opened in any order: the same bytes, and the rules that were accepted', () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 6 }),
        fc.array(ruleArb, { maxLength: 6 }),
        fc.shuffledSubarray([0, 1], { minLength: 2, maxLength: 2 }),
        fc.shuffledSubarray([0, 1], { minLength: 2, maxLength: 2 }),
        (first, second, openFirst, openSecond) => {
          const dirs = [1, 2, 3, 4].map((n) =>
            mkdtempSync(join(tmpdir(), `mnema-brief-tree-${n}-`)),
          );
          try {
            const [a, b, a2, b2] = dirs as [string, string, string, string];
            writeTree(a, 0, first, [0, 1]);
            writeTree(b, 1, second, [0, 1]);
            // The same two trees again, with the machines opened in another order.
            writeTree(a2, 0, first, openFirst);
            writeTree(b2, 1, second, openSecond);

            const forward = documentOver([a, b]);
            const backward = documentOver([b, a]);
            const reopened = documentOver([b2, a2]);

            expect(backward.bytes).toBe(forward.bytes);
            expect(reopened.bytes).toBe(forward.bytes);

            // What is listed is what was accepted — read off the drawing, not off the reading.
            const accepted = [
              ...first.flatMap((rule, index) =>
                rule.outcome === 'accepted' ? [`Rule 0.${index}`] : [],
              ),
              ...second.flatMap((rule, index) =>
                rule.outcome === 'accepted' ? [`Rule 1.${index}`] : [],
              ),
            ];
            expect([...forward.titles].sort()).toEqual([...accepted].sort());
          } finally {
            for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: SEED, numRuns: 25 },
    );
  });

  it('is drawn with ties between trees, which is where an order would get in', () => {
    // The property above is only as strong as the instants it draws: with four seconds and up to
    // twelve rules, two decisions settled at the same instant are the rule and not the exception.
    const drawn = fc.sample(fc.array(ruleArb, { minLength: 6, maxLength: 6 }), {
      seed: SEED,
      numRuns: 25,
    });
    const tied = drawn.filter((rules) => {
      const seen = new Set<number>();
      return rules.some(
        (rule) =>
          rule.outcome === 'accepted' && (seen.has(rule.settled) || !seen.add(rule.settled)),
      );
    });
    expect(tied.length).toBeGreaterThan(5);
  });
});

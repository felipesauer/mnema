/**
 * THE CUT A HOOK'S TEXT IS MADE BY, held as a property over rules of drawn size: whatever the
 * rules weigh and wherever the ceiling falls, the text never passes it and never ends inside a
 * rule.
 *
 * The cases in `within-a-hook.test.ts` and `brief.test.ts` fix the ceiling at the host's
 * 10,000 units and the rules at the lengths a person picked. What the property adds is the
 * boundary, found by drawing: a room set one unit under, at and one over what some number of
 * rules weighs, which is where an off-by-one in the cut lives, and titles of drawn length in
 * both widths a JavaScript string has (a letter is one unit, an astral character is two).
 *
 * TWO LEVELS, ONE RULE. `fitWhole` is the rule, and it is held against a model that tries every
 * count from the whole down. `briefWithin` is the document the hook carries, and it is held on
 * what a reader depends on: it fits, it is the file's own bullets in the file's own order and
 * whole, and a document that fits is the file byte for byte.
 *
 * The seed is fixed so the CI is the same run every time; `FC_SEED` explores another.
 */

import type { Brief } from '@mnema/context';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { briefDocument, briefWithin } from './brief.js';
import { fitWhole, HOOK_TEXT_CEILING, printedLength } from './within-a-hook.js';

const SEED = Number(process.env.FC_SEED ?? 20_261_007);

describe('what a hook carries is counted the way the host counts', () => {
  it('is the length of the lines each followed by its newline, in UTF-16 units', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: 'binary', maxLength: 30 }), { maxLength: 8 }),
        (lines) => {
          expect(printedLength(lines)).toBe(lines.map((line) => `${line}\n`).join('').length);
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('the cut: whole items, the most that fit, never past the room', () => {
  /** A text of `items`, a heading, and a declaration of what was left out when anything was. */
  const composing =
    (items: readonly string[]) =>
    (shown: number): string[] => [
      'head',
      ...items.slice(0, shown),
      ...(shown < items.length ? [`${items.length - shown} left out`] : []),
    ];

  /** Items of drawn weight, in both widths. */
  const itemsArb = fc.array(
    fc
      .array(fc.constantFrom('a', 'é', '😀', 'ab', '日本'), { minLength: 1, maxLength: 40 })
      .map((parts) => parts.join('')),
    { maxLength: 30 },
  );

  it('returns the largest composition that fits, and that composition is whole', () => {
    fc.assert(
      fc.property(itemsArb, fc.nat({ max: 30 }), fc.constantFrom(-1, 0, 1), (items, at, delta) => {
        const compose = composing(items);
        const total = items.length;
        // A room set against what `at` items weigh, one under, at or one over.
        const room = printedLength(compose(Math.min(at, total))) + delta;
        // The text with nothing shown is what the cut can always fall back on; a room under it
        // is not a state the texts this binds reach.
        fc.pre(room >= printedLength(compose(0)));

        const cut = fitWhole(total, room, compose);

        // THE MODEL: try every count from the whole down, take the first that fits.
        let largest = 0;
        for (let shown = total; shown >= 0; shown -= 1) {
          if (printedLength(compose(shown)) <= room) {
            largest = shown;
            break;
          }
        }
        expect(cut).toEqual(compose(largest));
        expect(printedLength(cut)).toBeLessThanOrEqual(room);
      }),
      { seed: SEED, numRuns: 500 },
    );
  });
});

describe('the document a hook carries', () => {
  /** What governs, as the composition hands it over — the fields the document reads. */
  function governance(decisions: readonly string[], patterns: readonly string[]): Brief {
    return {
      decisions: decisions.map((title, at) => ({
        id: `0198f3c1-7a2e-7b41-9c05-3d8e6f2a${String(at).padStart(4, '0')}`,
        adr: `ADR-${at + 1}`,
        title,
      })),
      skills: patterns.map((name, at) => ({
        id: `0198f3c1-7a2e-7b41-9c05-3d8e6f2b${String(at).padStart(4, '0')}`,
        name,
      })),
      collisions: [],
      divergent: [],
      addressed: 0,
      asking: 0,
      refusing: 0,
      decisionsAwaiting: 0,
      skillsAwaiting: 0,
      editPush: { channel: 'edit-rules-push', on: true },
      asksAPerson: { channel: 'edit-asks-a-person', on: true },
      refusesAWrite: { channel: 'edit-refuses-a-write', on: true },
    };
  }

  const titleArb = fc
    .array(fc.constantFrom('the invoice run ', 'retries ', '😀', 'é', 'x'), {
      minLength: 1,
      maxLength: 60,
    })
    .map((parts) => `A call about ${parts.join('')}`.trimEnd());

  const bullets = (lines: readonly string[]): string[] =>
    lines.filter((line) => line.startsWith('- **'));

  it('fits the room, is the file’s own rules in the file’s own order and whole, and is the file when the file fits', () => {
    fc.assert(
      fc.property(
        fc.array(titleArb, { maxLength: 70 }),
        fc.array(titleArb, { maxLength: 8 }),
        fc.nat({ max: HOOK_TEXT_CEILING }),
        (decisions, patterns, slack) => {
          const brief = governance(decisions, patterns);
          const file = briefDocument(brief);
          // Every room from what the fixed part needs up to the host's ceiling.
          const floor = printedLength(briefWithin(brief, 0));
          fc.pre(floor <= HOOK_TEXT_CEILING);
          const room = Math.min(HOOK_TEXT_CEILING, floor + slack);
          const hook = briefWithin(brief, room);

          expect(printedLength(hook)).toBeLessThanOrEqual(room);
          // Whole rules, the file's first ones: a rule is in as it was printed, or it is out.
          const shown = bullets(hook);
          expect(shown).toEqual(bullets(file).slice(0, shown.length));
          // A file that fits the room is handed over untouched.
          if (printedLength(file) <= room) expect(hook).toEqual(file);
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});

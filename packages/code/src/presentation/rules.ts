/**
 * FORM A applied to the rules that govern a path: the address, what the rule IS,
 * and where it lives — one line per rule, under a heading that counts them.
 *
 * IT OPENS WITH THE NUMBERS AND THEY ARE NEVER OMITTED, including when every one of
 * them is zero. A reading that printed only the matching rules would give the same page
 * to three different worlds: a project whose record addresses nothing, a project
 * whose addresses all point elsewhere, and a project whose addresses have gone
 * stale because the files moved. The first line separates them, and it is what makes
 * an empty list an ANSWER rather than a silence.
 *
 * THE GATE IS ON THAT LINE TOO, AND ITS ABSENCE WAS THE HOLE. The record can now hold a
 * rule that ASKS FOR A PERSON at a path, and a rule of that kind stops somebody's write.
 * A page that reported which rules govern a file and said nothing about which of them
 * gates it would leave the person whose work just stopped with no reading that explains
 * it: the refusal cites an id, and this is where an id is looked up. So the gate gets its
 * own second line — the same three numbers for the other relation — and its own group when
 * anything is in it, printed whatever was asked about for the reason the stale group is:
 * a gate that has gone stale stops nobody, silently, and only a number that names it
 * separately can be looked at.
 *
 * THE STALE GROUP IS NAMED, NOT ONLY COUNTED. A count of dead addresses goes down by
 * making the count go down; a list of them goes down by looking at what it names.
 * The group is printed whenever it is non-empty, whatever was asked about, because
 * a rule that has stopped governing is news to whoever asked — that is the half of
 * G5 this reading owes.
 *
 * EVERY VALUE ON A ROW CAME OUT OF THE RECORD, so every one of them is collapsed to
 * one line: the address a caller typed into `--rel governs`, the title of the rule,
 * and the rule's own id — which is a caller's string too, since a link's subject is
 * forwarded to the chain without being verified to exist. The words between them are
 * this surface's own.
 */

import type { AddressedRule, GoverningRules } from '@mnema/copilot';
import { oneLine } from '../one-line.js';
import { fact, subjectLine } from './detail.js';
import { asId, asScope, itemLine } from './items.js';
import type { Render } from './render.js';
import { asState } from './state.js';

/** The lines a governance reading prints for a person. */
export function rulesReport(render: Render, governed: GoverningRules): string[] {
  const { counts } = governed;
  const lines = [
    render(
      subjectLine(
        oneLine(governed.relative ?? governed.path),
        governed.relative === undefined ? 'outside this project' : 'in this project',
      ),
    ),
    render(
      fact(
        `${counts.matching} govern this path · ${counts.governing} address this project · ` +
          `${counts.stale} address nothing here`,
      ),
    ),
    // A SECOND LINE AND NOT MORE COLUMNS ON THE FIRST. The two relations answer different
    // questions and a reader scanning for "is this file gated" should not have to find the
    // fourth number of six on one line. It prints whether or not anything asks, because
    // zero here is the answer people will most often need and a missing line reads as a
    // product that has no such mechanism.
    render(
      fact(
        `${counts.asks.matching} ask for a person here · ${counts.asks.addressed} ask in ` +
          `this project · ${counts.asks.stale} ask about nothing here`,
      ),
    ),
  ];
  /**
   * One rule as the columns of a row: where it applies, what it is, its state, its
   * id and the tree that asserts it.
   *
   * The ADDRESS leads, because the list is ordered by it and a reader scanning for
   * "which rule is the specific one" is scanning that column. What the rule IS comes
   * second, and it is the one field that can be missing — a memory has no title of
   * its own, and an id no visible tree authored has nothing at all — so the kind, or
   * the word `unresolved`, stands in its place rather than an empty column. Every
   * column is written HERE rather than in a helper that returns the array: a value
   * built behind a function call is a value the layer's own guard cannot see, which
   * is how this row hid five of its fields on the first writing of it.
   */
  const row = (rule: AddressedRule): string => {
    const said =
      rule.name !== undefined
        ? oneLine(rule.name)
        : rule.kind !== undefined
          ? `(${rule.kind})`
          : '(unresolved)';
    return render(
      itemLine([
        oneLine(rule.address ?? rule.recorded),
        said,
        // The STATE is a part of its own, never composed into the title beside it —
        // the one place its parentheses and its news are decided is `state.ts`. A
        // rule of a kind with no state (a memory) rides without one.
        ...(rule.state === undefined ? [] : [asState(oneLine(rule.state))]),
        asId(oneLine(rule.rule)),
        asScope(`[${rule.assertedIn}]`),
      ]),
    );
  };
  const group = (heading: string, rules: readonly AddressedRule[]) => {
    if (rules.length === 0) return;
    lines.push('');
    lines.push(`${heading} (${rules.length})`);
    lines.push(...rules.map(row));
  };
  group('governing this path, most specific first', governed.rules);
  group('asking for a person here, most specific first', governed.asks);
  group('addressing nothing in the working tree', governed.stale);
  group('asking about nothing in the working tree', governed.asksStale);
  return lines;
}

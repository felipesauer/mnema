/**
 * The lines `mnema` prints when it is typed with nothing after it: what the product does in a
 * sentence (the promise, verbatim), where this project stands, what is off and the verb that turns
 * it on, three verbs to go on with, and where the rest is.
 *
 * Outside a project the state lines are not there and the first verb founds one.
 */

import type { Summary } from '../commands/summary.js';
import { PRODUCT_PROMISE } from '../promise.js';
import { SWITCH_ON_COMMAND } from '../record-framing.js';

/** The summary, one string per line. */
export function summaryLines(summary: Summary): string[] {
  const lines = [PRODUCT_PROMISE];
  if (summary.founded) {
    lines.push('A mnema project is founded here.');
    if (summary.waiting !== undefined && summary.waiting > 0) {
      lines.push(
        `${summary.waiting} decision(s) await a judgement: \`mnema decision review\` goes through them.`,
      );
    }
  }
  if (summary.off.length > 0) {
    lines.push(
      `Off on this machine: ${summary.off.join(', ')}. Turn one on with \`${SWITCH_ON_COMMAND}\`.`,
    );
  }
  lines.push(
    'Next:',
    summary.founded
      ? '  `mnema status`                                where things stand'
      : '  `mnema init`                                  found a project in this directory',
    '  `mnema decision record <title> <rationale>`   record a choice that was settled',
    '  `mnema switch`                                what is on and what is off',
    '`mnema --help` lists every command.',
  );
  return lines;
}

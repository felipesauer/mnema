// @reads-the-tree
/**
 * THE PAGE THAT SAYS WHERE A RULE ARRIVES IS THE TABLE THE HOST CASES HOLD, and the table says
 * only what it can back.
 *
 * `docs/rule-arrival.md` shows `host-contract/support/the-arrival-table.ts`, rendered between two
 * marks, and each host's case (`host-contract/the-rule-arrives.*.test.ts`) starts the real host
 * and requires every cell the table calls measured to be what the host did. So the page cannot say
 * a thing the cases do not hold, and a cell cannot change without the page changing with it. A
 * person who changes the table updates the page with
 * `pnpm vitest run packages/code/tests/the-arrival-page-is-the-table.test.ts -u`.
 *
 * WHAT ELSE IS HELD HERE, from the table alone, since the host cases need a binary and run in
 * their own jobs:
 *  - THE CONTROL IS NEVER "ARRIVED". The place that keeps the rule nowhere must be absent at every
 *    moment of every host, or a reading that finds the sentinel does not come from the rule.
 *  - EVERY CELL THAT IS NOT A READING SAYS WHY, in words, and a reason is not a placeholder.
 *  - EVERY HOST HAS A CASE FILE, and a measured moment is one that file takes.
 *
 * NOT HELD: that a cell is true of a host. That is the host cases'.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARMS, ARRIVAL_HOSTS, MOMENTS } from './host-contract/support/the-arms-of-a-rule.js';
import {
  isMeasured,
  renderTheTable,
  THE_TABLE,
  theCell,
} from './host-contract/support/the-arrival-table.js';
import { ROOT, read } from './support/published-examples.js';

const PAGE = 'docs/rule-arrival.md';
const BEGIN = '<!-- BEGIN the table:';
const END = '<!-- END the table -->';

/** The page with what lies between its two marks replaced by `table`. */
function pageWith(page: string, table: string): string {
  const begin = page.indexOf(BEGIN);
  const end = page.indexOf(END);
  if (begin < 0 || end < begin) throw new Error(`${PAGE} has no marks to put the table between`);
  const afterBegin = page.indexOf('-->', begin) + '-->'.length;
  return `${page.slice(0, afterBegin)}\n\n${table}\n\n${page.slice(end)}`;
}

describe('the page that says where a rule arrives', () => {
  it('shows the table the host cases hold, between its marks', async () => {
    await expect(pageWith(read(PAGE), renderTheTable())).toMatchFileSnapshot(join(ROOT, PAGE));
  });

  it('has a row for every place a rule is kept, for every host, and a column for every moment', () => {
    const table = renderTheTable();
    for (const host of ARRIVAL_HOSTS) {
      for (const arm of ARMS) {
        for (const moment of MOMENTS) {
          expect(theCell(host, arm, moment), `${host} ${arm} ${moment}`).toBeDefined();
        }
      }
    }
    // NON-VACUITY: the page lists a section for each host and a cell that was read.
    expect(table.match(/^### /gm)).toHaveLength(ARRIVAL_HOSTS.length);
    expect(table).toContain('| arrived |');
    expect(table).toContain('not arrived');
  });

  it('never calls the control arrived', () => {
    for (const host of ARRIVAL_HOSTS) {
      for (const moment of MOMENTS) {
        expect(theCell(host, 'control', moment).is, `${host} ${moment}`).not.toBe('arrived');
      }
    }
  });

  it('says why for every cell that is not a reading, and the why is a sentence', () => {
    let said = 0;
    for (const host of ARRIVAL_HOSTS) {
      for (const arm of ARMS) {
        for (const moment of MOMENTS) {
          const cell = theCell(host, arm, moment);
          if (cell.is !== 'not-applicable' && cell.is !== 'not-measured') continue;
          said += 1;
          expect(cell.why.split(/\s+/).length, `${host} ${arm} ${moment}`).toBeGreaterThan(6);
          expect(cell.why).not.toMatch(/placeholder|todo|probe/i);
        }
      }
    }
    expect(said).toBeGreaterThan(0);
  });

  it('measures something for every host', () => {
    for (const host of ARRIVAL_HOSTS) {
      const measured = ARMS.flatMap((arm) =>
        MOMENTS.filter((moment) => isMeasured(theCell(host, arm, moment))),
      );
      expect(measured.length, host).toBeGreaterThan(6);
    }
    expect(Object.keys(THE_TABLE)).toEqual([...ARRIVAL_HOSTS]);
  });

  it('names a case file for every host, and the file is in the tree', () => {
    const files: Record<string, string> = {
      'claude-code': 'the-rule-arrives.test.ts',
      codex: 'the-rule-arrives.codex.test.ts',
      opencode: 'the-rule-arrives.opencode.test.ts',
      copilot: 'the-rule-arrives.copilot.test.ts',
      gemini: 'the-rule-arrives.gemini.test.ts',
      qwen: 'the-rule-arrives.qwen.test.ts',
    };
    const page = read(PAGE);
    expect(Object.keys(files)).toEqual([...ARRIVAL_HOSTS]);
    for (const file of Object.values(files)) {
      expect(() => read(`packages/code/tests/host-contract/${file}`), file).not.toThrow();
      expect(page, file).toContain(file.replace('.test.ts', ''));
    }
  });
});

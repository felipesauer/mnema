/**
 * ANTIGRAVITY'S COMMAND LINE RISES ABOVE THE FIRST RUNG ONLY WITH A CAPTURE.
 *
 * Antigravity's command line (`agy`) is a closed binary that signs a person in to Google and is
 * installed under terms the person accepts, so no job of this repository starts it: what is known
 * of it above the MCP server and a rules file is read by a person, on a machine that has it, from
 * `plugin/captures/antigravity-cli-script.md`, and kept as a dated file
 * (`plugin/captures/antigravity-cli-<date>.json`). Until one is committed, the row of the host table
 * says `not ported` for the opening, the refusal and the pause, and the pages say nothing about
 * them.
 *
 * A row that climbs without a capture is a claim about a host nobody has read running, in the one
 * place the pages take the rung from. This is red when it does, and when a cell climbs on a day no
 * committed capture is dated.
 *
 * The script and the template of the capture name the same cases, so a case added to one and not
 * the other is red here as well.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Cell, HOSTS } from '../src/host-names.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const CAPTURES = join(ROOT, 'plugin', 'captures');
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The days, written as the pages write them (`12 October 2026`), of the captures committed. */
function captureDays(): string[] {
  return readdirSync(CAPTURES)
    .map((file) => /^antigravity-cli-(\d{4})-(\d{2})-(\d{2})\.json$/.exec(file))
    .filter((match) => match !== null)
    .map((match) => `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`);
}

/** A cell of the command line's row, as the type every row's cells have. */
const cellOf = (capability: 'opens' | 'refuses' | 'asks'): Cell =>
  HOSTS.antigravity.cells[capability];

describe("Antigravity's command line, above the first rung", () => {
  it('has a cell above it only where a capture of that day is committed', () => {
    const days = captureDays();
    for (const capability of ['opens', 'refuses', 'asks'] as const) {
      const cell = cellOf(capability);
      if (cell.held === 'not ported') continue;
      const read = 'read' in cell ? cell.read : '';
      expect(
        days.some((day) => read.includes(day)),
        `${capability} climbs on "${read}", with captures of [${days}]`,
      ).toBe(true);
    }
  });

  it('is documented, not measured, in the first rung', () => {
    for (const capability of ['server', 'rulesFile'] as const) {
      expect(HOSTS.antigravity.cells[capability].held).toBe('documentation');
    }
  });
});

describe('the script and the template of a capture of the command line', () => {
  const script = readFileSync(join(CAPTURES, 'antigravity-cli-script.md'), 'utf-8');
  const template = JSON.parse(
    readFileSync(join(CAPTURES, 'antigravity-cli-capture.template.json'), 'utf-8'),
  ) as { cases: { id: string }[]; host: { name: string } };

  it('name the same cases', () => {
    const named = [...script.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    expect(named).toEqual(template.cases.map((one) => one.id));
  });

  it("say it is Antigravity's command line that was read, not its editor", () => {
    expect(template.host.name).toBe("Antigravity's command line (agy)");
  });
});

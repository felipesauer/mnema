/**
 * THE CASES OF ONE HOST'S ROW OF THE TABLE: one case per place a rule is kept, which starts the
 * host as many times as it needs, reads what it sent, and requires every cell the table calls
 * measured to be what the host did.
 *
 * What a host's file does is only how the host is started and read (`measure`); what each cell
 * must be is `the-arrival-table.ts`, shared, so that the table and the measurement cannot drift
 * apart. A moment the file does not take, where the table calls it measured, is red; a moment the
 * file takes where the table does not call it measured is read and not compared, so that a cell
 * moves from "not measured" to a reading by changing the table.
 */

import { expect, it } from 'vitest';
import type { TheFilesToPut } from './a-sandbox.js';
import {
  ARMS,
  type Arm,
  type ArrivalHost,
  MOMENTS,
  type Moment,
  theFilesOf,
  theRecordOf,
} from './the-arms-of-a-rule.js';
import { theCell, theMomentsMeasured } from './the-arrival-table.js';
import type { TheProject } from './the-record-to-stand-on.js';

/** What one arm of one host was seen to do at the moments that were taken. */
export interface WhatArrived {
  readonly arrived: Partial<Record<Moment, boolean>>;
  /** For the arm that mentions the file: whether the mention reached the model at the start. */
  readonly mentioned?: boolean;
}

/** What `measure` is handed to start the host with. */
export interface TheArmToMeasure {
  readonly arm: Arm;
  readonly files: TheFilesToPut;
  readonly record: ((project: TheProject) => void) | undefined;
}

/**
 * Registers a case for each arm of `host` that is a way to keep a rule there.
 *
 * @param taken - the moments `measure` reads, so that a cell the table calls measured at another
 *   moment is red and not silently skipped.
 */
export function theRowOf(
  host: ArrivalHost,
  taken: readonly Moment[],
  measure: (armToMeasure: TheArmToMeasure) => Promise<WhatArrived>,
): void {
  for (const arm of ARMS) {
    const files = theFilesOf(host, arm);
    if (files === undefined) continue;
    it(`${arm}: every cell the table calls measured is what the host did`, async () => {
      const measured = theMomentsMeasured(host, arm);
      expect(
        measured.filter((moment) => !taken.includes(moment)),
        'the table calls a moment measured that this file does not take',
      ).toEqual([]);
      const seen = await measure({ arm, files, record: theRecordOf(arm) });
      // What was read, whole, so a red job says what the host did and not only which cell differed.
      console.log(`arrival ${host} ${arm} ${JSON.stringify(seen)}`);
      for (const moment of MOMENTS) {
        const cell = theCell(host, arm, moment);
        if (cell.is !== 'arrived' && cell.is !== 'not-arrived') continue;
        expect(seen.arrived[moment], `${host} ${arm} ${moment}`).toBe(cell.is === 'arrived');
      }
      const start = theCell(host, arm, 'start');
      if (start.is === 'not-arrived' && start.mentioned !== undefined) {
        expect(seen.mentioned, `${host} ${arm}: the mention`).toBe(start.mentioned);
      }
    }, 600_000);
  }
}

/**
 * The doctor and the plugin's hook each say a binary is older than a plugin, and they must agree:
 * the hook runs with no build and cannot import the doctor's comparison, so the two are written
 * twice and held to one table here.
 */

import { describe, expect, it } from 'vitest';
import { isOlderThan as theHooks } from '../../../plugin/hooks/hand-over.mjs';
import { isOlderThan as theDoctors } from '../src/version.js';

const TABLE: ReadonlyArray<readonly [string, string, boolean]> = [
  ['0.1.0', '0.1.1', true],
  ['0.1.1', '0.1.1', false],
  ['0.1.2', '0.1.1', false],
  ['0.9.9', '0.10.0', true],
  ['1.0.0', '0.99.99', false],
  ['0.2.0-beta', '0.2.0', false],
  ['0.1.9-beta', '0.2.0-beta', true],
  ['unknown', '0.1.1', false],
  ['0.1.0', 'unknown', false],
  ['', '', false],
];

describe('which of two versions is the older', () => {
  it.each(TABLE)(
    'says %s against %s is %s, in the hook and in the doctor',
    (version, than, older) => {
      expect(theHooks(version, than)).toBe(older);
      expect(theDoctors(version, than)).toBe(older);
    },
  );
});

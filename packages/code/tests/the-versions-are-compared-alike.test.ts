/**
 * The doctor and the plugin's hook each say a binary is older than a plugin, and they must agree:
 * the hook runs with no build and cannot import the doctor's comparison, so the two are written
 * twice and held to one table here.
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isOlderThan as theDoctors } from '../src/version.js';

const HAND_OVER = join(
  fileURLToPath(new URL('../../../', import.meta.url)),
  'plugin',
  'hooks',
  'hand-over.mjs',
);
const { isOlderThan: theHooks } = (await import(pathToFileURL(HAND_OVER).href)) as {
  isOlderThan: (version: string, than: string) => boolean;
};

const TABLE: ReadonlyArray<readonly [string, string, boolean]> = [
  ['2.4.0', '2.5.0', true],
  ['2.5.0', '2.5.0', false],
  ['2.5.1', '2.5.0', false],
  ['0.9.9', '0.10.0', true],
  ['1.0.0', '0.99.99', false],
  ['0.2.0-beta', '0.2.0', false],
  ['0.1.9-beta', '0.2.0-beta', true],
  ['unknown', '2.5.0', false],
  ['2.4.0', 'unknown', false],
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

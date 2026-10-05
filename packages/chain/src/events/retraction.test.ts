/**
 * Who may take a note back: the identity that wrote it, and no other. The anchor is compared,
 * not the key — a second key of the identity carries the same anchor, which is what lets it
 * retract (`core/src/knowledge/only-the-identity-that-wrote-a-note-retracts-it.test.ts` drives
 * that through an enrolled key).
 */

import { describe, expect, it } from 'vitest';
import { mayRetract } from './retraction.js';

const AUTHOR = `mnid:${'a'.repeat(64)}`;
const STRANGER = `mnid:${'b'.repeat(64)}`;

describe('who may retract a note', () => {
  it('is the identity that wrote it', () => {
    expect(mayRetract(AUTHOR, AUTHOR)).toBe(true);
  });

  it('is not another identity', () => {
    expect(mayRetract(AUTHOR, STRANGER)).toBe(false);
  });
});

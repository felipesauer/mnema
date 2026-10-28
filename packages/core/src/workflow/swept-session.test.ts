import { describe, expect, it } from 'vitest';
import { lastSeenOfSweptTask, sweptReason } from './swept-session.js';

const SEEN = '2026-10-01T10:00:00.000Z';
const block = (said: string, at = '2026-10-28T00:00:00.000Z') => ({ action: 'block', at, said });

describe('the task of a session nobody saw end', () => {
  it('writes the reason with the count and the time, and no more', () => {
    expect(sweptReason(1, 0, SEEN)).toBe(
      `The session stopped with no end, so how it ended is unknown. It was last seen at ${SEEN}; 1 handoff was recorded in it.`,
    );
    expect(sweptReason(2, 1, SEEN)).toContain(
      '2 handoffs were recorded in it. 1 dispatch was not mirrored.',
    );
  });

  it('reads back when the session was last seen from the reason it wrote', () => {
    expect(lastSeenOfSweptTask('BLOCKED', [block(`reason: ${sweptReason(3, 2, SEEN)}`)])).toBe(
      SEEN,
    );
  });

  it('falls back to the block itself when the reason has no time that reads', () => {
    const said = 'reason: The session stopped with no end, so how it ended is unknown.';
    expect(lastSeenOfSweptTask('BLOCKED', [block(said, '2026-10-02T00:00:00.000Z')])).toBe(
      '2026-10-02T00:00:00.000Z',
    );
  });

  it('is not a sweep when a person wrote the reason, or the task is not blocked now', () => {
    expect(
      lastSeenOfSweptTask('BLOCKED', [block('reason: waiting on the vendor')]),
    ).toBeUndefined();
    expect(lastSeenOfSweptTask('BLOCKED', undefined)).toBeUndefined();
    expect(
      lastSeenOfSweptTask('IN_PROGRESS', [block(`reason: ${sweptReason(0, 0, SEEN)}`)]),
    ).toBeUndefined();
  });

  it('judges the last block only', () => {
    const sweep = block(`reason: ${sweptReason(0, 0, SEEN)}`);
    expect(lastSeenOfSweptTask('BLOCKED', [sweep, block('reason: no key yet')])).toBeUndefined();
    expect(lastSeenOfSweptTask('BLOCKED', [block('reason: no key yet'), sweep])).toBe(SEEN);
  });
});

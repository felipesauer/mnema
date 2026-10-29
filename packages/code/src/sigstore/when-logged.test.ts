import { describe, expect, it } from 'vitest';
import { whenLogged } from './when-logged.js';

describe('the time a log line says', () => {
  it('names the time and whose clock it is', () => {
    expect(whenLogged({ loggedAt: '2026-10-29T15:43:34.000Z', loggedAtBy: 'rekor' })).toBe(
      'at 2026-10-29T15:43:34.000Z',
    );
    expect(
      whenLogged({ loggedAt: '2026-10-29T15:43:34.000Z', loggedAtBy: 'timestamp-authority' }),
    ).toBe('at 2026-10-29T15:43:34.000Z (timestamp authority)');
  });

  it('says the log carried no time, never a date', () => {
    expect(whenLogged({})).toBe('(time not carried)');
  });
});

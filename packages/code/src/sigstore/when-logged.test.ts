import { describe, expect, it } from 'vitest';
import { whenLogged } from './when-logged.js';

describe('the time a log line says', () => {
  it('names the time and whose clock it is', () => {
    expect(whenLogged({ loggedAt: '2026-10-29T15:43:34.000Z', loggedAtBy: 'rekor' })).toBe(
      'by Rekor at 2026-10-29T15:43:34.000Z',
    );
    expect(
      whenLogged({ loggedAt: '2026-10-29T15:43:34.000Z', loggedAtBy: 'timestamp-authority' }),
    ).toBe('in Rekor, timestamped by the timestamp authority at 2026-10-29T15:43:34.000Z');
  });

  it('says the log carried no time, never a date', () => {
    expect(whenLogged({})).toBe('in Rekor (time not carried)');
  });
});

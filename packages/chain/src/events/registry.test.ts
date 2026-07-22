import { describe, expect, it } from 'vitest';
import { runEnded, runStarted, taskCreated, taskTransitioned } from './build.js';
import { canonicalStringify } from './canonical.js';
import { parseEvent, toCanonical } from './parse.js';
import { catalogUpcasters } from './registry.js';

const env = { at: '2026-07-21T00:00:00.000Z', who: 'mnid:aa', signerFp: 'fp-1', subject: 's-1' };

describe('catalogUpcasters', () => {
  it('round-trips every catalog kind through build → canonical → parse', () => {
    const reg = catalogUpcasters();
    const events = [
      runStarted({ ...env, subject: 'r-1' }, { agent: 'claude' }),
      runEnded({ ...env, subject: 'r-1' }, { outcome: 'done' }),
      taskCreated({ ...env, subject: 't-1' }, { title: 'thing' }),
      taskTransitioned({ ...env, subject: 't-1' }, { from: 'a', to: 'b', action: 'go' }),
    ];
    for (const event of events) {
      const parsed = parseEvent(canonicalStringify(toCanonical(event)), reg);
      expect(parsed).toEqual(event);
    }
  });
});

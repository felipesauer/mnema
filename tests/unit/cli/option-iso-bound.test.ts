import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';

import { parseIsoBoundOption } from '@/cli/option-helpers.js';

describe('parseIsoBoundOption', () => {
  it('accepts strict ISO-8601 dates and instants', () => {
    for (const v of ['2026-01-01', '2026-07-13T00:00:00Z', '2026-07-13T12:30:45.123Z']) {
      expect(parseIsoBoundOption(v), v).toBe(v);
    }
  });

  it('rejects a relative duration (unlike the audit window) with a loud error', () => {
    // The query/observation bounds are ISO-only — a `30d`-style value that the
    // audit window would accept must fail here, not fall open to a full scan.
    for (const v of ['30d', '2h', '30days']) {
      expect(() => parseIsoBoundOption(v), v).toThrow(InvalidArgumentError);
    }
  });

  it('rejects free-form and impossible dates', () => {
    for (const v of ['last week', '2026-13-40', '2026-02-30', 'notadate', '']) {
      expect(() => parseIsoBoundOption(v), v).toThrow(InvalidArgumentError);
    }
  });
});

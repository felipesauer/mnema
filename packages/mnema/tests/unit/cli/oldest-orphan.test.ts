import { describe, expect, it } from 'vitest';

import { oldestOrphan } from '@/cli/commands/doctor-command.js';

describe('oldestOrphan', () => {
  it('returns the entry with the greatest ageHours (the true oldest)', () => {
    // Oldest-first, as findRunning/findOrphanRuns produce it: age descends.
    const orphans = [{ ageHours: 358 }, { ageHours: 200 }, { ageHours: 124 }];
    expect(oldestOrphan(orphans)?.ageHours).toBe(358);
  });

  it('does not depend on array order', () => {
    const orphans = [{ ageHours: 124 }, { ageHours: 358 }, { ageHours: 200 }];
    expect(oldestOrphan(orphans)?.ageHours).toBe(358);
  });

  it('returns the reported age equal to the maximum age', () => {
    const orphans = [{ ageHours: 5 }, { ageHours: 9 }, { ageHours: 7 }];
    const reported = oldestOrphan(orphans)?.ageHours;
    expect(reported).toBe(Math.max(...orphans.map((o) => o.ageHours)));
  });

  it('returns undefined for an empty list', () => {
    expect(oldestOrphan([])).toBeUndefined();
  });
});

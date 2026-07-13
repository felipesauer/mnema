import { describe, expect, it } from 'vitest';

import { isRoadmapMirrorStem } from '@/cli/commands/doctor-command.js';

describe('isRoadmapMirrorStem', () => {
  it('accepts shaped entity keys (<PROJECT>-ADR-N / <PROJECT>-EPIC-N)', () => {
    for (const stem of ['TEST-ADR-1', 'WEBAPP-EPIC-42', 'A1-ADR-999', 'MNEMA-EPIC-18']) {
      expect(isRoadmapMirrorStem(stem), stem).toBe(true);
    }
  });

  it('rejects free-form human roadmap stems the scaffold invites', () => {
    for (const stem of [
      '2026-Q2',
      'north-star',
      'roadmap-2027',
      'TEST-1', // a task key, not a roadmap entity
      'TEST-ADR', // no number
      'TEST-EPIC-', // trailing dash, no number
      'test-adr-1', // lowercase project
      'TEST-STORY-1', // unknown entity kind
    ]) {
      expect(isRoadmapMirrorStem(stem), stem).toBe(false);
    }
  });
});

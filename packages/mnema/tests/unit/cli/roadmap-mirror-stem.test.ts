import { describe, expect, it } from 'vitest';

import { isRoadmapMirrorStem } from '@/cli/commands/doctor-command.js';

describe('isRoadmapMirrorStem', () => {
  it('accepts a decision key (<PROJECT>-ADR-N) or an epic id (a UUID)', () => {
    for (const stem of [
      'TEST-ADR-1',
      'A1-ADR-999',
      // An epic's committed id — epics are filed by id now.
      '019f7700-0000-7000-8000-000000000e01',
      '019f76e4-e277-773a-865e-76f4170a644e',
    ]) {
      expect(isRoadmapMirrorStem(stem), stem).toBe(true);
    }
  });

  it('rejects free-form human roadmap stems and bare epic keys', () => {
    for (const stem of [
      '2026-Q2',
      'north-star',
      'roadmap-2027',
      'TEST-1', // a task key, not a roadmap entity
      'WEBAPP-EPIC-42', // an epic KEY — epics are id-named, so this is not a stem
      'TEST-ADR', // no number
      'TEST-EPIC-', // trailing dash, no number
      'test-adr-1', // lowercase project
      'TEST-STORY-1', // unknown entity kind
      '019f7700-0000-7000-8000', // truncated UUID
    ]) {
      expect(isRoadmapMirrorStem(stem), stem).toBe(false);
    }
  });
});

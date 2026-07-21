import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, isTaskState, TASK_STATES } from './states.js';

describe('task states', () => {
  it('has exactly the seven workflow states', () => {
    expect([...TASK_STATES]).toEqual([
      'DRAFT',
      'READY',
      'IN_PROGRESS',
      'BLOCKED',
      'IN_REVIEW',
      'DONE',
      'CANCELED',
    ]);
  });

  it('is born into DRAFT', () => {
    expect(INITIAL_STATE).toBe('DRAFT');
    expect(isTaskState(INITIAL_STATE)).toBe(true);
  });

  it('isTaskState recognizes only the known states', () => {
    for (const s of TASK_STATES) expect(isTaskState(s)).toBe(true);
    expect(isTaskState('draft')).toBe(false); // case-sensitive
    expect(isTaskState('TODO')).toBe(false);
    expect(isTaskState('')).toBe(false);
  });
});

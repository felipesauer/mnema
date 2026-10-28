import type { Bootstrap } from '@mnema/context';
import { describe, expect, it } from 'vitest';
import { statusReport } from '../src/presentation/status.js';

const opening = (over: Record<string, unknown>): Bootstrap =>
  ({
    resume: { lastRun: null },
    work: [],
    workTotal: 0,
    skills: [],
    decisions: [],
    decisionsTotal: 0,
    awaitingJudgement: [],
    awaitingJudgementTotal: 0,
    ...over,
  }) as unknown as Bootstrap;

const said = (status: Bootstrap): string[] =>
  statusReport((line) => String(line), status, 'actor', [], [], []);

describe('status: the tasks a sweep blocked long ago', () => {
  it('counts them in one line under the live tasks, and says where to find them', () => {
    const lines = said(opening({ workSweptLeftOut: 3 }));
    expect(lines).toContain('No live tasks.');
    expect(lines).toContain(
      '3 older task(s) blocked when a session stopped with no end are not listed; `mnema search` finds them.',
    );
  });

  it('counts them under the live tasks too, when there are some', () => {
    const work = [{ id: 'T-1', title: 'Live one', state: 'IN_PROGRESS' }];
    const lines = said(opening({ work, workTotal: 1, workSweptLeftOut: 2 }));
    expect(lines).toContain('1 live task(s):');
    expect(lines).toContain(
      '2 older task(s) blocked when a session stopped with no end are not listed; `mnema search` finds them.',
    );
  });

  it('says nothing about them when there are none', () => {
    expect(said(opening({})).join('\n')).not.toContain('older task');
  });
});

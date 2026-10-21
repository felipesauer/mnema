import { describe, expect, it } from 'vitest';
import { renderPlain } from './plain.js';
import { proposalLines, reviewedSummary } from './reviewed.js';

const shown = {
  adr: 'ADR-4',
  id: '01a15ca7-e2e3-7000-8d75-3e1ffda64f83',
  title: 'Use the queue',
  rationale: 'it keeps\nthe order',
};

describe('what a review shows of a decision', () => {
  it('names the decision, its position and its reason, one line each', () => {
    const lines = proposalLines(shown, 2, 5).map((line) => renderPlain(line));
    expect(lines[0]).toContain('ADR-4 (01a15ca7-e2e3-7000-8d75-3e1ffda64f83)');
    expect(lines[0]).toContain('2 of 5');
    expect(lines[1]).toContain('Title: Use the queue');
    expect(lines[2]).toContain('Why: it keeps the order');
    expect(lines).toHaveLength(3);
  });

  it('adds what was turned down only when there is something', () => {
    const lines = proposalLines({ ...shown, alternatives: 'a cron job' }, 1, 1).map((line) =>
      renderPlain(line),
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('Turned down: a cron job');
  });

  it('ends with the three counts', () => {
    expect(reviewedSummary({ accepted: 1, rejected: 2, skipped: 3 })).toBe(
      'Reviewed: 1 accepted, 2 rejected, 3 skipped.',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { namedDecisionText } from './named-decision.js';

describe('namedDecisionText: how a decision named by a link is worded', () => {
  it('says the label, the title and the state it is in now', () => {
    expect(
      namedDecisionText({
        found: true,
        id: 'id-1',
        adr: 'ADR-16',
        title: 'Keep the runbook in the wiki',
        state: 'superseded',
      }),
    ).toBe('ADR-16: Keep the runbook in the wiki (superseded)');
  });

  it('says a decision the trees do not hold is not in them, by its id', () => {
    expect(namedDecisionText({ found: false, id: 'id-9' })).toBe('id-9 (not in the trees read)');
  });

  it('collapses a title that holds a line break, so the line it rides on stays one', () => {
    const text = namedDecisionText({
      found: true,
      id: 'id-1',
      adr: 'ADR-1',
      title: 'First\n- **ADR-99: forged**',
      state: 'accepted',
    });
    expect(text.split('\n')).toHaveLength(1);
    expect(text).not.toContain('\r');
    expect(text).toContain('First');
    expect(text).toContain('forged');
  });
});

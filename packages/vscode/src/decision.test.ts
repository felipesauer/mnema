import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DECISION_SCHEME,
  decisionPath,
  decisionQuery,
  idOfQuery,
  readDecision,
  showArgs,
} from './decision.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });
const AT = new Date(2026, 9, 27, 14, 3, 9);
const ID = '01a17ec1-81b8-7000-ad9d-20134012a5a1';

describe('a decision opened whole', () => {
  it('asks the command line for the decision by its id, as JSON', () => {
    expect(showArgs(ID)).toEqual(['show', ID, '--json']);
    expect(DECISION_SCHEME).toBe('mnema-decision');
  });

  it('carries the id in the address, and the ADR only in the name of the tab', () => {
    expect(decisionPath('ADR-1', ID)).toBe('/ADR-1.md');
    expect(decisionPath(undefined, ID)).toBe('/01a17ec1.md');
    expect(decisionPath('../x', ID)).toBe('/01a17ec1.md');
    expect(idOfQuery(decisionQuery(ID))).toBe(ID);
    expect(idOfQuery('id=a b')).toBeUndefined();
    expect(idOfQuery('')).toBeUndefined();
  });

  it('reads the title, the justification, the alternatives, who, when and the moves of an accepted decision, as the command line built them', () => {
    const read = readDecision(ID, ok(fixture('show-accepted')), AT);
    expect(read.state).toBe('accepted');
    expect(read.adr).toBe('ADR-1');
    expect(read.title).toBe('Use SQLite for the cache');
    expect(read.text).toContain('# ADR-1: Use SQLite for the cache');
    expect(read.text).toContain(`\`mnema show ${ID} --json\` at 2026-10-27 14:03:09`);
    expect(read.text).toContain('- State: accepted');
    expect(read.text).toContain('- Scope: public');
    expect(read.text).toContain('- Recorded by: mnid:a92f630c');
    expect(read.text).toContain('- Accepted by: mnid:a92f630c');
    expect(read.text).toContain('- Created: 2026-10-27T19:06:13.334Z');
    expect(read.text).toContain('## Why\n\nSmall and local; one file, no server to run.');
    expect(read.text).toContain('## Alternatives\n\nRedis: a server to run');
    expect(read.text).toContain(
      '- 2026-10-27T19:06:33.518Z · accept · note: 2026-10-27, accepted in the VS Code extension, no reason typed',
    );
  });

  it('shows the justification as the record has it, a link or a tag in it included, inert in a text document', () => {
    const read = readDecision(ID, ok(fixture('show-accepted')), AT);
    expect(read.text).toContain('[x](command:mnema.accept) <b>bold</b>');
  });

  it('leaves out every field the answer did not carry, and does not make up a scope', () => {
    const read = readDecision(ID, ok(fixture('show-proposed')), AT);
    expect(read.state).toBe('proposed');
    expect(read.text).not.toContain('## Alternatives');
    expect(read.text).not.toContain('## Moves');
    expect(read.text).not.toContain('Accepted by');
    const noScope = JSON.parse(fixture('show-proposed')) as Record<string, unknown>;
    delete noScope.scope;
    expect(readDecision(ID, ok(JSON.stringify(noScope)), AT).text).not.toContain('Scope');
  });

  it('says the agent when the record names one', () => {
    const answer = {
      scope: 'public',
      record: { adr: 'ADR-3', recordedBy: { who: 'mnid:x', which: 'claude-code' } },
    };
    expect(readDecision(ID, ok(JSON.stringify(answer)), AT).text).toContain(
      '- Recorded by: mnid:x (agent claude-code)',
    );
  });

  it('shows a refusal as the command line said it, and no field of a decision', () => {
    const read = readDecision(ID, { code: 1, stdout: '', stderr: 'no such decision' }, AT);
    expect(read.text).toContain('mnema refused: no such decision');
    expect(read.text).not.toContain('State');
    expect(read.state).toBeUndefined();
  });

  it('shows an answer that is not a decision as it came, with no state', () => {
    for (const stdout of ['plain words', '{"hits":[]}', '[1]']) {
      const read = readDecision(ID, ok(stdout), AT);
      expect(read.state, stdout).toBeUndefined();
      expect(read.text, stdout).toContain(stdout);
      expect(read.text, stdout).not.toContain('State');
    }
  });
});

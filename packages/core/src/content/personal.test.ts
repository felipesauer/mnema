import { describe, expect, it } from 'vitest';
import { EMAIL_PLACEHOLDER, scrubEmails } from './personal.js';

describe('an email address in recorded text', () => {
  it('is replaced by a marker, and the words around it survive', () => {
    const scrubbed = scrubEmails('reported by jane.doe+work@example.com on the call');
    expect(scrubbed.text).toBe('reported by <email> on the call');
    expect(scrubbed.text).not.toContain('jane.doe');
    expect(scrubbed.replaced).toEqual(['email']);
    expect(EMAIL_PLACEHOLDER).toBe('<email>');
  });

  it('is replaced once per address, wherever it sits', () => {
    const scrubbed = scrubEmails('a@b.io, then (c.d@e-f.co.uk); "g@h.dev".');
    expect(scrubbed.text).toBe('<email>, then (<email>); "<email>".');
    expect(scrubbed.replaced).toEqual(['email', 'email', 'email']);
  });

  it('hands the text back untouched when there is none', () => {
    const text = 'nothing personal here';
    const scrubbed = scrubEmails(text);
    expect(scrubbed.text).toBe(text);
    expect(scrubbed.replaced).toEqual([]);
  });
});

describe('what is not an email address is left alone', () => {
  const UNTOUCHED: Record<string, string> = {
    'a URL with a user': 'clone https://user@host.example.com/repo.git first',
    'a URL with a user and a password': 'at postgres://svc:pw1234@db.internal:5432/app',
    'an scp-style git remote': 'remote is git@github.com:felipesauer/mnema.git',
    'a pinned package': 'pin react@18.2.0 and lodash@latest and @scope/pkg',
    'a version tag': 'use typescript@5.6.3',
    'a mnid': `mnid:${'ab12'.repeat(16)}`,
    'a v7 id': '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    'a GitHub noreply address in a git citation':
      'Author: Jane <120697114+jane@users.noreply.github.com>',
    'a role address that names no one': 'send it to noreply@anthropic.com',
    'an at-mention': 'ping @felipesauer about it',
  };
  for (const [name, text] of Object.entries(UNTOUCHED)) {
    it(name, () => {
      const scrubbed = scrubEmails(text);
      expect(scrubbed.text).toBe(text);
      expect(scrubbed.replaced).toEqual([]);
    });
  }
});

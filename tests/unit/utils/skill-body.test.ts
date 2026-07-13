import { describe, expect, it } from 'vitest';

import { splitSkillExampleSections } from '@/utils/skill-body.js';

describe('splitSkillExampleSections', () => {
  it('returns the whole body as core and empty examples when there is no Example section', () => {
    const body = '# Title\n\nSome core prose.\n\n## Steps\n1. do a thing';
    const { core, examples } = splitSkillExampleSections(body);
    expect(core).toBe(body);
    expect(examples).toBe('');
  });

  it('moves an `## Example` section into examples and keeps the rest as core', () => {
    const body = [
      '# Title',
      '',
      'Core prose about the subject.',
      '',
      '## Example',
      '',
      'GET /auth/callback',
    ].join('\n');
    const { core, examples } = splitSkillExampleSections(body);
    expect(core).toBe('# Title\n\nCore prose about the subject.\n');
    expect(examples).toBe('## Example\n\nGET /auth/callback');
    expect(core).not.toContain('/auth/callback');
    expect(examples).toContain('/auth/callback');
  });

  it('treats the plural `## Examples` heading as an example section', () => {
    const body = 'Core.\n\n## Examples\n\nsample payload';
    const { core, examples } = splitSkillExampleSections(body);
    expect(core).toBe('Core.\n');
    expect(examples).toBe('## Examples\n\nsample payload');
  });

  it('ends the example run at the next non-example same-or-higher heading', () => {
    const body = ['Core intro.', '## Example', 'example body', '## Notes', 'notes body'].join('\n');
    const { core, examples } = splitSkillExampleSections(body);
    // The `## Notes` section returns to core; only the Example block is examples.
    expect(core).toBe('Core intro.\n## Notes\nnotes body');
    expect(examples).toBe('## Example\nexample body');
  });

  it('keeps consecutive Example-family sections together in examples', () => {
    const body = [
      'Core.',
      '## Example',
      'first',
      '## Examples',
      'second',
      '# Top',
      'back to core',
    ].join('\n');
    const { core, examples } = splitSkillExampleSections(body);
    expect(examples).toBe('## Example\nfirst\n## Examples\nsecond');
    expect(core).toBe('Core.\n# Top\nback to core');
  });
});

import { describe, expect, it } from 'vitest';
import { BRIEF_TOPIC, DESCRIPTION_TOPIC } from './companion-topics.js';

describe('the topics a call records its prose under', () => {
  it('are the two words the documentation and the reads name, and are not one word', () => {
    expect(BRIEF_TOPIC).toBe('brief');
    expect(DESCRIPTION_TOPIC).toBe('description');
    expect(BRIEF_TOPIC).not.toBe(DESCRIPTION_TOPIC);
  });
});

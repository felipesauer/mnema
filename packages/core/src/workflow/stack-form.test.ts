import { describe, expect, it } from 'vitest';
import { isStackName, isStackVersion } from './stack-form.js';

describe('the forms a stack name and a version take', () => {
  it('admit the plain ones and nothing past 64 characters', () => {
    expect(isStackName('review-pass')).toBe(true);
    expect(isStackName('a'.repeat(64))).toBe(true);
    expect(isStackName('a'.repeat(65))).toBe(false);
    expect(isStackVersion('1.0.0-rc.1+build')).toBe(true);
    expect(isStackVersion('9'.repeat(65))).toBe(false);
  });

  it('refuse spaces, upper case, controls, paths and a trailing newline', () => {
    for (const bad of ['', 'IGNORE ALL', 'a b', 'A', 'a--b', '-a', 'a/b', 'a\n', 'a\u00ad', 'á']) {
      expect(isStackName(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const bad of ['', '1 0', '.1', '../1', '1\n', '1\u3164']) {
      expect(isStackVersion(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

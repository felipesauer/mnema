import { describe, expect, it } from 'vitest';

import { nameOfAKeyKind } from './key-kind.js';

describe('nameOfAKeyKind', () => {
  it('says a key kind with the article its name is said with', () => {
    expect(nameOfAKeyKind('ec')).toBe('an EC key');
    expect(nameOfAKeyKind('rsa')).toBe('an RSA key');
    expect(nameOfAKeyKind('ed448')).toBe('an ed448 key');
    expect(nameOfAKeyKind('x25519')).toBe('an x25519 key');
    expect(nameOfAKeyKind('dsa')).toBe('a dsa key');
  });
});

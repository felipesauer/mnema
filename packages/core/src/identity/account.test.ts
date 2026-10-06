/**
 * Which strings are a GitHub account name — the rule a link is refused by on the way in and a
 * reading is refused by before it puts the name in an address.
 *
 * The expected answers come from GitHub's own sign-up rule (letters, digits and single hyphens,
 * no hyphen at either end, at most 39 characters), not from the expression under test.
 */

import { describe, expect, it } from 'vitest';
import {
  GITHUB_SERVICE,
  githubLoginRefusal,
  SIGSTORE_SERVICE,
  sigstoreIdentityRefusal,
} from './account.js';

describe('githubLoginRefusal', () => {
  it('accepts the names GitHub accepts', () => {
    for (const login of ['octocat', 'felipesauer', 'a', 'a-b', 'mona-lisa-42', 'x'.repeat(39)]) {
      expect(githubLoginRefusal(login), login).toBeUndefined();
    }
  });

  it('refuses what GitHub refuses, and anything that would change the address it is put in', () => {
    for (const login of [
      '',
      '-octocat',
      'octocat-',
      'octo--cat',
      'x'.repeat(40),
      'octo cat',
      'octo/cat',
      '../octocat',
      'octocat.keys',
      'octocat?x=1',
      'octócat',
    ]) {
      expect(githubLoginRefusal(login), JSON.stringify(login)).toMatch(/GitHub account name/);
    }
  });

  it('names the GitHub service by the word the record carries', () => {
    expect(GITHUB_SERVICE).toBe('github');
  });
});

describe('sigstoreIdentityRefusal', () => {
  it('accepts the two shapes a Sigstore certificate names: an e-mail and a workflow', () => {
    for (const identity of [
      'felipe@example.com',
      'a.b+c@sub.example.org',
      'https://github.com/felipesauer/mnema/.github/workflows/witness.yml@refs/heads/main',
    ]) {
      expect(sigstoreIdentityRefusal(identity), identity).toBeUndefined();
    }
    expect(SIGSTORE_SERVICE).toBe('sigstore');
  });

  it('refuses anything else, a bare login and a repository URL included', () => {
    for (const identity of [
      '',
      'felipesauer',
      'felipe@localhost',
      'felipe @example.com',
      'https://github.com/felipesauer/mnema',
      'http://github.com/o/r/.github/workflows/w.yml@refs/heads/main',
      'https://github.com/o/r/.github/workflows/w.yml',
    ]) {
      expect(sigstoreIdentityRefusal(identity), JSON.stringify(identity)).toMatch(
        /not an identity a Sigstore certificate names/,
      );
    }
  });
});

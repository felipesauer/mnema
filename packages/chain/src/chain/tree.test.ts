import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitignorePath } from './layout.js';
import { ensureTree } from './tree.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-tree-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ensureTree — self-contained .gitignore', () => {
  it('writes a .gitignore that ignores the private subtree and local key material', () => {
    ensureTree({ root });
    const ignore = readFileSync(gitignorePath({ root }), 'utf-8');
    expect(ignore).toContain('/private/');
    expect(ignore).toContain('/keys/*.key');
    expect(ignore).toContain('/keys/*.inst');
    expect(ignore).toContain('/keys/*.anchor');
  });

  it('does NOT ignore the proof files the team needs (public keys, tails)', () => {
    ensureTree({ root });
    const ignore = readFileSync(gitignorePath({ root }), 'utf-8');
    // The proof surface must reach git: public keys and everything under tails/.
    // Only actual RULE lines matter (comments may name the files they let through),
    // so check the non-comment lines carry no rule that would hide them.
    const rules = ignore
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    for (const proof of ['pub', 'tails', 'checkpoints', 'tailproof']) {
      expect(rules.some((r) => r.includes(proof))).toBe(false);
    }
  });

  it('is idempotent and non-destructive: a hand-edited .gitignore is kept', () => {
    ensureTree({ root });
    const edited = `${readFileSync(gitignorePath({ root }), 'utf-8')}\n# my own line\n`;
    writeFileSync(gitignorePath({ root }), edited, 'utf-8');

    const wroteAgain = ensureTree({ root });
    expect(wroteAgain).toBe(false);
    expect(readFileSync(gitignorePath({ root }), 'utf-8')).toBe(edited);
  });

  it('reports whether it wrote the .gitignore this call', () => {
    expect(ensureTree({ root })).toBe(true); // absent → written
    expect(ensureTree({ root })).toBe(false); // present → left alone
  });

  it('creates the tree directory if absent', () => {
    const nested = join(root, 'a', 'b', '.mnema');
    ensureTree({ root: nested });
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(nested, '.gitignore'))).toBe(true);
  });
});

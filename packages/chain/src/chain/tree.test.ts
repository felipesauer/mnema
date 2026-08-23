import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    for (const proof of ['pub', 'tails', 'checkpoints', 'tailproof', 'witness', 'ots']) {
      expect(rules.some((r) => r.includes(proof))).toBe(false);
    }
  });

  it('lets the WITNESS through, and git is the one asked', () => {
    // The attestation and the block headers are public by construction — a digest, a
    // Merkle path and eighty bytes of somebody else's block — and they are the only
    // thing standing between a clone and a `not covered` it cannot do anything about.
    // A rule that hid them would make T3 a layer only the machine that stamped can see.
    //
    // ASKED OF `git check-ignore`, NOT OF A SUBSTRING. The first draft of this compared
    // the rules to a path by hand, and a mutation that added `/tails/*/witness/` to the
    // ignore file walked straight past it — a glob is not a substring, and a rule like
    // `/tails/*/*/` would not even carry the word. The tool that decides this in
    // production is git, so git is what answers.
    const repo = mkdtempSync(join(tmpdir(), 'mnema-gitignore-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const tree = join(repo, '.mnema');
      ensureTree({ root: tree });
      const witnessed = join('.mnema', 'tails', 'ffff-0001', 'witness', 'abc.ots');
      const blocks = join('.mnema', 'tails', 'ffff-0001', 'witness', 'abc.blocks');
      for (const path of [witnessed, blocks]) {
        mkdirSync(join(repo, dirname(path)), { recursive: true });
        writeFileSync(join(repo, path), 'x');
        // `check-ignore` exits 0 when the path IS ignored, 1 when it is not.
        let ignored = true;
        try {
          execFileSync('git', ['check-ignore', '-q', path], { cwd: repo });
        } catch {
          ignored = false;
        }
        expect(ignored, `${path} is ignored by the tree's own .gitignore`).toBe(false);
      }
      // And the same question, the other way round, so the instrument is not vacuous:
      // what the file DOES hide is hidden.
      const secret = join('.mnema', 'keys', 'abc.key');
      mkdirSync(join(repo, dirname(secret)), { recursive: true });
      writeFileSync(join(repo, secret), 'x');
      expect(() =>
        execFileSync('git', ['check-ignore', '-q', secret], { cwd: repo }),
      ).not.toThrow();
    } finally {
      rmSync(repo, { recursive: true, force: true });
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

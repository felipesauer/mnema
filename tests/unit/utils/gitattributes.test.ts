import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureGitattributes,
  gitattributesLines,
  hasGitattributesUnion,
} from '@/utils/gitattributes.js';

describe('gitattributes util', () => {
  let cwd: string;
  const auditPath = '.mnema/audit';
  const marker = '.mnema/audit/*.jsonl merge=union';

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'mnema-gitattr-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('gitattributesLines emits the union rule for the audit dir, trailing slash tolerated', () => {
    expect(gitattributesLines('.mnema/audit')).toContain(marker);
    expect(gitattributesLines('.mnema/audit/')).toContain(marker);
  });

  it('creates .gitattributes when absent', () => {
    expect(hasGitattributesUnion(cwd, auditPath)).toBe(false);
    const outcome = ensureGitattributes(cwd, auditPath);
    expect(outcome).toBe('created');
    expect(readFileSync(path.join(cwd, '.gitattributes'), 'utf-8')).toContain(marker);
    expect(hasGitattributesUnion(cwd, auditPath)).toBe(true);
  });

  it('appends the block to an existing .gitattributes that lacks it', () => {
    writeFileSync(path.join(cwd, '.gitattributes'), '*.png binary\n', 'utf-8');
    const outcome = ensureGitattributes(cwd, auditPath);
    expect(outcome).toBe('appended');
    const attrs = readFileSync(path.join(cwd, '.gitattributes'), 'utf-8');
    // Pre-existing rule is preserved, and the union rule is added.
    expect(attrs).toContain('*.png binary');
    expect(attrs).toContain(marker);
  });

  it('is idempotent — a second call is a no-op and never duplicates the marker', () => {
    ensureGitattributes(cwd, auditPath);
    const outcome = ensureGitattributes(cwd, auditPath);
    expect(outcome).toBe('present');
    const attrs = readFileSync(path.join(cwd, '.gitattributes'), 'utf-8');
    expect(attrs.split('merge=union').length - 1).toBe(1);
  });

  it('hasGitattributesUnion is false when the file exists without the marker', () => {
    writeFileSync(path.join(cwd, '.gitattributes'), '*.png binary\n', 'utf-8');
    expect(hasGitattributesUnion(cwd, auditPath)).toBe(false);
  });

  it('retrofit scenario: a pre-0.13 repo (no .gitattributes) gains the union rule', () => {
    // Exactly what `mnema upgrade` does for a project initialised before the
    // block existed — the file is created with the audit union rule.
    expect(existsSync(path.join(cwd, '.gitattributes'))).toBe(false);
    ensureGitattributes(cwd, auditPath);
    expect(hasGitattributesUnion(cwd, auditPath)).toBe(true);
  });
});

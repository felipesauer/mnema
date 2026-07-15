import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureGitignore, gitignoreBlock, hasCurrentGitignore } from '@/utils/gitignore.js';

describe('gitignore util', () => {
  let cwd: string;
  const statePath = '.mnema/state';
  const auditPath = '.mnema/audit';
  const stateEntry = '.mnema/state/';
  const lockMarker = '.mnema/audit/.audit.lock*';

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'mnema-gitignore-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const read = () => readFileSync(path.join(cwd, '.gitignore'), 'utf-8');

  it('gitignoreBlock ignores state + config.local + the audit lock, trailing slash tolerated', () => {
    const block = gitignoreBlock('.mnema/state/', '.mnema/audit/');
    expect(block).toContain(stateEntry);
    expect(block).toContain('.mnema/config.local.json');
    expect(block).toContain(lockMarker);
  });

  it('creates .gitignore when absent', () => {
    expect(hasCurrentGitignore(cwd, statePath, auditPath)).toBe(false);
    expect(ensureGitignore(cwd, statePath, auditPath)).toBe('created');
    const body = read();
    expect(body).toContain(stateEntry);
    expect(body).toContain(lockMarker);
    expect(hasCurrentGitignore(cwd, statePath, auditPath)).toBe(true);
  });

  it('appends the managed block to an existing .gitignore that lacks it', () => {
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n', 'utf-8');
    expect(ensureGitignore(cwd, statePath, auditPath)).toBe('appended');
    const body = read();
    expect(body).toContain('node_modules/'); // pre-existing preserved
    expect(body).toContain(stateEntry);
    expect(body).toContain(lockMarker);
  });

  it('is idempotent — a second call is present and never duplicates the state entry', () => {
    ensureGitignore(cwd, statePath, auditPath);
    expect(ensureGitignore(cwd, statePath, auditPath)).toBe('present');
    const occurrences = read()
      .split('\n')
      .filter((l) => l.trim() === stateEntry).length;
    expect(occurrences).toBe(1);
  });

  it('retrofits the .audit.lock line onto a legacy two-line block WITHOUT duplicating state', () => {
    // The vintage `mnema init` block a pre-.audit.lock adopter (e.g. notagrafo)
    // still carries: state ignored, but no audit-lock line.
    writeFileSync(path.join(cwd, '.gitignore'), `# mnema\n${stateEntry}\n`, 'utf-8');
    expect(hasCurrentGitignore(cwd, statePath, auditPath)).toBe(false);

    const outcome = ensureGitignore(cwd, statePath, auditPath);
    expect(outcome).toBe('retrofitted');

    const body = read();
    // The missing lock line is now present…
    expect(body).toContain(lockMarker);
    expect(hasCurrentGitignore(cwd, statePath, auditPath)).toBe(true);
    // …and the state entry was NOT duplicated (the whole point of the retrofit
    // path vs. re-appending the full block).
    const stateOccurrences = body.split('\n').filter((l) => l.trim() === stateEntry).length;
    expect(stateOccurrences).toBe(1);
  });

  it('treats a broad .mnema/ ancestor ignore as covering the state entry', () => {
    // If a repo ignores the whole .mnema/ (the tool-repo outlier stance), the
    // state dir is already covered — do not append a redundant state entry;
    // still retrofit the lock line so the block converges.
    writeFileSync(path.join(cwd, '.gitignore'), '.mnema/\n', 'utf-8');
    const outcome = ensureGitignore(cwd, statePath, auditPath);
    // state is covered but the lock marker is absent → retrofit (lock line only).
    expect(outcome).toBe('retrofitted');
    const body = read();
    expect(body.split('\n').filter((l) => l.trim() === stateEntry).length).toBe(0);
    expect(body).toContain(lockMarker);
  });

  it('hasCurrentGitignore is false for a legacy block missing the lock line', () => {
    writeFileSync(path.join(cwd, '.gitignore'), `${stateEntry}\n`, 'utf-8');
    expect(hasCurrentGitignore(cwd, statePath, auditPath)).toBe(false);
  });
});

import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pruneFolderedOrphanMirrors } from '@/cli/commands/doctor-command.js';

describe('pruneFolderedOrphanMirrors (ADR-51)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-prune-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string): void {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '# x\n', 'utf-8');
  }

  it('deletes orphan mirrors under subfolders and at the root, keeps known slugs', () => {
    write('default/known-seed.md');
    write('authored/known-authored.md');
    write('authored/orphan-a.md');
    write('scope-x/orphan-b.md');
    write('flat-orphan.md');
    write('SKILL.md'); // index — never an orphan

    const known = new Set(['known-seed', 'known-authored']);
    const removed = pruneFolderedOrphanMirrors(root, known, fs);

    expect(removed).toEqual(['flat-orphan', 'orphan-a', 'orphan-b']);
    // Known mirrors and the index survive.
    expect(existsSync(path.join(root, 'default', 'known-seed.md'))).toBe(true);
    expect(existsSync(path.join(root, 'authored', 'known-authored.md'))).toBe(true);
    expect(existsSync(path.join(root, 'SKILL.md'))).toBe(true);
    // Orphans are gone.
    expect(existsSync(path.join(root, 'authored', 'orphan-a.md'))).toBe(false);
    expect(existsSync(path.join(root, 'scope-x', 'orphan-b.md'))).toBe(false);
    expect(existsSync(path.join(root, 'flat-orphan.md'))).toBe(false);
  });

  it('removes a subfolder left empty after its only mirror was pruned', () => {
    write('scope-gone/only.md');
    write('default/keep.md');
    pruneFolderedOrphanMirrors(root, new Set(['keep']), fs);
    // The emptied scope folder is swept…
    expect(existsSync(path.join(root, 'scope-gone'))).toBe(false);
    // …but a folder that still holds a known mirror stays.
    expect(existsSync(path.join(root, 'default'))).toBe(true);
  });

  it('is a no-op on a missing directory', () => {
    expect(pruneFolderedOrphanMirrors(path.join(root, 'nope'), new Set(), fs)).toEqual([]);
  });
});

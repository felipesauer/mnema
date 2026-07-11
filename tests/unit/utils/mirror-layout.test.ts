import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findAllMirrors,
  findMirror,
  listMirrorEntries,
  scopeFolder,
  skillOriginDir,
} from '@/utils/mirror-layout.js';

describe('scopeFolder', () => {
  it('returns null for a scopeless memory', () => {
    expect(scopeFolder(null)).toBeNull();
    expect(scopeFolder(undefined)).toBeNull();
  });

  it('flattens a path-like scope into one safe segment', () => {
    expect(scopeFolder('packages/notifier')).toBe('packages-notifier');
    expect(scopeFolder('API')).toBe('api');
    expect(scopeFolder('a/b/c')).toBe('a-b-c');
  });

  it('trims separators and collapses non-alphanumerics', () => {
    expect(scopeFolder('  /weird__scope!!  ')).toBe('weird-scope');
    expect(scopeFolder('///')).toBeNull(); // nothing usable → root
  });

  it('never resolves to a curated memory subfolder (decisions/notes)', () => {
    // Otherwise a scoped memory would land inside the human-curated ADR/note
    // tree and be reclassified/pruned. Reserved names are suffixed.
    expect(scopeFolder('decisions')).toBe('decisions-scope');
    expect(scopeFolder('Notes')).toBe('notes-scope');
    expect(scopeFolder('DECISIONS')).toBe('decisions-scope');
    // A non-colliding scope is untouched.
    expect(scopeFolder('packages/notifier')).toBe('packages-notifier');
  });
});

describe('skillOriginDir', () => {
  it('routes the system seed author to default/, everyone else to authored/', () => {
    expect(skillOriginDir('system')).toBe('default');
    expect(skillOriginDir('daniel')).toBe('authored');
    expect(skillOriginDir('')).toBe('authored');
  });
});

describe('findMirror / listMirrorEntries', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-mirror-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string): void {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '# x\n', 'utf-8');
  }

  it('finds a mirror flat at the root', () => {
    write('foo.md');
    expect(findMirror(root, 'foo')).toBe(path.join(root, 'foo.md'));
  });

  it('finds a mirror one level deep, regardless of the subfolder name', () => {
    write('packages-notifier/bar.md');
    write('default/baz.md');
    expect(findMirror(root, 'bar')).toBe(path.join(root, 'packages-notifier', 'bar.md'));
    expect(findMirror(root, 'baz')).toBe(path.join(root, 'default', 'baz.md'));
  });

  it('returns null when the slug is absent or only in a too-deep folder', () => {
    write('a/b/deep.md'); // depth 2 — beyond the one-level default
    expect(findMirror(root, 'deep')).toBeNull();
    expect(findMirror(root, 'missing')).toBeNull();
  });

  it('lists entries across root and one level of subfolders, excluding indexes/dotfiles', () => {
    write('flat.md');
    write('default/seed.md');
    write('scope-x/mem.md');
    write('SKILL.md'); // index — excluded
    write('INDEX.md'); // index — excluded
    write('.gitkeep'); // dotfile — excluded
    const slugs = listMirrorEntries(root)
      .map((e) => e.slug)
      .sort();
    expect(slugs).toEqual(['flat', 'mem', 'seed']);
  });

  it('excludeDirs skips a curated top-level subfolder in list and find', () => {
    write('mem.md');
    write('decisions/adr-1.md'); // curated — must be invisible to row scans
    write('notes/note-1.md');
    const exclude = new Set(['decisions', 'notes']);
    const slugs = listMirrorEntries(root, { excludeDirs: exclude })
      .map((e) => e.slug)
      .sort();
    expect(slugs).toEqual(['mem']);
    // A curated file is not found as a row mirror when excluded.
    expect(findMirror(root, 'adr-1', { excludeDirs: exclude })).toBeNull();
    // ...but IS found without the exclusion (proves the exclusion is doing it).
    expect(findMirror(root, 'adr-1')).not.toBeNull();
  });

  it('findAllMirrors returns every duplicate copy of a slug (partial migration)', () => {
    write('foo.md'); // flat leftover
    write('authored/foo.md'); // canonical
    const all = findAllMirrors(root, 'foo');
    expect(all.length).toBe(2);
    expect(all.some((p) => p.endsWith(path.join('authored', 'foo.md')))).toBe(true);
    expect(all.some((p) => p === path.join(root, 'foo.md'))).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { type GitRunner, MemoryStalenessService } from '@/services/memory-staleness.js';

const WRITTEN_AT = '2026-01-01T00:00:00.000Z';

/**
 * A git runner emulating `git log --since --name-only --format= -- <paths>`:
 * echoes the `changed` paths (one per line), filtered to those actually
 * passed as pathspecs (mirrors how git scopes `--name-only` output).
 */
function gitRunner(changed: ReadonlySet<string>): GitRunner {
  return (args) => {
    const sep = args.indexOf('--');
    const pathspecs = sep === -1 ? [] : args.slice(sep + 1);
    const lines = [...changed].filter((c) => pathspecs.includes(c));
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
  };
}

describe('MemoryStalenessService', () => {
  it('flags a memory when a cited file changed since it was written', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['src/foo.ts'])));
    const verdict = service.assess('See src/foo.ts:42 for the parser.', WRITTEN_AT);
    expect(verdict.stale).toBe(true);
    expect(verdict.cited_files).toEqual([{ path: 'src/foo.ts', changedSince: true }]);
  });

  it('does not flag when cited files are unchanged', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set()));
    const verdict = service.assess('The config lives in src/config/schema.ts.', WRITTEN_AT);
    expect(verdict.stale).toBe(false);
    expect(verdict.cited_files).toEqual([{ path: 'src/config/schema.ts', changedSince: false }]);
  });

  it('flags stale when any one of several cited files changed', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['src/b.ts'])));
    const verdict = service.assess('Touches src/a.ts and src/b.ts and src/c.ts.', WRITTEN_AT);
    expect(verdict.stale).toBe(true);
    const changed = verdict.cited_files.filter((c) => c.changedSince).map((c) => c.path);
    expect(changed).toEqual(['src/b.ts']);
  });

  it('makes a SINGLE git call regardless of how many files are cited', () => {
    const runner = vi.fn(gitRunner(new Set(['src/b.ts'])));
    const service = new MemoryStalenessService('/repo', runner);
    service.assess('Touches src/a.ts, src/b.ts, src/c.ts and src/d.ts.', WRITTEN_AT);
    // One batched `git log`, not one per cited file.
    expect(runner).toHaveBeenCalledTimes(1);
    const args = runner.mock.calls[0]?.[0] ?? [];
    expect(args).toContain('--name-only');
    // All four paths passed as pathspecs after the `--` separator.
    const sep = args.indexOf('--');
    expect(args.slice(sep + 1).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
  });

  it('detects slash-less filenames (package.json) and ./relative paths', () => {
    // git reports the repo-relative path; the memory cites the bare name.
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['package.json'])));
    const v1 = service.assess('Bumped a dep in package.json.', WRITTEN_AT);
    expect(v1.cited_files.map((c) => c.path)).toContain('package.json');
    expect(v1.stale).toBe(true);

    // `./README.md` is normalised to `README.md` (what git tracks).
    const service2 = new MemoryStalenessService('/repo', gitRunner(new Set(['README.md'])));
    const v2 = service2.assess('See ./README.md for setup.', WRITTEN_AT);
    expect(v2.cited_files.map((c) => c.path)).toContain('README.md');
    expect(v2.stale).toBe(true);
  });

  it('returns not-stale and no files for prose with no file references', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['anything'])));
    const verdict = service.assess(
      'Prefer push over hybrid sync for CI runs (e.g. nightly).',
      WRITTEN_AT,
    );
    expect(verdict.stale).toBe(false);
    expect(verdict.cited_files).toHaveLength(0);
  });

  it('extracts a path with a line suffix but reports the bare path', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['src/x.ts'])));
    const verdict = service.assess('Bug at src/x.ts:128 in the loop.', WRITTEN_AT);
    expect(verdict.cited_files.map((c) => c.path)).toEqual(['src/x.ts']);
  });

  it('treats an unparseable timestamp as not-stale (no false alarm)', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['src/foo.ts'])));
    const verdict = service.assess('See src/foo.ts.', 'not-a-date');
    expect(verdict.stale).toBe(false);
  });

  describe('session cache (keyed by slug + updatedAt)', () => {
    it('reuses the cached verdict for the same slug + updatedAt (no second git call)', () => {
      const runner = vi.fn(gitRunner(new Set(['src/foo.ts'])));
      const service = new MemoryStalenessService('/repo', runner);
      const first = service.assess('See src/foo.ts:42.', WRITTEN_AT, 'my-memory');
      const second = service.assess('See src/foo.ts:42.', WRITTEN_AT, 'my-memory');
      expect(second).toEqual(first);
      expect(second.stale).toBe(true);
      // Warm cache: the second assess must not re-spawn git.
      expect(runner).toHaveBeenCalledTimes(1);
    });

    it('re-assesses when updatedAt changes (an edited memory is not served stale)', () => {
      const runner = vi.fn(gitRunner(new Set(['src/foo.ts'])));
      const service = new MemoryStalenessService('/repo', runner);
      service.assess('See src/foo.ts:42.', WRITTEN_AT, 'my-memory');
      service.assess('See src/foo.ts:42.', '2026-02-02T00:00:00.000Z', 'my-memory');
      // Different key (updatedAt moved) → a fresh assessment.
      expect(runner).toHaveBeenCalledTimes(2);
    });

    it('does not cache across different slugs', () => {
      const runner = vi.fn(gitRunner(new Set(['src/foo.ts'])));
      const service = new MemoryStalenessService('/repo', runner);
      service.assess('See src/foo.ts:42.', WRITTEN_AT, 'memory-a');
      service.assess('See src/foo.ts:42.', WRITTEN_AT, 'memory-b');
      expect(runner).toHaveBeenCalledTimes(2);
    });

    it('bypasses the cache when no key is given (still correct)', () => {
      const runner = vi.fn(gitRunner(new Set(['src/foo.ts'])));
      const service = new MemoryStalenessService('/repo', runner);
      service.assess('See src/foo.ts:42.', WRITTEN_AT);
      service.assess('See src/foo.ts:42.', WRITTEN_AT);
      // No key → no memoisation, both calls hit git.
      expect(runner).toHaveBeenCalledTimes(2);
    });
  });
});

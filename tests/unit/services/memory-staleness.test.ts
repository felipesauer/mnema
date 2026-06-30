import { describe, expect, it } from 'vitest';

import { type GitRunner, MemoryStalenessService } from '@/services/memory-staleness.js';

const WRITTEN_AT = '2026-01-01T00:00:00.000Z';

/** A git runner that reports `changed` paths as having commits since. */
function gitRunner(changed: ReadonlySet<string>): GitRunner {
  return (args) => {
    // args: ['log', '--since=...', '--format=%H', '--', <path>]
    const filePath = args[args.length - 1];
    return filePath !== undefined && changed.has(filePath) ? 'abc123\n' : '';
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

  it('returns not-stale and no files for prose with no file references', () => {
    const service = new MemoryStalenessService('/repo', gitRunner(new Set(['anything'])));
    const verdict = service.assess('Prefer push over hybrid sync for CI runs.', WRITTEN_AT);
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
});

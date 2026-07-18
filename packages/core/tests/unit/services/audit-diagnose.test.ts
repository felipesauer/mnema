import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diagnoseAuditChain } from '@/services/audit/audit-diagnose.js';
import type { GitCommandRunner } from '@/services/git/git-commit-service.js';
import { hmacEvent } from '@/storage/audit/audit-hash.js';
import type { AuditEvent } from '@/storage/audit/audit-writer.js';

const FIXTURE_SECRET = Buffer.alloc(32, 7);

/**
 * diagnoseAuditChain must distinguish a benign prev_hash discontinuity (fully
 * authentic content around it — the signature of concurrent writers racing the
 * chain before the cross-process lock) from a REAL edit (a content hash that
 * fails to verify). Collapsing both into "tampering" is exactly the false alarm
 * this module exists to fix.
 */
describe('diagnoseAuditChain', () => {
  let auditDir: string;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-diagnose-'));
    auditDir = path.join(tempRoot, 'audit');
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  /** Builds n valid, correctly-chained events sealed with the fixture secret. */
  function buildChain(n: number, startAt = 0): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prevHash: string | null = null;
    for (let i = 0; i < n; i++) {
      const unsealed: AuditEvent = {
        v: 1,
        at: `2026-06-01T00:00:${String(startAt + i).padStart(2, '0')}.000Z`,
        kind: 'task_created',
        actor: 'felipesauer',
        data: { key: `T-${startAt + i}` },
        prev_hash: prevHash,
      };
      const hash = hmacEvent(unsealed, FIXTURE_SECRET);
      const sealed = { ...unsealed, hash };
      events.push(sealed);
      prevHash = hash;
    }
    return events;
  }

  const writeLines = (file: string, events: readonly AuditEvent[]): void => {
    writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf-8');
  };

  const noGit: GitCommandRunner = () => {
    throw new Error('git should not be called when gitCwd is null');
  };

  it('reports zero breaks on a cleanly-chained log', () => {
    const events = buildChain(10);
    writeLines(path.join(auditDir, 'current.jsonl'), events);
    const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
    expect(report.totalChained).toBe(10);
    expect(report.breaks).toHaveLength(0);
    expect(report.allBreaksContentValid).toBe(true); // vacuously — no breaks
  });

  it('the notagrafo shape: a prev_hash break with fully authentic content is flagged content-valid', () => {
    // Two independently-valid sub-chains, concatenated as if two racing
    // writers each appended their own tail without seeing the other's.
    const first = buildChain(5, 0);
    const second = buildChain(5, 100); // starts prev_hash: null — an independent chain
    const events = [...first, ...second];
    writeLines(path.join(auditDir, 'current.jsonl'), events);

    const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
    expect(report.totalChained).toBe(10);
    expect(report.breaks).toHaveLength(1);
    expect(report.breaks[0]?.chainedIndex).toBe(5);
    // Every event's OWN content hash is valid — only the sequence is disturbed.
    expect(report.breaks[0]?.contentValidAroundBreak).toBe(true);
    expect(report.allBreaksContentValid).toBe(true);
  });

  it('a REAL content edit at a break is flagged content-invalid, never laundered', () => {
    const first = buildChain(5, 0);
    const second = buildChain(5, 100);
    const events = [...first, ...second];
    // Tamper the content of the line right after the break, WITHOUT
    // recomputing its hash — the classic forged-edit shape.
    const tampered = { ...events[6], data: { key: 'HACKED' } } as AuditEvent;
    events[6] = tampered;
    writeLines(path.join(auditDir, 'current.jsonl'), events);

    const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
    expect(report.breaks).toHaveLength(1);
    expect(report.breaks[0]?.contentValidAroundBreak).toBe(false);
    expect(report.allBreaksContentValid).toBe(false);
  });

  it('treats a v3 line with no secret as unknown (null), never as valid', () => {
    const secret = Buffer.from('a'.repeat(32));
    const unsealed: AuditEvent = {
      v: 1,
      at: '2026-06-01T00:00:00.000Z',
      kind: 'task_created',
      actor: 'felipesauer',
      data: { key: 'T-0' },
      prev_hash: null,
    };
    const sealed = { ...unsealed, hash: hmacEvent(unsealed, secret) };
    const second = { ...unsealed, at: '2026-06-01T00:00:01.000Z', prev_hash: 'garbage-orphan' };
    const sealed2 = { ...second, hash: hmacEvent(second, secret) };
    writeLines(path.join(auditDir, 'current.jsonl'), [sealed, sealed2]);

    // No secret passed — content validity of the window is unknown.
    const report = diagnoseAuditChain(auditDir, null, null, null, noGit);
    expect(report.breaks).toHaveLength(1);
    expect(report.breaks[0]?.contentValidAroundBreak).toBeNull();
    expect(report.allBreaksContentValid).toBe(false); // null never counts as valid
  });

  it('finds multiple breaks across rotated segments, in chain order', () => {
    const seg1a = buildChain(3, 0);
    const seg1b = buildChain(3, 100); // break #1, still in the archived segment
    writeLines(path.join(auditDir, '2026-06.jsonl'), [...seg1a, ...seg1b]);
    const seg2 = buildChain(3, 200); // break #2, at the start of current.jsonl
    writeLines(path.join(auditDir, 'current.jsonl'), seg2);

    const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
    expect(report.breaks).toHaveLength(2);
    expect(report.breaks[0]?.file).toBe('2026-06.jsonl');
    expect(report.breaks[0]?.chainedIndex).toBe(3);
    expect(report.breaks[1]?.file).toBe('current.jsonl');
    expect(report.breaks[1]?.chainedIndex).toBe(6);
  });

  it('tallies malformed lines without counting them as chained', () => {
    const events = buildChain(3);
    const file = path.join(auditDir, 'current.jsonl');
    writeFileSync(
      file,
      `${events.map((e) => JSON.stringify(e)).join('\n')}\nnot valid json\n`,
      'utf-8',
    );
    const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
    expect(report.totalChained).toBe(3);
    expect(report.malformedLines).toBe(1);
  });

  describe('matchesCommittedHead', () => {
    it('is null when gitCwd is not passed (git check skipped entirely)', () => {
      const events = buildChain(3);
      writeLines(path.join(auditDir, 'current.jsonl'), events);
      const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
      expect(report.matchesCommittedHead).toBeNull();
    });

    it('is null when the directory is not inside a git work tree', () => {
      const events = buildChain(3);
      writeLines(path.join(auditDir, 'current.jsonl'), events);
      const notARepo: GitCommandRunner = () => ({ status: 128, stdout: '', stderr: 'not a repo' });
      const report = diagnoseAuditChain(auditDir, null, tempRoot, null, notARepo);
      expect(report.matchesCommittedHead).toBeNull();
    });

    it('is true when every audit file matches HEAD, false when one has a local diff', () => {
      const events = buildChain(3);
      writeLines(path.join(auditDir, 'current.jsonl'), events);
      const calls: string[][] = [];
      const cleanRunner: GitCommandRunner = (args) => {
        calls.push([...args]);
        if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' }; // diff --quiet: 0 = no diff
      };
      const clean = diagnoseAuditChain(auditDir, null, tempRoot, null, cleanRunner);
      expect(clean.matchesCommittedHead).toBe(true);
      expect(calls.some((c) => c[0] === 'diff' && c.includes('HEAD'))).toBe(true);

      const dirtyRunner: GitCommandRunner = (args) => {
        if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
        return { status: 1, stdout: '', stderr: '' }; // diff --quiet: 1 = local diff
      };
      const dirty = diagnoseAuditChain(auditDir, null, tempRoot, null, dirtyRunner);
      expect(dirty.matchesCommittedHead).toBe(false);
    });

    it('is false for an UNTRACKED audit file even though git diff --quiet exits 0', () => {
      // The audit .jsonl files are commonly gitignored/untracked. `git diff
      // --quiet HEAD -- <file>` exits 0 for an untracked file (nothing to
      // diff), so without the tracked check a never-committed head would be
      // trusted as committed — the anchor-of-trust false match.
      const events = buildChain(3);
      writeLines(path.join(auditDir, 'current.jsonl'), events);
      const untrackedRunner: GitCommandRunner = (args) => {
        if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
        // Untracked: ls-files --error-unmatch fails, but diff --quiet is 0.
        if (args[0] === 'ls-files') {
          return { status: 1, stdout: '', stderr: 'did not match any file(s) known to git' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      const report = diagnoseAuditChain(auditDir, null, tempRoot, null, untrackedRunner);
      expect(report.matchesCommittedHead).toBe(false);
    });

    it('is true for a TRACKED, unmodified audit file', () => {
      const events = buildChain(3);
      writeLines(path.join(auditDir, 'current.jsonl'), events);
      const trackedCleanRunner: GitCommandRunner = (args) => {
        if (args[0] === 'rev-parse') return { status: 0, stdout: 'true\n', stderr: '' };
        // Tracked (ls-files ok) and no diff (diff --quiet 0).
        return { status: 0, stdout: '', stderr: '' };
      };
      const report = diagnoseAuditChain(auditDir, null, tempRoot, null, trackedCleanRunner);
      expect(report.matchesCommittedHead).toBe(true);
    });
  });

  describe('per-machine tails', () => {
    it('diagnoses events inside a machine tail, not just the flat root', () => {
      // The chain lives under audit/m-<id>/, the real per-machine layout — a
      // walk of the flat root would find nothing and call it clean.
      const tail = path.join(auditDir, 'm-0123456789ab');
      mkdirSync(tail, { recursive: true });
      writeLines(path.join(tail, 'current.jsonl'), buildChain(5));

      const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
      expect(report.totalChained).toBe(5);
      expect(report.breaks).toHaveLength(0);
    });

    it('names the break with its tail so a multi-machine report is unambiguous', () => {
      const tail = path.join(auditDir, 'm-0123456789ab');
      mkdirSync(tail, { recursive: true });
      // A fresh chain start (break #1 at the tail genesis is expected: prev null)
      // then a discontinuity inside the tail.
      writeLines(path.join(tail, 'current.jsonl'), [...buildChain(3, 0), ...buildChain(2, 100)]);

      const report = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
      expect(report.breaks).toHaveLength(1);
      expect(report.breaks[0]?.file).toBe('m-0123456789ab/current.jsonl');
      expect(report.breaks[0]?.chainedIndex).toBe(3);
    });

    it('accepts a re-baselined tail genesis only when the resolver vouches for it', () => {
      // A tail whose oldest surviving event points at a dropped prefix's head —
      // the on-disk shape a retention prune leaves behind.
      const tail = path.join(auditDir, 'm-0123456789ab');
      mkdirSync(tail, { recursive: true });
      const survivors = buildChain(4);
      const droppedHead = 'a1'.repeat(32);
      const genesis = { ...survivors[0], prev_hash: droppedHead } as AuditEvent;
      genesis.hash = hmacEvent({ ...genesis, hash: undefined } as never, FIXTURE_SECRET);
      // Re-link the survivors to the re-based genesis hash.
      let prev = genesis.hash as string;
      const chained: AuditEvent[] = [genesis];
      for (let i = 1; i < 4; i++) {
        const e = { ...survivors[i], prev_hash: prev } as AuditEvent;
        e.hash = hmacEvent({ ...e, hash: undefined } as never, FIXTURE_SECRET);
        prev = e.hash as string;
        chained.push(e);
      }
      writeLines(path.join(tail, 'current.jsonl'), chained);

      // Without a resolver the dropped prefix reads as a genesis break.
      const bare = diagnoseAuditChain(auditDir, FIXTURE_SECRET, null, null, noGit);
      expect(bare.breaks).toHaveLength(1);
      expect(bare.breaks[0]?.chainedIndex).toBe(0);

      // With a resolver that vouches for exactly this tail's re-baseline, the
      // surviving genesis is accepted and the chain reads clean.
      const ok = diagnoseAuditChain(
        auditDir,
        FIXTURE_SECRET,
        null,
        (t) =>
          t.endsWith('m-0123456789ab')
            ? { anchorPrevHash: droppedHead, genesisHash: genesis.hash as string }
            : null,
        noGit,
      );
      expect(ok.breaks).toHaveLength(0);
      expect(ok.totalChained).toBe(4);
    });
  });
});

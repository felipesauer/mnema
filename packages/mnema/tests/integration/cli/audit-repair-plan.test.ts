import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditService } from '@mnema/core/services/integrity/audit-service.js';
import { hmacEvent } from '@mnema/core/storage/audit/audit-hash.js';

const FIXTURE_SECRET = Buffer.alloc(32, 7);

import { type AuditEvent, AuditWriter } from '@mnema/core/storage/audit/audit-writer.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planAuditRepair } from '@/cli/commands/audit-command.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/**
 * `planAuditRepair` is the pure, read-only single-pass planner behind
 * `mnema audit repair`. It gathers every recovery precondition and returns an
 * ordered plan naming the exact next command, so the operator never discovers
 * them one refusal at a time.
 */
describe('planAuditRepair', () => {
  let tempRoot: string;
  let auditDir: string;
  let adapter: SqliteAdapter;
  let state: AuditStateRepository;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-repair-plan-'));
    auditDir = path.join(tempRoot, 'audit');
    mkdirSync(auditDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    state = new AuditStateRepository(adapter);
  });
  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const writeEvents = (n: number): void => {
    const audit = new AuditService(new AuditWriter(auditDir, state, () => Buffer.alloc(32, 7)));
    for (let i = 0; i < n; i += 1) {
      audit.write({ kind: 'task_created', actor: 'a', data: { key: `T-${i}` } });
    }
  };

  const diskHashes = (): string[] => {
    const out: string[] = [];
    for (const line of readFileSync(path.join(auditDir, 'current.jsonl'), 'utf-8').split('\n')) {
      if (line.length === 0) continue;
      try {
        const e = JSON.parse(line) as { v?: number; hash?: string };
        if (typeof e.v === 'number' && e.v === 1 && typeof e.hash === 'string') out.push(e.hash);
      } catch {
        /* ignore */
      }
    }
    return out;
  };

  // Two independently-hashed sub-chains written back to back make ONE
  // content-VALID prev_hash seam (each line self-verifies; only the linkage
  // across the join is discontinuous) — the concurrent-writer shape.
  const buildChain = (
    n: number,
    startAt: number,
    startPrev: string | null = null,
  ): AuditEvent[] => {
    const events: AuditEvent[] = [];
    let prevHash = startPrev;
    for (let i = 0; i < n; i += 1) {
      const at = new Date(Date.UTC(2026, 5, 1, 0, 0, startAt + i)).toISOString();
      const unsealed: AuditEvent = {
        v: 1,
        at,
        kind: 'task_created',
        actor: 'dev',
        data: { key: `T-${startAt + i}` },
        prev_hash: prevHash,
      };
      const hash = hmacEvent(unsealed, FIXTURE_SECRET);
      events.push({ ...unsealed, hash });
      prevHash = hash;
    }
    return events;
  };
  const writeLines = (events: readonly AuditEvent[]): void => {
    writeFileSync(
      path.join(auditDir, 'current.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
      'utf-8',
    );
  };

  const plan = (over: Partial<Parameters<typeof planAuditRepair>[0]> = {}) =>
    planAuditRepair({
      auditDir,
      secret: null,
      mirrorCount: state.read().eventCount,
      signature: null,
      attestationArtifacts: [],
      ...over,
    });

  it('reports healthy and recommends no repair when mirror matches a clean disk', () => {
    writeEvents(3);
    const p = plan();
    expect(p.commands).toEqual([]);
    expect(p.recommendation).toContain('healthy');
    expect(p.findings.every((f) => f.severity === 'ok')).toBe(true);
  });

  it('blocks on a malformed line and recommends a manual fix first', () => {
    writeEvents(2);
    appendFileSync(path.join(auditDir, 'current.jsonl'), '{ not json\n', 'utf-8');
    const p = plan();
    expect(p.findings[0]?.severity).toBe('blocker');
    expect(p.recommendation).toContain('unparseable');
    expect(p.commands).toEqual([]);
  });

  it('recommends reconcile when the mirror is behind disk (fresh clone)', () => {
    writeEvents(3);
    state.forceReconcile(0, null, null); // mirror behind: 0 vs disk 3
    const p = plan({ mirrorCount: 0 });
    expect(p.commands).toEqual(['mnema audit reconcile --force']);
    expect(p.findings.some((f) => f.text.includes('BEHIND disk'))).toBe(true);
  });

  it('notes a one-ahead mirror self-heals but offers reconcile', () => {
    writeEvents(3);
    const p = plan({ mirrorCount: 4 });
    expect(p.findings.some((f) => f.text.includes('one AHEAD'))).toBe(true);
    expect(p.recommendation).toContain('self-heals');
    expect(p.commands).toEqual(['mnema audit reconcile --force']);
  });

  it('recommends reconcile for interior drift (signed head still on disk)', () => {
    writeEvents(5);
    const hashes = diskHashes();
    // A signed checkpoint attests more events than disk holds, but its covered
    // head is the real on-disk tail → interior drift, reconcile heals it.
    const p = plan({
      mirrorCount: 5,
      signature: { eventCountAt: 9, coveredHeadHash: hashes[hashes.length - 1] as string },
    });
    expect(p.findings.some((f) => f.text.includes('signed head IS on disk'))).toBe(true);
    expect(p.commands).toEqual(['mnema audit reconcile --force']);
  });

  it('recommends accept-truncation when the signed head is ABSENT from disk', () => {
    writeEvents(3);
    const p = plan({
      mirrorCount: 3,
      // A signed head that is not any on-disk hash → genuine truncation/fork.
      signature: { eventCountAt: 9, coveredHeadHash: 'deadbeef'.repeat(8) },
    });
    expect(p.findings.some((f) => f.text.includes('ABSENT from disk'))).toBe(true);
    expect(p.commands).toContain('mnema audit accept-truncation --require-committed --force');
  });

  it('never recommends accept-truncation while the chain is ALSO broken (it would refuse); routes to diagnose', () => {
    // The reachable combination the planner must not mishandle: a CONTENT-VALID
    // prev_hash seam co-occurring with a genuine truncation (a signed
    // checkpoint whose covered head is absent from disk). accept-truncation
    // refuses ANY broken chain unconditionally, so recommending it here would
    // hand the operator a command that immediately refuses. The plan must
    // route to diagnose first instead.
    const seamed = [...buildChain(5, 0), ...buildChain(4, 100)]; // one content-valid seam
    writeLines(seamed);

    const p = plan({
      mirrorCount: 9, // matchesCommittedHead === true → the break is a clean seam
      // A signed head that is not any on-disk hash → genuine truncation/fork.
      signature: { eventCountAt: 20, coveredHeadHash: 'deadbeef'.repeat(8) },
    });

    // A broken chain short-circuits to diagnose: accept-truncation would
    // refuse a broken chain, so the plan sends the operator to resolve the
    // break first — nothing else.
    expect(p.commands).not.toContain('mnema audit accept-truncation --require-committed --force');
    expect(p.commands).toEqual(['mnema audit diagnose']);
    expect(p.recommendation).toContain('Resolve the break FIRST');
  });

  it('tells the user to remove an overreaching .att before accepting a truncation', () => {
    writeEvents(3);
    const p = plan({
      mirrorCount: 3,
      signature: { eventCountAt: 9, coveredHeadHash: 'deadbeef'.repeat(8) },
      attestationArtifacts: [{ to: 3 }, { to: 6 }], // 6 > disk 3 → overreach
    });
    expect(p.recommendation).toContain('attest/6.att');
    expect(p.commands.some((c) => c.includes('accept-truncation'))).toBe(true);
  });

  it('is a pure computation — calling it does not change audit_state', () => {
    writeEvents(3);
    const before = state.read().eventCount;
    plan({ mirrorCount: 99 });
    expect(state.read().eventCount).toBe(before);
  });
});

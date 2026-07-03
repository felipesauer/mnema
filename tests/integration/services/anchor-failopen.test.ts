import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AnchorProvider, AnchorReceipt } from '@/services/anchor/anchor-provider.js';
import { AnchorScheduler } from '@/services/anchor/anchor-scheduler.js';
import { NoneAnchorProvider } from '@/services/anchor/none-anchor-provider.js';
import { AuditService } from '@/services/audit-service.js';
import { HeadCheckpointService } from '@/services/head-checkpoint.js';
import { MachineKeyService } from '@/services/machine-key.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@/storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '@/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const head = 'a'.repeat(64);

/** A provider whose stamp() resolution the test controls. */
class ControllableProvider implements AnchorProvider {
  readonly name = 'controllable';
  calls = 0;
  private resolveNext: ((r: AnchorReceipt) => void) | null = null;
  private mode: 'hang' | 'throw' | 'resolve' = 'resolve';

  setMode(mode: 'hang' | 'throw' | 'resolve'): void {
    this.mode = mode;
  }

  async stamp(h: string): Promise<AnchorReceipt> {
    this.calls += 1;
    if (this.mode === 'throw') throw new Error('stamp failed');
    if (this.mode === 'hang') {
      return new Promise<AnchorReceipt>((resolve) => {
        this.resolveNext = resolve;
      });
    }
    return { provider: this.name, head: h, blob: `proof:${h}`, status: 'anchored' };
  }

  /** Releases a hung stamp with a successful receipt. */
  release(h: string): void {
    this.resolveNext?.({ provider: this.name, head: h, blob: `proof:${h}`, status: 'anchored' });
  }

  async verify(): Promise<never> {
    throw new Error('not used in this test');
  }
}

describe('AnchorScheduler (off-path, fail-open)', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let anchors: AnchorRepository;
  let provider: ControllableProvider;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-failopen-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    anchors = new AnchorRepository(adapter);
    provider = new ControllableProvider();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns synchronously and records pending even when stamp() hangs', () => {
    provider.setMode('hang');
    const scheduler = new AnchorScheduler(anchors, provider);
    // onSignedHead must NOT block on the hung stamp — it returns at once,
    // and the head is already recorded pending for a later retry.
    scheduler.onSignedHead(head, 1);
    expect(anchors.read(head, 'controllable')?.status).toBe('pending');
    expect(provider.calls).toBe(1); // stamp was kicked off, not awaited
  });

  it('leaves the anchor pending when stamp() throws (fail-open)', async () => {
    provider.setMode('throw');
    const scheduler = new AnchorScheduler(anchors, provider);
    scheduler.onSignedHead(head, 1);
    await scheduler.settle(); // let the failing stamp settle
    // The failure never surfaced; the anchor is still pending for retry.
    expect(anchors.read(head, 'controllable')?.status).toBe('pending');
  });

  it('marks the anchor anchored once stamp() succeeds', async () => {
    provider.setMode('resolve');
    const scheduler = new AnchorScheduler(anchors, provider);
    scheduler.onSignedHead(head, 1);
    await scheduler.settle();
    const rec = anchors.read(head, 'controllable');
    expect(rec?.status).toBe('anchored');
    expect(rec?.receipt).toBe(`proof:${head}`);
    expect(rec?.confirmedAt).toBeTruthy();
  });

  it('a successful retry clears a pending anchor', async () => {
    provider.setMode('throw');
    const scheduler = new AnchorScheduler(anchors, provider);
    scheduler.onSignedHead(head, 1);
    await scheduler.settle();
    expect(anchors.read(head, 'controllable')?.status).toBe('pending');

    // Now the provider recovers; retryPending re-stamps the pending head.
    provider.setMode('resolve');
    scheduler.retryPending();
    await scheduler.settle();
    expect(anchors.read(head, 'controllable')?.status).toBe('anchored');
  });

  it('is inert for the none provider (records nothing, no stamp)', () => {
    const scheduler = new AnchorScheduler(anchors, new NoneAnchorProvider());
    scheduler.onSignedHead(head, 1);
    scheduler.retryPending();
    expect(anchors.read(head, 'none')).toBeNull();
    expect(anchors.listAll()).toHaveLength(0);
  });

  it('a write through the wired writer does not block on a hanging stamp', async () => {
    // Full path: a checkpoint signs the head, the writer hands it to the
    // scheduler AFTER releasing the lock, and the hung stamp never delays
    // the write. The write must return promptly and the anchor is pending.
    provider.setMode('hang');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    const projectRoot = tempRoot;
    const auditDir = path.join(tempRoot, '.audit');
    const state = new AuditStateRepository(adapter);
    const machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    // We need the SIGNED head hash to look up the anchor; capture it by
    // reading audit_state after the write (the checkpoint signs at interval 1).
    const checkpoint = new HeadCheckpointService(
      new AuditHeadSignatureRepository(adapter),
      () => ({ machineKey, actor: 'felipesauer' }),
      { events: 1, seconds: 100_000 },
    );
    const scheduler = new AnchorScheduler(anchors, provider);
    const audit = new AuditService(
      new AuditWriter(auditDir, state, undefined, null, checkpoint, scheduler),
    );

    const start = Date.now();
    audit.write({ kind: 'task_created', actor: 'felipesauer', data: { key: 'T-1' } });
    const elapsed = Date.now() - start;

    // The write returned without awaiting the hung stamp (generous bound;
    // the stamp promise never resolves in this test).
    expect(elapsed).toBeLessThan(2000);
    const signedHead = state.read().chainHeadHash as string;
    expect(anchors.read(signedHead, 'controllable')?.status).toBe('pending');
    expect(provider.calls).toBe(1);
  });
});

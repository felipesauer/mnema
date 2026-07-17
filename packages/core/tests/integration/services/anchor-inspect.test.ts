import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { anchorStatusCheck, inspectAnchors } from '@/services/anchor/anchor-inspect.js';
import type {
  AnchorProvider,
  AnchorReceipt,
  AnchorVerifyResult,
} from '@/services/anchor/anchor-provider.js';
import { AnchorRegistry } from '@/services/anchor/anchor-registry.js';
import { NoneAnchorProvider } from '@/services/anchor/none-anchor-provider.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@/storage/sqlite/repositories/anchor-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const head = 'a'.repeat(64);

/** A provider whose verify() verdict the test dictates by receipt blob. */
class StubProvider implements AnchorProvider {
  readonly name = 'stub';
  async stamp(h: string): Promise<AnchorReceipt> {
    return { provider: this.name, head: h, blob: 'ok', status: 'anchored' };
  }
  async verify(_h: string, receipt: AnchorReceipt): Promise<AnchorVerifyResult> {
    if (receipt.blob === 'broken') return { state: 'broken', detail: 'head mismatch' };
    if (receipt.blob === 'pending') return { state: 'pending', detail: 'maturing' };
    return { state: 'anchored', detail: 'ok' };
  }
}

describe('anchor inspection', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let anchors: AnchorRepository;
  let registry: AnchorRegistry;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-anchorinspect-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    anchors = new AnchorRepository(adapter);
    registry = new AnchorRegistry().register(new NoneAnchorProvider()).register(new StubProvider());
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('anchorStatusCheck (offline, for doctor)', () => {
    it('reports disabled for the none provider', () => {
      const c = anchorStatusCheck(anchors, 'none');
      expect(c.ok).toBe(true);
      expect(c.detail).toMatch(/disabled/i);
    });

    it('reports no anchors yet as a warning (never an error)', () => {
      const c = anchorStatusCheck(anchors, 'stub');
      expect(c.ok).toBe(true);
      expect(c.severity).toBe('warning');
      expect(c.detail).toMatch(/no anchors recorded/i);
    });

    it('summarises anchored vs pending counts', () => {
      anchors.upsert({ headHash: head, provider: 'stub', status: 'anchored', receipt: 'ok' });
      anchors.upsert({
        headHash: 'b'.repeat(64),
        provider: 'stub',
        status: 'pending',
        receipt: null,
      });
      const c = anchorStatusCheck(anchors, 'stub');
      expect(c.detail).toMatch(/1 anchored, 1 pending/);
      expect(c.severity).toBe('warning'); // a pending anchor warns
    });
  });

  describe('inspectAnchors (online, for --verify-anchors)', () => {
    it('verifies anchored receipts against the provider', async () => {
      anchors.upsert({ headHash: head, provider: 'stub', status: 'anchored', receipt: 'ok' });
      const [c] = await inspectAnchors(anchors, registry, 'stub', true);
      expect(c?.ok).toBe(true);
      expect(c?.detail).toMatch(/1 verified/);
    });

    it('reports an error when a receipt fails verification', async () => {
      anchors.upsert({ headHash: head, provider: 'stub', status: 'anchored', receipt: 'broken' });
      const [c] = await inspectAnchors(anchors, registry, 'stub', true);
      expect(c?.ok).toBe(false);
      expect(c?.severity).toBe('error');
      expect(c?.detail).toMatch(/failed verification/i);
    });

    it('treats a still-maturing proof as pending (warning, not error)', async () => {
      anchors.upsert({ headHash: head, provider: 'stub', status: 'pending', receipt: 'pending' });
      const [c] = await inspectAnchors(anchors, registry, 'stub', true);
      expect(c?.ok).toBe(true);
      expect(c?.detail).toMatch(/pending/);
    });

    it('a clone with no anchors is never red (none provider)', async () => {
      const [c] = await inspectAnchors(anchors, registry, 'none', true);
      expect(c?.ok).toBe(true);
      expect(c?.detail).toMatch(/disabled/i);
    });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AnchorProvider, AnchorReceipt } from '@/services/anchor/anchor-provider.js';
import { AnchorScheduler } from '@/services/anchor/anchor-scheduler.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AnchorRepository } from '@/storage/sqlite/repositories/anchor-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

/** A provider that counts stamp calls and always anchors synchronously. */
class CountingProvider implements AnchorProvider {
  readonly name = 'counting';
  stamps = 0;
  async stamp(head: string): Promise<AnchorReceipt> {
    this.stamps += 1;
    return { provider: this.name, head, blob: `proof:${head}`, status: 'anchored' };
  }
  async verify(): Promise<never> {
    throw new Error('unused');
  }
}

/**
 * The anchor scheduler must honour `audit.anchor.interval` — anchoring at the
 * configured cadence, NOT once per signed head. Before the fix the interval
 * was ignored and every signed head produced an anchor.
 */
describe('AnchorScheduler honours the anchor interval', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let anchors: AnchorRepository;
  let provider: CountingProvider;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-anchorint-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    anchors = new AnchorRepository(adapter);
    provider = new CountingProvider();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const head = (n: number) => `${n}`.padStart(64, '0');

  it('anchors every 3 events, not every signed head (events interval)', async () => {
    const scheduler = new AnchorScheduler(anchors, provider, { events: 3 });
    // Simulate 6 signed heads at event counts 1..6.
    for (let ec = 1; ec <= 6; ec += 1) {
      scheduler.onSignedHead(head(ec), ec);
    }
    await scheduler.settle();
    // First anchor fires immediately at ec=1 (baseline null → always due),
    // second at ec=4 (3 events after the ec=1 baseline). ec=2,3,5,6 are
    // below the interval. Two anchors from six signed heads — the interval
    // is honoured, not one-per-head.
    expect(provider.stamps).toBe(2);
    expect(anchors.listAll()).toHaveLength(2);
  });

  it('anchors on every signed head when the interval is empty (default cadence)', async () => {
    const scheduler = new AnchorScheduler(anchors, provider, {});
    for (let ec = 1; ec <= 4; ec += 1) {
      scheduler.onSignedHead(head(ec), ec);
    }
    await scheduler.settle();
    expect(provider.stamps).toBe(4);
  });

  it('does not anchor below the events interval', async () => {
    const scheduler = new AnchorScheduler(anchors, provider, { events: 100 });
    for (let ec = 1; ec <= 5; ec += 1) {
      scheduler.onSignedHead(head(ec), ec);
    }
    await scheduler.settle();
    // 5 events, interval 100 → never reaches the threshold, but the FIRST
    // anchor fires once (baseline null → first anchor is due immediately),
    // then nothing more until +100.
    expect(provider.stamps).toBe(1);
  });

  it('the first anchor always fires (baseline null), regardless of interval', async () => {
    const scheduler = new AnchorScheduler(anchors, provider, { events: 100, seconds: 999999 });
    scheduler.onSignedHead(head(1), 1);
    await scheduler.settle();
    expect(provider.stamps).toBe(1);
    expect(anchors.latestForProvider('counting')?.eventCountAt).toBe(1);
  });
});

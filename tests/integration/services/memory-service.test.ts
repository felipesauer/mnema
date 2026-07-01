import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { MemoryService } from '@/services/memory-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { MemoryRepository } from '@/storage/sqlite/repositories/memory-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('MemoryService', () => {
  let tempRoot: string;
  let memoryDir: string;
  let adapter: SqliteAdapter;
  let service: MemoryService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-mem-svc-'));
    memoryDir = path.join(tempRoot, '.mnema', 'memory');
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const repo = new MemoryRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    identity.ensureActor('daniel', ActorKind.Human);

    service = new MemoryService(memoryDir, repo, identity, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a memory on first record', () => {
    const result = service.record({
      slug: 'pci-compliance',
      title: 'Client requires PCI-DSS',
      content: 'Anything touching payment data needs an audit trail.',
      topics: ['compliance'],
      actor: 'daniel',
    });
    expect(result.action).toBe('created');
    expect(result.memory.slug).toBe('pci-compliance');
    expect(existsSync(path.join(memoryDir, 'pci-compliance.md'))).toBe(true);
  });

  it('upserts (updates) when slug already exists', () => {
    service.record({
      slug: 's',
      title: 'A',
      content: 'first',
      actor: 'daniel',
    });
    const updated = service.record({
      slug: 's',
      title: 'A',
      content: 'second',
      actor: 'daniel',
    });
    expect(updated.action).toBe('updated');
    expect(updated.memory.content).toBe('second');
  });

  it('no-ops when content is byte-equal', () => {
    service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    const again = service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(again.action).toBe('no_op');
  });

  it('no_op does NOT advance updated_at', async () => {
    const first = service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    // Sleep enough that a different millisecond would be visible if the
    // service still ran the UPDATE on no_op.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const again = service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(again.action).toBe('no_op');
    expect(again.memory.updatedAt).toBe(first.memory.updatedAt);
  });

  it('no_op regenerates the mirror when the file went missing', () => {
    const r = service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    const mirrorPath = path.join(memoryDir, 's.md');
    expect(existsSync(mirrorPath)).toBe(true);
    rmSync(mirrorPath);

    const again = service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(again.action).toBe('no_op');
    expect(again.memory.updatedAt).toBe(r.memory.updatedAt);
    expect(existsSync(mirrorPath)).toBe(true);
  });

  it('list filters by topic', () => {
    service.record({
      slug: 'a',
      title: 'A',
      content: 'a',
      topics: ['x'],
      actor: 'daniel',
    });
    service.record({
      slug: 'b',
      title: 'B',
      content: 'b',
      topics: ['y'],
      actor: 'daniel',
    });
    expect(service.list('x')).toHaveLength(1);
    expect(service.list('y')).toHaveLength(1);
    expect(service.list()).toHaveLength(2);
  });

  it('delete removes the row', () => {
    service.record({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(service.delete('s', 'daniel')).toBe(true);
    const shown = service.show('s');
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.error.kind).toBe(ErrorCode.MemoryNotFound);
  });

  it('writes a mirror .md with title in frontmatter', () => {
    service.record({
      slug: 'x',
      title: 'My title',
      content: 'body',
      actor: 'daniel',
    });
    const mirror = readFileSync(path.join(memoryDir, 'x.md'), 'utf-8');
    expect(mirror).toContain('title: My title');
    expect(mirror).toContain('body');
  });

  it('2.3: rebuildMirrors recreates missing mirrors and leaves present ones intact', () => {
    service.record({ slug: 'a', title: 'A', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', title: 'B', content: 'y', actor: 'daniel' });
    const mirrorA = path.join(memoryDir, 'a.md');
    const mirrorB = path.join(memoryDir, 'b.md');
    rmSync(mirrorA);
    const before = readFileSync(mirrorB, 'utf-8');

    const rebuilt = service.rebuildMirrors();
    expect(rebuilt).toEqual(['a']);
    expect(existsSync(mirrorA)).toBe(true);
    expect(readFileSync(mirrorB, 'utf-8')).toBe(before);
  });

  it('archive hides a memory from the default listing but keeps it', () => {
    service.record({ slug: 'old-fact', title: 'Old', content: 'stale', actor: 'daniel' });
    service.record({ slug: 'live-fact', title: 'Live', content: 'fresh', actor: 'daniel' });

    const mirror = path.join(memoryDir, 'old-fact.md');
    expect(existsSync(mirror)).toBe(true);

    expect(service.archive('old-fact', 'daniel')).toBe(true);
    // Default list excludes the archived one…
    expect(
      service
        .list()
        .map((m) => m.slug)
        .sort(),
    ).toEqual(['live-fact']);
    // …but the row survives (show still finds it, marked archived).
    const shown = service.show('old-fact');
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value.archivedAt).not.toBeNull();
    // …and the mirror no longer lingers on disk as a live-looking entry.
    expect(existsSync(mirror)).toBe(false);
  });

  it('archive is a no-op (false) for an unknown or already-archived slug', () => {
    expect(service.archive('nope', 'daniel')).toBe(false);
    service.record({ slug: 's', title: 'S', content: 'x', actor: 'daniel' });
    expect(service.archive('s', 'daniel')).toBe(true);
    expect(service.archive('s', 'daniel')).toBe(false); // already archived
  });

  it('re-recording an archived slug reactivates it and restores its mirror', () => {
    const mirror = path.join(memoryDir, 's.md');
    service.record({ slug: 's', title: 'S', content: 'x', actor: 'daniel' });
    service.archive('s', 'daniel');
    expect(existsSync(mirror)).toBe(false); // archive removed it
    service.record({ slug: 's', title: 'S', content: 'refreshed', actor: 'daniel' });
    // Back in the default listing, no longer archived, mirror rewritten.
    expect(service.list().map((m) => m.slug)).toContain('s');
    const shown = service.show('s');
    if (shown.ok) expect(shown.value.archivedAt).toBeNull();
    expect(existsSync(mirror)).toBe(true);
  });
});

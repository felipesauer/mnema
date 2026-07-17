import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { MemoryService } from '@/services/knowledge/memory-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { parseFrontmatter } from '@/storage/markdown/frontmatter.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { MemoryRepository } from '@/storage/sqlite/repositories/memory-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/** Finds `<slug>.md` anywhere one level under the memory dir (scope folders). */
function findMemoryMirror(memoryDir: string, slug: string): string | null {
  const direct = path.join(memoryDir, `${slug}.md`);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = path.join(memoryDir, entry.name, `${slug}.md`);
      if (existsSync(nested)) return nested;
    }
  }
  return null;
}

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

  // record() returns a Result; these tests assert the happy path, so unwrap.
  function recordOk(input: Parameters<MemoryService['record']>[0]) {
    const result = service.record(input);
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
    return result.value;
  }

  it('creates a memory on first record', () => {
    const result = recordOk({
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

  it('rejects tool-invocation markup leaking into content (the reported trailer)', () => {
    const result = service.record({
      slug: 'leaked',
      title: 'A',
      content: 'body text.</content>\n<topics>["ci","ruleset"]</topics>',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['content']);
    expect(result.error.issues[0]?.message).toMatch(/pass each field as its own argument/);
    // Nothing was persisted (the screen precedes the upsert + audit write).
    expect(service.list()).toHaveLength(0);
    expect(existsSync(path.join(memoryDir, 'leaked.md'))).toBe(false);
  });

  it('rejects tool-invocation markup leaking into title', () => {
    const result = service.record({
      slug: 'leaked-title',
      title: 'oops</title>\n<parameter name="content">x',
      content: 'clean body',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['title']);
  });

  it('records topics on clean input and reads them back (parser is fine)', () => {
    const created = recordOk({
      slug: 'topical',
      title: 'Topical fact',
      content: 'A perfectly clean body about CI and rulesets.',
      topics: ['ci', 'ruleset'],
      actor: 'daniel',
    });
    expect(created.memory.topics).toEqual(['ci', 'ruleset']);
    const shown = service.show('topical');
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value.topics).toEqual(['ci', 'ruleset']);
  });

  it('upserts (updates) when slug already exists', () => {
    service.record({
      slug: 's',
      title: 'A',
      content: 'first',
      actor: 'daniel',
    });
    const updated = recordOk({
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
    const again = recordOk({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(again.action).toBe('no_op');
  });

  it('no_op does NOT advance updated_at', async () => {
    const first = recordOk({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    // Sleep enough that a different millisecond would be visible if the
    // service still ran the UPDATE on no_op.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const again = recordOk({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    expect(again.action).toBe('no_op');
    expect(again.memory.updatedAt).toBe(first.memory.updatedAt);
  });

  it('no_op regenerates the mirror when the file went missing', () => {
    const r = recordOk({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
    const mirrorPath = path.join(memoryDir, 's.md');
    expect(existsSync(mirrorPath)).toBe(true);
    rmSync(mirrorPath);

    const again = recordOk({ slug: 's', title: 'A', content: 'x', actor: 'daniel' });
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
    // A scopeless memory's mirror omits the scope field entirely.
    expect(mirror).not.toContain('scope:');
  });

  it('persists the RAW scope in a scoped memory mirror frontmatter', () => {
    service.record({
      slug: 'notifier-rate',
      title: 'N',
      content: 'body',
      scope: 'packages/notifier',
      actor: 'daniel',
    });
    const mirror = readFileSync(
      path.join(memoryDir, 'packages-notifier', 'notifier-rate.md'),
      'utf-8',
    );
    // The folder is the lossy projection; the frontmatter carries the raw
    // scope, emitted as a JSON-quoted string so it always round-trips.
    expect(mirror).toContain('scope: "packages/notifier"');
  });

  it('round-trips a scope that YAML would otherwise re-type (123 / true / null)', () => {
    // These barewords parse back as number/boolean/null unless quoted; the
    // mirror must emit them as strings so the scope survives a clone rebuild.
    const cases: Array<[slug: string, scope: string]> = [
      ['scope-num', '123'],
      ['scope-bool', 'true'],
      ['scope-null-word', 'null'],
      ['scope-tilde', '~'],
      ['scope-hex', '0x1F'],
    ];
    for (const [slug, scope] of cases) {
      recordOk({ slug, title: 'T', content: 'b', scope, actor: 'daniel' });
      // Locate the mirror wherever the (lossy) scope folder placed it, then
      // parse it back exactly as a clone rebuild would.
      const mirrorPath = findMemoryMirror(memoryDir, slug);
      expect(mirrorPath, scope).not.toBeNull();
      const parsed = parseFrontmatter(readFileSync(mirrorPath as string, 'utf-8'));
      expect(parsed.data.scope, scope).toBe(scope);
      expect(typeof parsed.data.scope, scope).toBe('string');
    }
  });

  it('backfillScopeInMirrors adds scope to a scoped mirror written without it', () => {
    service.record({
      slug: 'notifier-rate',
      title: 'N',
      content: 'body',
      scope: 'packages/notifier',
      actor: 'daniel',
    });
    const mirrorPath = path.join(memoryDir, 'packages-notifier', 'notifier-rate.md');
    // Simulate a pre-scope mirror: strip the scope line, keep everything else.
    const stripped = readFileSync(mirrorPath, 'utf-8')
      .split('\n')
      .filter((l) => !l.startsWith('scope:'))
      .join('\n');
    writeFileSync(mirrorPath, stripped);
    expect(readFileSync(mirrorPath, 'utf-8')).not.toContain('scope:');

    const done = service.backfillScopeInMirrors();
    expect(done).toEqual(['notifier-rate']);
    expect(readFileSync(mirrorPath, 'utf-8')).toContain('scope: "packages/notifier"');

    // Idempotent: a second pass rewrites nothing.
    expect(service.backfillScopeInMirrors()).toEqual([]);
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

  it('ADR-51: a scoped memory mirrors under a scope folder, scopeless at root', () => {
    service.record({ slug: 'global', title: 'G', content: 'x', actor: 'daniel' });
    service.record({
      slug: 'notifier-rate',
      title: 'N',
      content: 'y',
      scope: 'packages/notifier',
      actor: 'daniel',
    });
    // Scopeless → root; scoped → flattened scope folder.
    expect(existsSync(path.join(memoryDir, 'global.md'))).toBe(true);
    expect(existsSync(path.join(memoryDir, 'packages-notifier', 'notifier-rate.md'))).toBe(true);
    expect(existsSync(path.join(memoryDir, 'notifier-rate.md'))).toBe(false);
  });

  it('ADR-51: a scope of "decisions"/"notes" does NOT land in the curated folders', () => {
    // Regression: scopeFolder must suffix a reserved name so a scoped memory
    // never mixes into the human-curated decisions/notes trees.
    service.record({
      slug: 'reserved-a',
      title: 'A',
      content: 'x',
      scope: 'decisions',
      actor: 'daniel',
    });
    service.record({
      slug: 'reserved-b',
      title: 'B',
      content: 'y',
      scope: 'Notes',
      actor: 'daniel',
    });
    expect(existsSync(path.join(memoryDir, 'decisions-scope', 'reserved-a.md'))).toBe(true);
    expect(existsSync(path.join(memoryDir, 'notes-scope', 'reserved-b.md'))).toBe(true);
    // NOT inside the curated folders.
    expect(existsSync(path.join(memoryDir, 'decisions', 'reserved-a.md'))).toBe(false);
    expect(existsSync(path.join(memoryDir, 'notes', 'reserved-b.md'))).toBe(false);
  });

  it('ADR-51: an interrupted migration leaving two mirrors is reconciled to one', () => {
    // BUG3: writeMirror must remove ALL stale copies, not just the first found.
    service.record({ slug: 'dup', title: 'D', content: 'v1', scope: 'area-a', actor: 'daniel' });
    const canonical = path.join(memoryDir, 'area-a', 'dup.md');
    // Simulate a leftover flat copy from a crashed migration.
    writeFileSync(path.join(memoryDir, 'dup.md'), '# stale flat\n', 'utf-8');
    expect(existsSync(canonical) && existsSync(path.join(memoryDir, 'dup.md'))).toBe(true);
    // A real re-record must collapse to exactly one mirror (the canonical one).
    service.record({ slug: 'dup', title: 'D', content: 'v2', scope: 'area-a', actor: 'daniel' });
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(path.join(memoryDir, 'dup.md'))).toBe(false);
  });

  it('ADR-51: changing scope relocates the mirror (one mirror per row)', () => {
    service.record({
      slug: 'moving',
      title: 'M',
      content: 'v1',
      scope: 'area-a',
      actor: 'daniel',
    });
    expect(existsSync(path.join(memoryDir, 'area-a', 'moving.md'))).toBe(true);
    // Re-record with a new scope + changed content.
    service.record({
      slug: 'moving',
      title: 'M',
      content: 'v2',
      scope: 'area-b',
      actor: 'daniel',
    });
    expect(existsSync(path.join(memoryDir, 'area-b', 'moving.md'))).toBe(true);
    // The old location is gone — never two mirrors for one row.
    expect(existsSync(path.join(memoryDir, 'area-a', 'moving.md'))).toBe(false);
  });

  it('ADR-51: rebuildMirrors migrates a flat pre-layout file into its scope folder', () => {
    service.record({
      slug: 'legacy',
      title: 'L',
      content: 'z',
      scope: 'legacy-area',
      actor: 'daniel',
    });
    const canonical = path.join(memoryDir, 'legacy-area', 'legacy.md');
    const flat = path.join(memoryDir, 'legacy.md');
    // Simulate a pre-ADR-51 flat mirror: move the file to the root.
    rmSync(canonical);
    writeFileSync(flat, '# stale flat\n', 'utf-8');

    const rebuilt = service.rebuildMirrors();
    expect(rebuilt).toContain('legacy');
    expect(existsSync(canonical)).toBe(true); // migrated into the folder
    expect(existsSync(flat)).toBe(false); // flat leftover removed
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

  it('re-recording an archived memory with IDENTICAL content reactivates it (not a no_op)', () => {
    // The audited gap: isNoOp compared only title/content/topics/scope, so an
    // identical re-record of an archived slug short-circuited before the
    // upsert that clears archived_at — the memory stayed silently hidden
    // while the tool promised re-recording reactivates it.
    service.record({ slug: 'zombie', title: 'Z', content: 'same body', actor: 'daniel' });
    expect(service.archive('zombie', 'daniel')).toBe(true);
    expect(service.list().map((m) => m.slug)).not.toContain('zombie');

    const rerecord = service.record({
      slug: 'zombie',
      title: 'Z',
      content: 'same body',
      actor: 'daniel',
    });
    expect(rerecord.ok).toBe(true);
    if (rerecord.ok) expect(rerecord.value.action).toBe('updated'); // NOT no_op
    // Reactivated: back in the default listing, archivedAt cleared.
    expect(service.list().map((m) => m.slug)).toContain('zombie');
    const shown = service.show('zombie');
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.value.archivedAt).toBeNull();
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

  it('supersede points the old memory at its successor and drops it from listing', () => {
    service.record({ slug: 'old-way', title: 'Old', content: 'the old approach', actor: 'daniel' });
    service.record({ slug: 'new-way', title: 'New', content: 'the new approach', actor: 'daniel' });
    const mirror = path.join(memoryDir, 'old-way.md');
    expect(existsSync(mirror)).toBe(true);

    const result = service.supersede('old-way', 'new-way', 'daniel');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe('new-way');

    // The superseded memory drops from the default listing…
    expect(service.list().map((m) => m.slug)).toEqual(['new-way']);
    // …but the row survives, now carrying the pointer (and marked archived).
    const shown = service.show('old-way');
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      expect(shown.value.supersededBy).toBe('new-way');
      expect(shown.value.archivedAt).not.toBeNull();
    }
    // …and its mirror no longer lingers as a live-looking entry.
    expect(existsSync(mirror)).toBe(false);
  });

  it('supersede rejects a memory superseding itself with SELF_SUPERSEDE', () => {
    service.record({ slug: 's', title: 'S', content: 'x', actor: 'daniel' });
    const result = service.supersede('s', 's', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SelfSupersede);
      if (result.error.kind === ErrorCode.SelfSupersede) {
        expect(result.error.entity).toBe('memory');
        expect(result.error.ref).toBe('s');
      }
    }
    // The row is untouched — still active, no pointer.
    const shown = service.show('s');
    if (shown.ok) expect(shown.value.supersededBy).toBeNull();
  });

  it('re-recording a superseded slug is rejected (supersede is one-way)', () => {
    service.record({ slug: 'a', title: 'A', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', title: 'B', content: 'y', actor: 'daniel' });
    expect(service.supersede('a', 'b', 'daniel').ok).toBe(true);

    const result = service.record({ slug: 'a', title: 'A', content: 'revived', actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SupersededEntity);
      if (result.error.kind === ErrorCode.SupersededEntity) {
        expect(result.error.entity).toBe('memory');
        expect(result.error.ref).toBe('a');
      }
    }
    // The row stays superseded and out of the listing — no silent revival.
    expect(service.list().map((m) => m.slug)).toEqual(['b']);
    const shown = service.show('a');
    if (shown.ok) expect(shown.value.supersededBy).toBe('b');
  });

  it('supersede rejects a target that is already superseded (no silent no-op)', () => {
    service.record({ slug: 'a', title: 'A', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', title: 'B', content: 'y', actor: 'daniel' });
    service.record({ slug: 'c', title: 'C', content: 'z', actor: 'daniel' });
    expect(service.supersede('a', 'b', 'daniel').ok).toBe(true);

    // Re-superseding 'a' toward a different successor must not silently succeed.
    const result = service.supersede('a', 'c', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SupersededEntity);
      if (result.error.kind === ErrorCode.SupersededEntity) expect(result.error.ref).toBe('a');
    }
    // The pointer still aims at the original successor, unchanged.
    const shown = service.show('a');
    if (shown.ok) expect(shown.value.supersededBy).toBe('b');
  });

  it('supersede rejects a successor that is itself already superseded', () => {
    service.record({ slug: 'a', title: 'A', content: 'x', actor: 'daniel' });
    service.record({ slug: 'b', title: 'B', content: 'y', actor: 'daniel' });
    service.record({ slug: 'c', title: 'C', content: 'z', actor: 'daniel' });
    expect(service.supersede('a', 'b', 'daniel').ok).toBe(true); // a is now retired

    // c cannot be superseded by a (a is dead).
    const result = service.supersede('c', 'a', 'daniel');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorCode.SupersededEntity);
      if (result.error.kind === ErrorCode.SupersededEntity) expect(result.error.ref).toBe('a');
    }
    // c is untouched — still active.
    const shown = service.show('c');
    if (shown.ok) expect(shown.value.supersededBy).toBeNull();
  });

  it('supersede errors when the target or the successor is unknown', () => {
    service.record({ slug: 'exists', title: 'E', content: 'x', actor: 'daniel' });

    const unknownTarget = service.supersede('ghost', 'exists', 'daniel');
    expect(unknownTarget.ok).toBe(false);
    if (!unknownTarget.ok) {
      expect(unknownTarget.error.kind).toBe(ErrorCode.MemoryNotFound);
      if (unknownTarget.error.kind === ErrorCode.MemoryNotFound) {
        expect(unknownTarget.error.slug).toBe('ghost');
      }
    }

    const unknownSuccessor = service.supersede('exists', 'ghost', 'daniel');
    expect(unknownSuccessor.ok).toBe(false);
    if (!unknownSuccessor.ok) {
      expect(unknownSuccessor.error.kind).toBe(ErrorCode.MemoryNotFound);
      if (unknownSuccessor.error.kind === ErrorCode.MemoryNotFound) {
        expect(unknownSuccessor.error.slug).toBe('ghost');
      }
    }
  });

  it('refuses a path-traversal slug and writes nothing outside the memory dir', () => {
    const result = service.record({
      slug: '../../etc/x',
      title: 'Escaped',
      content: 'should never land on disk',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['slug']);
    // Nothing persisted, and no file escaped the project via the mirror.
    expect(service.list()).toHaveLength(0);
    expect(existsSync(path.join(memoryDir, '..', '..', 'etc', 'x.md'))).toBe(false);
  });

  it('refuses an over-long title via the service (CLI/MCP parity)', () => {
    const result = service.record({
      slug: 'too-long',
      title: 'x'.repeat(201),
      content: 'body',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['title']);
    expect(service.list()).toHaveLength(0);
  });

  it('a re-record that changes ONLY the scope is not swallowed as a no-op', () => {
    // Audit MEDIUM: scope was omitted from the no-op comparison, so setting a
    // scope on an existing memory (same title/content) silently dropped it.
    recordOk({ slug: 'scoped', title: 'T', content: 'body', actor: 'daniel' });
    const second = recordOk({
      slug: 'scoped',
      title: 'T',
      content: 'body',
      scope: 'packages/notifier',
      actor: 'daniel',
    });
    expect(second.action).toBe('updated');
    expect(second.memory.scope).toBe('packages/notifier');
    // And an identical re-record (scope unchanged) IS still a no-op.
    const third = recordOk({
      slug: 'scoped',
      title: 'T',
      content: 'body',
      scope: 'packages/notifier',
      actor: 'daniel',
    });
    expect(third.action).toBe('no_op');
  });

  describe('contradict (typed obsoletes relation)', () => {
    function seed(slug: string) {
      recordOk({ slug, title: slug, content: `body of ${slug}`, actor: 'daniel' });
    }
    function obsoletedBy(slug: string): string | null {
      const r = service.show(slug);
      if (!r.ok) throw new Error(`memory ${slug} not found`);
      return r.value.obsoletedBy;
    }

    it('records the relation and de-ranks the obsoleted memory', () => {
      seed('old-truth');
      seed('new-truth');
      const r = service.contradict('new-truth', 'old-truth', 'daniel');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.obsoletedBy).toBe('new-truth');
    });

    it('rejects an archived contradictor instead of leaving a dangling reference', () => {
      seed('retired');
      seed('current');
      expect(service.archive('retired', 'daniel')).toBe(true);
      const r = service.contradict('retired', 'current', 'daniel');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe(ErrorCode.SupersededEntity);
      // `current` was NOT de-ranked in favour of an invisible memory.
      expect(obsoletedBy('current')).toBeNull();
    });

    it('contradicting an already-obsoleted memory errors instead of a silent success', () => {
      seed('a');
      seed('b');
      seed('target');
      expect(service.contradict('a', 'target', 'daniel').ok).toBe(true);
      const second = service.contradict('b', 'target', 'daniel');
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.kind).toBe(ErrorCode.AlreadyObsoleted);
      // The pointer stays on the first contradictor, not silently overwritten.
      expect(obsoletedBy('target')).toBe('a');
    });

    it('re-issuing the SAME contradiction is an idempotent success', () => {
      seed('x');
      seed('y');
      expect(service.contradict('x', 'y', 'daniel').ok).toBe(true);
      const again = service.contradict('x', 'y', 'daniel');
      expect(again.ok).toBe(true);
    });
  });
});

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContentAttestation } from '@/services/audit/attestation-cli.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { writeArtifact } from '@/services/audit/attestation-store.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity } from '@/services/integrity/audit-integrity.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { HMAC_ID_RELATIVE } from '@/services/integrity/project-secret.js';
import { EVENT_FORMAT_VERSION } from '@/storage/audit/audit-hash.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { AuditStateRepository } from '@/storage/sqlite/repositories/audit-state-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const ACTOR = 'felipesauer';
const SECRET = Buffer.alloc(32, 7);

/**
 * The wave-1 promise, exercised end to end from the seat of an ANONYMOUS clone:
 * someone who has the committed `.mnema/` (chain, `.att`, `.pub`, the HMAC
 * fingerprint) but NOT the project secret and NOT any private key. On that
 * clone the verify must:
 *
 *   (a) confirm the chain is STRUCTURALLY continuous (prev_hash links), while
 *       saying plainly that per-line HMAC authenticity is UNPROVEN without the
 *       secret — a warning, never a false-green and never a false-tamper;
 *   (b) verify the committed content attestation `.att` GREEN — Ed25519 over a
 *       content root anyone can recompute, which is what actually closes the
 *       anonymous gap;
 *   (c) go RED on a real tamper (an edited line), and refuse a synthetic line
 *       whose version tag is not the event format (never "legacy-accepted").
 */
describe('the anonymous-clone promise', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let userDir: string;
  let adapter: SqliteAdapter;
  let machineKey: MachineKeyService;
  let projectHmacId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-anon-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    machineKey = new MachineKeyService(projectRoot, ACTOR, userDir);
    // Commit the signer .pub (a trust anchor an anonymous clone resolves against).
    machineKey.getOrCreate();
    // The committed HMAC fingerprint (public — binds the .att to this project).
    projectHmacId = 'ab'.repeat(32);
    const fp = path.join(projectRoot, HMAC_ID_RELATIVE);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, `${projectHmacId}\n`, 'utf-8');
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /**
   * The tail the local writer produced. The writer appends to the dir it is
   * given, so here that is `auditDir` itself — the degenerate single-tail shape
   * `auditTailDirs` treats as one tail. A real multi-machine layout nests it
   * under `m-<id>/`, but a single writer's chain verifies identically either
   * way; this keeps the fixture to the promise, not the tail plumbing.
   */
  function tailDir(): string {
    const nested = readdirSync(auditDir, { withFileTypes: true }).find(
      (d) => d.isDirectory() && /^m-[0-9a-f]{12}$/.test(d.name),
    );
    return nested ? path.join(auditDir, nested.name) : auditDir;
  }

  /** Writes `n` real HMAC-keyed events through the production writer. */
  function writeChain(n: number): void {
    const audit = new AuditService(
      new AuditWriter(auditDir, new AuditStateRepository(adapter), () => SECRET),
    );
    for (let i = 0; i < n; i++) {
      audit.write({ kind: 'task_created', actor: ACTOR, data: { key: `T-${i}` } });
    }
  }

  /** Commits an `.att` over the whole local tail, signed by the machine key. */
  function attestLocalTail(): void {
    const dir = tailDir();
    const walk = walkChainedEvents(dir);
    writeArtifact(
      dir,
      emitAttestation(walk, 0, walk.chained.length, { machineKey, actor: ACTOR }, projectHmacId),
    );
  }

  /** The verify an anonymous clone runs: NO secret, real `.att` verdict. */
  function verifyAsAnonymous() {
    return inspectAuditIntegrity(
      adapter,
      auditDir,
      null, // ← the anonymous clone has no project secret
      null,
      buildContentAttestation(projectRoot, auditDir),
      null,
      tailDir(),
    );
  }

  it('reads chain-continuous + authenticity-unproven + .att GREEN with no secret', () => {
    writeChain(4);
    attestLocalTail();

    const checks = verifyAsAnonymous();
    const by = (name: string) => checks.find((c) => c.name === name);

    // (a) structural continuity holds; HMAC authenticity is an honest warning.
    expect(by('audit hash chain')?.ok).toBe(true);
    const auth = by('audit authenticity');
    expect(auth?.ok).toBe(false);
    expect(auth?.severity).toBe('warning');
    expect(auth?.detail).toMatch(/secret not present/i);

    // (b) the .att closes the gap: content attestation verifies GREEN.
    const att = by('audit content attestation');
    expect(att?.ok).toBe(true);
    expect(att?.severity).toBeUndefined();
  });

  it('goes RED for an edited chain line, even with the .att present', () => {
    writeChain(4);
    attestLocalTail();

    // Tamper: rewrite an event's payload without recomputing its hash.
    const file = path.join(tailDir(), 'current.jsonl');
    const lines = readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    const event = JSON.parse(lines[1] as string) as Record<string, unknown>;
    event.actor = 'mallory-the-forger';
    lines[1] = JSON.stringify(event);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');

    const checks = verifyAsAnonymous();
    // The content attestation recomputes the root over the edited events and
    // no longer matches the committed signature → red, no secret needed.
    expect(checks.find((c) => c.name === 'audit content attestation')?.ok).toBe(false);
  });

  it('refuses a synthetic line whose version is not the event format (no legacy-accept)', () => {
    writeChain(3);
    // Append a line with a foreign version tag. It must NOT be counted as a
    // chained event (no legacy acceptance); the parse check flags it.
    const file = path.join(tailDir(), 'current.jsonl');
    const foreign = JSON.stringify({
      v: EVENT_FORMAT_VERSION + 98,
      at: '2026-07-07T00:00:09.000Z',
      kind: 'task_created',
      actor: ACTOR,
      data: { key: 'T-forged' },
      prev_hash: null,
      hash: 'deadbeef',
    });
    writeFileSync(file, `${readFileSync(file, 'utf-8').trimEnd()}\n${foreign}\n`, 'utf-8');

    const checks = inspectAuditIntegrity(adapter, auditDir, null, null, null, null, tailDir());
    const parse = checks.find((c) => c.name === 'audit lines parse');
    expect(parse?.ok).toBe(false);
    // And the foreign line was not laundered into a chained event: the mirror
    // count (3 real events) still matches the chain, so the count check is ok
    // rather than reporting a 4th accepted line.
    expect(checks.find((c) => c.name === 'audit event count')?.ok).toBe(true);
  });
});

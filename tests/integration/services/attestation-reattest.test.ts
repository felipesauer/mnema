import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AttestationArtifact, verifyArtifact } from '@/services/audit/attestation-artifact.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { planReattest } from '@/services/audit/attestation-reattest.js';
import { committedSignerResolver } from '@/services/audit/attestation-store.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/machine-key.js';

/**
 * planReattest is FAIL-CLOSED: it refuses to sign anything on any sign of real
 * tampering (broken chain, malformed line, truncation below a signed
 * checkpoint, a discontiguous or non-verifying existing .att, no identity).
 * On a healthy chain it emits the unattested tail and preserves valid .att.
 */
describe('planReattest (fail-closed)', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-reattest-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate();
  });
  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const hmacId = 'ab'.repeat(32);
  const signer = () => ({ machineKey, actor: 'felipesauer' });

  function writeChain(n: number): void {
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(
        JSON.stringify({
          v: 3,
          at: `2026-07-07T00:00:0${i}.000Z`,
          kind: 'k',
          actor: 'felipesauer',
          data: { id: `T-${i}` },
          prev_hash: i === 0 ? null : `h${i - 1}`,
          hash: `h${i}`,
        }),
      );
    }
    writeFileSync(path.join(auditDir, 'current.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  }

  /** Baseline healthy input; individual tests override fields. */
  function input(overrides: Partial<Parameters<typeof planReattest>[0]> = {}) {
    const walk = walkChainedEvents(auditDir);
    return {
      walk,
      existing: [] as AttestationArtifact[],
      resolvePublicKeyPem: committedSignerResolver(projectRoot),
      signer: signer(),
      projectHmacId: hmacId,
      chainHealthy: true,
      signedEventCountAt: null,
      all: false,
      ...overrides,
    };
  }

  it('emits the whole tail on a fresh healthy chain', () => {
    writeChain(10);
    const plan = planReattest(input());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.planned).toEqual([{ from: 0, to: 10, action: 'emit', signerActor: 'felipesauer' }]);
    expect(plan.artifacts).toHaveLength(1);
    // What it plans to emit actually verifies.
    const events = walkChainedEvents(auditDir)
      .chained.slice(0, 10)
      .map((c) => c.event);
    expect(verifyArtifact(plan.artifacts[0], events, committedSignerResolver(projectRoot)).ok).toBe(
      true,
    );
  });

  it('preserves a valid existing .att and emits only the new tail', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const existing = emitAttestation(walk, 0, 10, signer(), hmacId);
    const plan = planReattest(input({ existing: [existing] }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.planned).toEqual([
      { from: 0, to: 10, action: 'preserve', signerActor: 'felipesauer' },
      { from: 10, to: 20, action: 'emit', signerActor: 'felipesauer' },
    ]);
    expect(plan.artifacts).toHaveLength(1); // only the emitted tail
    expect(plan.artifacts[0].from).toBe(10);
  });

  it('is a no-op plan when the chain is fully attested', () => {
    writeChain(10);
    const existing = emitAttestation(walkChainedEvents(auditDir), 0, 10, signer(), hmacId);
    const plan = planReattest(input({ existing: [existing] }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.artifacts).toHaveLength(0);
    expect(plan.planned).toEqual([
      { from: 0, to: 10, action: 'preserve', signerActor: 'felipesauer' },
    ]);
  });

  it('refuses when the chain is not internally consistent', () => {
    writeChain(10);
    const plan = planReattest(input({ chainHealthy: false }));
    expect(plan).toEqual({
      ok: false,
      reason: expect.stringMatching(/not internally consistent/i),
    });
  });

  it('refuses when malformed lines are present', () => {
    writeChain(5);
    writeFileSync(path.join(auditDir, 'current.jsonl'), 'garbage not json\n', { flag: 'a' });
    const plan = planReattest(input());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/unparseable line/i);
  });

  it('refuses a truncation below a signed checkpoint', () => {
    writeChain(5);
    const plan = planReattest(input({ signedEventCountAt: 8 }));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/truncation/i);
  });

  it('refuses a discontiguous existing attestation', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    // A .att starting at 5 with nothing covering [0,5).
    const gappy = emitAttestation(walk, 5, 15, signer(), hmacId);
    const plan = planReattest(input({ existing: [gappy] }));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/discontiguous/i);
  });

  it('refuses when an existing .att does not verify', () => {
    writeChain(20);
    const walk = walkChainedEvents(auditDir);
    const good = emitAttestation(walk, 0, 10, signer(), hmacId);
    const tampered = { ...good, contentRoot: 'deadbeef' }; // break it
    const plan = planReattest(input({ existing: [tampered] }));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/does not verify/i);
  });

  it('refuses to emit a tail when no signer identity is resolvable', () => {
    writeChain(10);
    const plan = planReattest(input({ signer: null }));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toMatch(/no signing identity/i);
  });

  it('splits a large backlog into fixed-size batches', () => {
    writeChain(250);
    const plan = planReattest(input());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // DEFAULT_BATCH = 100 → [0,100), [100,200), [200,250)
    expect(plan.artifacts.map((a) => [a.from, a.to])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
  });

  it('honours a caller-supplied batchSize', () => {
    writeChain(250);
    const plan = planReattest(input({ batchSize: 100 })); // baseline 100 for contrast
    const plan50 = planReattest(input({ batchSize: 50 }));
    expect(plan.ok && plan50.ok).toBe(true);
    if (!plan50.ok) return;
    expect(plan50.artifacts.map((a) => a.to)).toEqual([50, 100, 150, 200, 250]);
  });

  it('preserves a .att signed by a DIFFERENT committed key while emitting the tail', () => {
    // The reason committedSignerResolver keys by full fingerprint: machine B
    // signs [0,10), machine A (current) backfills the tail. B's .att must
    // preserve because B's .pub is committed and resolves.
    writeChain(20);
    const userDirB = path.join(tempRoot, 'home-b', '.config', 'mnema');
    mkdirSync(userDirB, { recursive: true });
    const keyB = new MachineKeyService(projectRoot, 'mallory-not', userDirB);
    keyB.getOrCreate(); // commits B's .pub alongside A's
    const bAtt = emitAttestation(
      walkChainedEvents(auditDir),
      0,
      10,
      { machineKey: keyB, actor: 'mallory-not' },
      hmacId,
    );
    const plan = planReattest(input({ existing: [bAtt] }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.planned).toEqual([
      { from: 0, to: 10, action: 'preserve', signerActor: 'mallory-not' },
      { from: 10, to: 20, action: 'emit', signerActor: 'felipesauer' },
    ]);
  });

  it('refuses (not throws) when a chained line has no hash', () => {
    writeChain(5);
    // Append a v2 line with no `hash` — the emitter would throw on it; the
    // planner must return a structured refusal instead.
    const noHash = JSON.stringify({ v: 2, at: 't', kind: 'k', actor: 'a', data: {} });
    writeFileSync(path.join(auditDir, 'current.jsonl'), `${noHash}\n`, { flag: 'a' });
    let threw = false;
    let plan: ReturnType<typeof planReattest> | undefined;
    try {
      plan = planReattest(input());
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(plan?.ok).toBe(false);
    if (plan?.ok) return;
    expect(plan?.reason).toMatch(/no hash|malformed/i);
  });
});

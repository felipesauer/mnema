import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContentAttestation } from '@/services/audit/attestation-cli.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { attestPath, writeArtifact } from '@/services/audit/attestation-store.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { HMAC_ID_RELATIVE } from '@/services/integrity/project-secret.js';

/**
 * Content attestation is per-tail: each machine tail (`audit/m-<id>/`) is its
 * own chain, indexed from 0, with its own `.att` set under its own
 * `attest/` dir. The project verdict is the AND across tails — green only when
 * EVERY tail is fully attested, and a tamper in ONE tail turns the whole
 * project red, named by that tail. This is what makes the anonymous-clone
 * promise hold once more than one machine has written.
 */
describe('content attestation verifies each machine tail independently', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  const projectHmacId = 'ab'.repeat(32);
  const tailA = 'm-0000000000aa';
  const tailB = 'm-0000000000bb';

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-tails-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    machineKey.getOrCreate(); // commits the signer .pub under .mnema/keys/
    const fpFile = path.join(projectRoot, HMAC_ID_RELATIVE);
    mkdirSync(path.dirname(fpFile), { recursive: true });
    writeFileSync(fpFile, `${projectHmacId}\n`, 'utf-8');
  });

  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const signer = () => ({ machineKey, actor: 'felipesauer' });

  /** Writes `n` chained events into a tail's current.jsonl (its own chain from 0). */
  function writeTail(tail: string, n: number): void {
    const dir = path.join(auditDir, tail);
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(
        JSON.stringify({
          v: 1,
          at: `2026-07-07T00:00:0${i}.000Z`,
          kind: 'k',
          actor: 'felipesauer',
          data: { id: `${tail}-${i}` },
          prev_hash: i === 0 ? null : `${tail}h${i - 1}`,
          hash: `${tail}h${i}`,
        }),
      );
    }
    writeFileSync(path.join(dir, 'current.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  }

  /** Attests a tail's whole chain into ITS OWN attest/ dir. */
  function attestTail(tail: string, n: number): void {
    const dir = path.join(auditDir, tail);
    const walk = walkChainedEvents(dir);
    writeArtifact(dir, emitAttestation(walk, 0, n, signer(), projectHmacId));
  }

  it('is a clean green only when EVERY tail is fully attested', () => {
    writeTail(tailA, 4);
    writeTail(tailB, 3);
    attestTail(tailA, 4);
    // Tail B unattested is opt-in-dormant (not a hard failure), but it keeps
    // the project short of a clean green: the worst tail verdict wins, so the
    // project is a WARNING naming tail B — never a full green that would hide
    // that B is not anonymously verifiable yet.
    const partial = buildContentAttestation(projectRoot, auditDir);
    expect(partial.severity).toBe('warning');
    expect(partial.detail).toContain(tailB);

    attestTail(tailB, 3);
    const full = buildContentAttestation(projectRoot, auditDir);
    expect(full.ok).toBe(true);
    expect(full.severity).toBeUndefined(); // clean green, no warning
  });

  it('turns the project red, named by the tail, when one tail is tampered', () => {
    writeTail(tailA, 4);
    writeTail(tailB, 3);
    attestTail(tailA, 4);
    attestTail(tailB, 3);
    expect(buildContentAttestation(projectRoot, auditDir).ok).toBe(true);

    // Forge one event in tail B: its leaf changes, its content root no longer
    // matches the committed .att over [0,3) — B's attestation fails.
    const file = path.join(auditDir, tailB, 'current.jsonl');
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    const first = JSON.parse(lines[0] as string) as Record<string, unknown>;
    first.data = { id: 'forged' };
    lines[0] = JSON.stringify(first);
    writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8');

    const check = buildContentAttestation(projectRoot, auditDir);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain(tailB);
    // A's attestation still verifies — the failure is isolated to B, not a
    // blanket project failure that would hide which tail broke.
    expect(check.detail).not.toContain(tailA);
  });

  it('scopes each .att to its own tail dir (no cross-tail filename collision)', () => {
    // Both tails close a batch ending at the SAME index (3); the old flat store
    // would have written both to `attest/3.att` and clobbered one. Per-tail
    // dirs give each its own `m-<id>/attest/3.att`, covering its own head hash.
    writeTail(tailA, 3);
    writeTail(tailB, 3);
    attestTail(tailA, 3);
    attestTail(tailB, 3);
    const attA = JSON.parse(readFileSync(attestPath(path.join(auditDir, tailA), 3), 'utf-8'));
    const attB = JSON.parse(readFileSync(attestPath(path.join(auditDir, tailB), 3), 'utf-8'));
    // Distinct files, each covering its own tail's head — no clobber.
    expect(attA.coveredHeadHash).toBe(`${tailA}h2`);
    expect(attB.coveredHeadHash).toBe(`${tailB}h2`);
  });

  it('a partially-attested tail is NOT masked by a dormant sibling that sorts first', () => {
    // The fail-closed contract: a tail with SOME unattested events (partial
    // coverage → ok:false) must decide the project verdict even when a
    // lexicographically-earlier sibling is merely dormant (no .att → ok:true).
    // A plain severity sort ranks both as warning and its tie-break keeps the
    // earlier (dormant) one, flipping the project to a false green — the exact
    // hole the ok-aware ranking closes. `m-...aa` sorts before `m-...bb`.
    writeTail(tailA, 3); // dormant: 3 events, 0 .att
    writeTail(tailB, 4);
    // Attest only [0,2) of B → events 2 and 3 remain uncovered (partial).
    const dirB = path.join(auditDir, tailB);
    writeArtifact(dirB, emitAttestation(walkChainedEvents(dirB), 0, 2, signer(), projectHmacId));

    const check = buildContentAttestation(projectRoot, auditDir);
    // Fail-closed: partial coverage is ok:false, and it must be the verdict —
    // never hidden behind the dormant sibling.
    expect(check.ok).toBe(false);
    expect(check.detail).toContain(tailB);
  });

  it('an EMPTY tail (booted, never written) does not drag a green project to a warning', () => {
    // A machine that ran a read-only command created its own `m-<id>/` (the
    // writer/tail mkdir it on boot) with no events. Its "no events yet" verdict
    // is about a fresh chain, not unattested content, so it must stay neutral —
    // never rank as a warning that spoils a fully-attested sibling's clean green.
    writeTail(tailA, 3);
    attestTail(tailA, 3);
    mkdirSync(path.join(auditDir, tailB), { recursive: true }); // empty tail, no current.jsonl

    const check = buildContentAttestation(projectRoot, auditDir);
    expect(check.ok).toBe(true);
    expect(check.severity).toBeUndefined(); // clean green, not a warning
  });
});

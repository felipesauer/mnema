import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContentAttestation } from '@/services/audit/attestation-cli.js';
import { emitAttestation } from '@/services/audit/attestation-emitter.js';
import { writeArtifact } from '@/services/audit/attestation-store.js';
import { CONTENT_ATTESTATION_CHECK } from '@/services/audit/attestation-verify.js';
import { walkChainedEvents } from '@/services/audit/audit-chain-walk.js';
import { MachineKeyService } from '@/services/integrity/machine-key.js';
import { HMAC_ID_RELATIVE } from '@/services/integrity/project-secret.js';

/**
 * The content-attestation verify path must BIND each `.att` to the project's
 * own committed HMAC fingerprint. Without it, `projectHmacId` gives the
 * appearance of project-binding while providing none: a foreign artifact
 * (from another project, or with a swapped `projectHmacId`) carries a
 * signature that verifies against ITS OWN committed key, so the crypto check
 * passes it. A mismatch is a distinct wrong-project verdict, never generic
 * tamper.
 */
describe('content attestation binds projectHmacId to the committed fingerprint', () => {
  let tempRoot: string;
  let projectRoot: string;
  let auditDir: string;
  let machineKey: MachineKeyService;

  // The project's own committed HMAC fingerprint, and a foreign one.
  const projectHmacId = 'ab'.repeat(32);
  const foreignHmacId = 'cd'.repeat(32);

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-attest-binding-'));
    projectRoot = path.join(tempRoot, 'proj');
    auditDir = path.join(projectRoot, '.mnema', 'audit');
    const userDir = path.join(tempRoot, 'home', '.config', 'mnema');
    mkdirSync(auditDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    machineKey = new MachineKeyService(projectRoot, 'felipesauer', userDir);
    // Mint the machine key so its `.pub` is committed under .mnema/keys/ — the
    // trust anchor the anonymous verifier resolves the signature against.
    machineKey.getOrCreate();
    // Commit the project's HMAC fingerprint (what a real project stores at
    // .mnema/keys/project.hmac-id). This is the value each .att must carry.
    const fpFile = path.join(projectRoot, HMAC_ID_RELATIVE);
    mkdirSync(path.dirname(fpFile), { recursive: true });
    writeFileSync(fpFile, `${projectHmacId}\n`, 'utf-8');
  });

  afterEach(() => rmSync(tempRoot, { recursive: true, force: true }));

  const signer = () => ({ machineKey, actor: 'felipesauer' });

  /** Writes `n` v3 chained events to current.jsonl. */
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

  const verdict = () =>
    buildContentAttestation(projectRoot, auditDir) as ReturnType<typeof buildContentAttestation> & {
      name: string;
    };

  it('verifies green when the .att carries THIS project fingerprint', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    // A genuine attestation over the whole chain, carrying the project's own id.
    writeArtifact(auditDir, emitAttestation(walk, 0, 10, signer(), projectHmacId));

    const check = verdict();
    expect(check.name).toBe(CONTENT_ATTESTATION_CHECK);
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/all 10 chained events attested/i);
  });

  it('rejects a foreign projectHmacId with a distinct wrong-project verdict (not generic tamper)', () => {
    writeChain(10);
    const walk = walkChainedEvents(auditDir);
    // A .att whose CONTENT + signature are internally valid (signed with a
    // real key over the real events) but whose projectHmacId is a DIFFERENT
    // project's. verifyArtifact alone would pass it — the signature checks out
    // against the committed key. Only the project binding catches it.
    const foreign = emitAttestation(walk, 0, 10, signer(), foreignHmacId);
    writeArtifact(auditDir, foreign);

    const check = verdict();
    expect(check.ok).toBe(false);
    expect(check.severity).toBe('error');
    // Distinct, clearly-worded: wrong project, not a content forgery.
    expect(check.detail).toMatch(/different project|wrong project secret/i);
    expect(check.detail).not.toMatch(/does not verify|content root mismatch/i);
  });
});

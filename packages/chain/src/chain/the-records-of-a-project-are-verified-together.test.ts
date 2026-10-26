/**
 * THE RECORDS OF ONE PROJECT, VERIFIED TOGETHER (`verifyTogether`).
 *
 * Each record is folded by the format alone (FORMAT.md section 6.2), so an agent key retired in
 * one record is still in force in another that never received the retirement. `verifyTogether`
 * is the reading of several records that knows both: an event a record holds, signed by an agent
 * key another record retired, with an `at` later than that retirement's, is a break of the record
 * that holds it, and is not counted as attested. These cases build the two records with the
 * format's own builders and keys, and compare with what `verifyChain` says of each alone.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agentEnrolled,
  agentEnrollmentMessage,
  agentRetired,
  identityFounded,
  taskCreated,
} from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsBuilt } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem, sign } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';
import { type VerifyResult, verifyChain, verifyTogether } from './verify.js';

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verified-together-'));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const at = (n: number): string => `2026-07-21T00:00:0${n}.000Z`;

function commit(root: string, ...keys: KeyPair[]): void {
  mkdirSync(join(root, 'keys'), { recursive: true });
  for (const kp of keys) {
    writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
  }
}

/** One tail, hash-chained, with its birth proof and one checkpoint over all of it. */
function writeTail(root: string, tailId: string, events: readonly CatalogEvent[], signer: KeyPair) {
  mkdirSync(tailDir({ root }, tailId), { recursive: true });
  const lines: string[] = [];
  let prev: string | null = null;
  events.forEach((event, seq) => {
    const hash = entryHash({ event: writtenAsBuilt(event), tail: tailId, seq, prev });
    lines.push(
      canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } }),
    );
    prev = hash;
  });
  writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
  writeFileSync(
    tailProofPath({ root }, tailId),
    `${serializeTailProof(signTailProof(tailId, signer))}\n`,
  );
  const cp = signCheckpoint({
    tail: tailId,
    fromSeq: 0,
    events: events.map(writtenAsBuilt),
    prev: null,
    keyPair: signer,
  });
  writeFileSync(checkpointsPath({ root }, tailId), `${serializeCheckpoint(cp)}\n`);
}

/** A person (A) and an agent key (G) named `claude`, and two records of one project. */
function aProject() {
  const a = generateKeyPair();
  const g = generateKeyPair();
  const anchor = deriveAnchor(a.fingerprint);
  const founded = identityFounded(
    { at: at(1), who: anchor, signerFp: a.fingerprint, subject: anchor },
    { foundingFp: a.fingerprint },
  );
  const consent = Buffer.from(
    sign(agentEnrollmentMessage(anchor, g.fingerprint, 'claude'), g.privateKey),
  ).toString('hex');
  const enrolled = agentEnrolled(
    { at: at(2), who: anchor, signerFp: a.fingerprint, subject: anchor },
    { agentFp: g.fingerprint, name: 'claude', reverseSig: consent },
  );
  const retired = agentRetired(
    { at: at(4), who: anchor, signerFp: a.fingerprint, subject: anchor },
    { agentFp: g.fingerprint, reason: 'leaked' },
  );
  const byAgent = (id: string, when: number): CatalogEvent =>
    taskCreated(
      { at: at(when), who: anchor, signerFp: g.fingerprint, subject: id, which: 'claude' },
      { title: id },
    );
  const committed = join(sandbox, 'committed');
  const own = join(sandbox, 'private');
  commit(committed, a, g);
  commit(own, a, g);
  return { a, g, founded, enrolled, retired, byAgent, committed, own };
}

const attested = (result: VerifyResult): readonly string[] =>
  result.census.flatMap((note) =>
    note.kind === 'attested-which' ? [`${note.name} ${note.events}`] : [],
  );

describe('verifyTogether', () => {
  it('refuses, in a record that never heard of it, what a key another record retired signed after it', () => {
    const p = aProject();
    writeTail(p.committed, `${p.a.fingerprint}-c1`, [p.founded, p.enrolled, p.retired], p.a);
    writeTail(p.own, `${p.a.fingerprint}-p1`, [p.founded, p.enrolled], p.a);
    writeTail(
      p.own,
      `${p.g.fingerprint}-p2`,
      [p.byAgent('t-before', 3), p.byAgent('t-after', 5)],
      p.g,
    );
    const upcasters = catalogUpcasters();
    const alone = verifyChain({ root: p.own }, upcasters);
    expect(alone.ok).toBe(true);
    expect(attested(alone)).toEqual(['claude 2']);

    const [committed, own] = verifyTogether(
      [
        { layout: { root: p.committed }, where: "this project's committed tree" },
        { layout: { root: p.own }, where: "this project's private tree" },
      ],
      upcasters,
    );

    expect(committed?.ok).toBe(true);
    expect(own?.ok).toBe(false);
    expect(own?.issues.map((issue) => `${issue.seq} ${issue.detail}`)).toEqual([
      `1 task.created is signed by ${p.g.fingerprint}, an agent key this project's committed tree retired at ${at(4)}, which signs nothing after it`,
    ]);
    expect(attested(own as VerifyResult)).toEqual(['claude 1']);
  });

  it('says what each record alone says when every record holds the retirement', () => {
    const p = aProject();
    writeTail(p.committed, `${p.a.fingerprint}-c1`, [p.founded, p.enrolled, p.retired], p.a);
    writeTail(p.own, `${p.a.fingerprint}-p1`, [p.founded, p.enrolled, p.retired], p.a);
    writeTail(p.own, `${p.g.fingerprint}-p2`, [p.byAgent('t-before', 3)], p.g);
    const upcasters = catalogUpcasters();

    const together = verifyTogether(
      [
        { layout: { root: p.committed }, where: "this project's committed tree" },
        { layout: { root: p.own }, where: "this project's private tree" },
      ],
      upcasters,
    );

    expect(together.map((one) => one.summary)).toEqual([
      verifyChain({ root: p.committed }, upcasters).summary,
      verifyChain({ root: p.own }, upcasters).summary,
    ]);
    expect(together.every((one) => one.ok)).toBe(true);
  });

  it('leaves a fact signed before the retirement, by the at the key wrote, authentic', () => {
    const p = aProject();
    writeTail(p.committed, `${p.a.fingerprint}-c1`, [p.founded, p.enrolled, p.retired], p.a);
    writeTail(p.own, `${p.a.fingerprint}-p1`, [p.founded, p.enrolled], p.a);
    writeTail(p.own, `${p.g.fingerprint}-p2`, [p.byAgent('t-before', 3)], p.g);

    const [, own] = verifyTogether(
      [
        { layout: { root: p.committed }, where: "this project's committed tree" },
        { layout: { root: p.own }, where: "this project's private tree" },
      ],
      catalogUpcasters(),
    );

    expect(own?.ok).toBe(true);
    expect(attested(own as VerifyResult)).toEqual(['claude 1']);
  });
});

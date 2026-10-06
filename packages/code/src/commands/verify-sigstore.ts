/**
 * `mnema verify --against-sigstore` — what the Sigstore bundles in this record say, read
 * offline against the trust root this binary carries.
 *
 * WHAT IT ADDS. A bundle in `witness/` is a second signature over a checkpoint, made with a
 * certificate that names an e-mail (or a GitHub Actions workflow) and logged in Rekor at a time
 * Rekor signed. So it says who signed in to Sigstore to countersign that checkpoint, and when
 * Rekor logged it.
 *
 * WHAT IT DOES NOT PROVE, said wherever the answer is printed: who wrote the record. Anybody can
 * countersign a digest they can compute, which is any checkpoint of a public repository; a
 * bundle speaks for an identity of this record only where that identity named the same e-mail
 * or workflow in a signed, covered fact (`mnema key sigstore`), and the line says whether it did.
 * The time is Rekor's clock, signed with Rekor's key — not the Bitcoin work behind `witness stamp`.
 *
 * IT CHANGES NOTHING ABOUT THE VERDICT. It runs only when asked, after the verification, over the
 * trees that verified, and it answers in notes: never the level, never `--require witnessed`,
 * never the exit. A bundle that does not hold — another digest, a checkpoint this tail does not
 * prove, a certificate the carried root does not reach — is said by name, as NOT COVERED.
 *
 * WHAT IS READ, AND WHY ONLY THE SIGNED PART. A bundle counts only over a checkpoint the verifier
 * PROVED (`checkpointedThrough`), and the message it is checked against is recomputed from
 * `checkpoints.jsonl`. A link counts only when its `who` is its `subject` and it is covered, for
 * the reason `verify --against-github` gives: above the last checkpoint a party holding no key
 * could append a link naming an e-mail of their own.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catalogUpcasters,
  checkpointHash,
  checkpointMessage,
  readTailCheckpoints,
  readTailEntries,
  witnessDir,
} from '@mnema/chain';
import { type Scope, SIGSTORE_SERVICE } from '@mnema/core';
import { readSigstoreBundle, type SigstoreReading } from '../sigstore/read.js';
import type { TreeReport } from './verify.js';

/** What a bundle's file name ends in — the one place the suffix is known on this side. */
const BUNDLE_SUFFIX = '.sigstore.json';

/** One bundle, and what it says. */
export interface SigstoreFinding {
  readonly scope: Scope;
  readonly tail: string;
  /** The checkpoint the file is filed under. */
  readonly checkpoint: string;
  readonly reading: SigstoreReading;
  /**
   * The identity of this record that signed the checkpoint, when it named the certificate's
   * identity in a covered `account.linked` — absent when it did not.
   */
  readonly namedBy?: string;
  /** The identity that signed the checkpoint the bundle is over, when it is known. */
  readonly signedBy?: string;
}

/** Every bundle in the trees that verified. */
export interface SigstoreReceipts {
  readonly findings: readonly SigstoreFinding[];
  /** The trees left out because their verdict was a break. */
  readonly notRead: readonly Scope[];
}

/** Reads every Sigstore bundle of the trees that verified. Never reaches the network. */
export function readSigstoreReceipts(
  trees: readonly TreeReport[],
  options: { readonly trustedRoot?: unknown } = {},
): SigstoreReceipts {
  const upcasters = catalogUpcasters();
  const findings: SigstoreFinding[] = [];
  const notRead: Scope[] = [];
  /** Each identity's covered Sigstore links. */
  const links = new Map<string, Set<string>>();
  const pending: Omit<SigstoreFinding, 'namedBy'>[] = [];

  for (const tree of trees) {
    if (tree.kind !== 'verdict') continue;
    if (!tree.result.ok) {
      notRead.push(tree.scope);
      continue;
    }
    const layout = { root: tree.root };
    for (const tail of tree.result.tails) {
      /** Who signed with each key in this tail, from the covered events. */
      const whoseKey = new Map<string, string>();
      for (const entry of readTailEntries(layout, tail.tail, upcasters)) {
        if (entry.link.seq > tail.checkpointedThrough) break;
        const event = entry.event;
        if (!whoseKey.has(event.signerFp)) whoseKey.set(event.signerFp, event.who);
        if (
          event.kind === 'account.linked' &&
          event.who === event.subject &&
          event.payload.service === SIGSTORE_SERVICE
        ) {
          const named = links.get(event.who) ?? new Set<string>();
          named.add(event.payload.account);
          links.set(event.who, named);
        }
      }
      const dir = witnessDir(layout, tail.tail);
      if (!existsSync(dir)) continue;
      const proven = new Map(
        readTailCheckpoints(layout, tail.tail)
          .filter((checkpoint) => checkpoint.toSeq <= tail.checkpointedThrough)
          .map((checkpoint) => [checkpointHash(checkpoint), checkpoint] as const),
      );
      for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith(BUNDLE_SUFFIX)) continue;
        const digest = name.slice(0, -BUNDLE_SUFFIX.length);
        const checkpoint = proven.get(digest);
        const at = { scope: tree.scope, tail: tail.tail, checkpoint: digest };
        if (checkpoint === undefined) {
          pending.push({
            ...at,
            reading: {
              kind: 'not-covered',
              why: 'it is filed under a checkpoint this tail does not prove',
            },
          });
          continue;
        }
        const reading = readSigstoreBundle(
          readFileSync(join(dir, name), 'utf-8'),
          { digest, message: checkpointMessage(checkpoint) },
          options.trustedRoot,
        );
        const signedBy = whoseKey.get(checkpoint.signerFp);
        pending.push({ ...at, reading, ...(signedBy === undefined ? {} : { signedBy }) });
      }
    }
  }

  for (const finding of pending) {
    const signer = finding.signedBy;
    const named =
      finding.reading.kind === 'signed' &&
      signer !== undefined &&
      (links.get(signer)?.has(finding.reading.identity) ?? false);
    findings.push(named && signer !== undefined ? { ...finding, namedBy: signer } : finding);
  }
  return { findings, notRead };
}

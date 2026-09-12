/**
 * The README's usage example, RUN — and run as the very bytes the page publishes.
 *
 * WHAT THIS FILE IS HALF OF. The region between the two markers below is compared, line
 * for line, against the ```ts block of `../README.md` by
 * `packages/code/tests/the-example-is-read-from-the-page.test.ts`. That comparison is
 * what makes this case a guard over the PUBLISHED example rather than over a private
 * translation of it: a name changed on the page and left alone here turns the suite red,
 * and so does the reverse. Without it, running "an example" proves nothing about the one
 * a reader copies.
 *
 * WHAT IT CAUGHT THE DAY IT WAS WRITTEN, AND WHAT NOW KEEPS CATCHING IT. The published
 * example did not compile. That was measured once, by hand, on 11/09/2026 by type-checking
 * the extracted block against the built `.d.ts`; it is a case now —
 * `code/tests/the-example-is-type-checked.test.ts` does that reading on every run, so an
 * error of this kind cannot come back the way it came. What it found:
 * `openChainForWriting('.mnema/chain')` was called with one argument where the signature
 * takes two (the key root has no default, deliberately), and the envelope literal was
 * missing `signerFp`, which every event carries. The page also said the key pair "is
 * loaded from the chain root, or created there on first use" and that `who` is "the human
 * who authorized the work" as a typed-in name — the first is contradicted by
 * `openChainForWriting`'s own doc-comment ("the private key never lives inside a chain"),
 * and the second by `envelope.ts`, where `who` is an anchor derived from the key and
 * never supplied by a caller.
 *
 * WHY THE ROOTS ARE ELIDED AND NOTHING ELSE IS. The two `const` lines that name the
 * directories are declared as elisions in the comparison, with their reason, because a
 * case that ran the page's literal `.mnema/chain` would found an identity and write
 * events inside this repository. Every other line is compared verbatim.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { identityFounded, openChainForWriting, taskBirth, verify } from './index.js';

describe('README example', () => {
  it('runs exactly as documented', () => {
    // (The page names two directories; this case points them at sandboxes of its own so
    // that running the documentation never founds an identity in the working tree.)
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-chain-readme-'));
    const root = join(sandbox, 'chain');
    const keyRoot = join(sandbox, 'keys');

    try {
      // ---- README example begins ----
      // One writer owns this machine's tail. The key pair is loaded from `keyRoot` — or
      // minted there on first use — and its PUBLIC half is copied into the chain, which
      // is what lets a stranger verify with no secret.
      const writer = openChainForWriting(root, { keyRoot });

      // The proof fields every event carries. Neither identity is a name somebody typed:
      // `who` is the ANCHOR derived from the key, `signerFp` is the fingerprint of the
      // key that signs, and the writer holds both. `which` IS a free name — an agent has
      // no key of its own, so the machine signs on its behalf.
      const proof = {
        at: new Date().toISOString(),
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        which: 'claude',
      };

      // Found the anchor before writing any work under it: this event is what says "this
      // key speaks for this identity". Every later event's signer is checked against it,
      // so a chain whose first event is a task verifies RED — the signature is good and
      // nothing enrolled the key that made it.
      const founding = identityFounded(
        { ...proof, subject: writer.anchor },
        { foundingFp: writer.signerFingerprint },
      );

      // A task's birth is two atomic events: it exists (task.created) and it has an
      // initial state (task.transitioned from null). State lives only in transitions.
      // `initial` is a literal this package does not judge — which state a task starts
      // in belongs to the domain above (see `@mnema/core`), never to the proof engine.
      const birth = taskBirth(
        { ...proof, subject: 'task-01' },
        { title: 'Ship the parser', initial: 'DRAFT' },
      );

      // One call, so no reader ever sees a created task that has no state — and nothing
      // is ever written under an anchor the record has not founded.
      writer.appendAll([founding, ...birth]);

      // Sign a checkpoint over everything appended so far.
      writer.checkpoint();

      // Anyone can verify the whole chain — aggregating every tail — from the root.
      const result = verify(root);
      // result.ok is true, result.level is 'fully-signed', and `summary` words it.
      // ---- README example ends ----

      expect(result.ok).toBe(true);
      expect(result.fullySigned).toBe(true);
      expect(result.level).toBe('fully-signed');
      expect(result.summary).toContain('local integrity verified (T1/T2/T4)');
      expect(birth.map((event) => event.kind)).toEqual(['task.created', 'task.transitioned']);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

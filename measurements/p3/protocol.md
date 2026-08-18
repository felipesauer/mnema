# The third promise, and how it will be attacked

> **Frozen before the first attempt.** Every prediction below is written now, so that a defence that
> holds is not confused with a defence nobody tried, and a defence that fails cannot be re-read as
> the attack having been out of scope.

## The promise

> **The proof survives someone with write access.**

It is the strongest of the three this product makes, and the only one never measured. The first was
measured and did not survive as written ([p1](../p1/results/2026-08-18-full/report.md)). The second
is about form. This one is the thesis: a record that can be edited by whoever holds the repository
is a diary, not a proof.

## The attacker, stated before the attacks

**Write access to the repository and to the machine. No private key.**

That is the realistic adversary and the one the design names T2: a colleague with push rights, a
compromised CI job, a contributor whose pull request is merged. They can read every byte, rewrite
any file, run any command, and commit the result. What they cannot do is sign with a key the record
enrolled — because the private half never enters the repository.

**The attacker who HAS the key is T3, and the product says out loud that local cryptography does not
cover it.** That claim is itself under test here: an honest "not covered" is a pass; a green that
reads as tamper-proof is a failure.

## What the product claims, layer by layer

| layer | claim | source |
|---|---|---|
| **T1** hash chain | recomputes each entry hash and its link; detects accidental corruption and reordering, and **points at the entry** | `chain/verify.ts` |
| **T2** edit without the key | recomputes each checkpoint's content root **from the events, never from stored hashes**, and checks Ed25519 against the committed public key it names | idem |
| **identity** | an event is authentic only if its `signerFp` is a key valid for its `who` **at that point**, folded from `identity.founded` / `key.enrolled` / `key.revoked` | `chain/enrollment.ts` |
| **T4** anonymous | the same recomputation runs offline from a clone, with no secret | idem |
| **T3** edit with the key | **out of scope locally**, delegated to an external witness; with none configured the verifier must say so | idem |

## The attacks, with the verdict predicted for each

**Every prediction is frozen. A miss in either direction is the finding** — an attack that passes
undetected, or a defence that fires on something legitimate.

| # | attack | prediction |
|---|---|---|
| 1 | Edit one event's content in place (a decision's title) | **T1 red**, naming the entry |
| 2 | Edit the content **and repair every entry hash** so the chain links cleanly | **T1 green, T2 red** — the root is recomputed from content, so the repair does not reach it. This is the attack the design was built against |
| 3 | Delete one event from the middle and repair seq and hashes | **T2 red** |
| 4 | Delete a whole tail directory | **census issue** — a committed public key with no tail — and no green that hides it |
| 5 | Append a forged event signed with a key the attacker generates | **identity red** — the key is not enrolled for that `who` |
| 6 | Enroll the attacker's own key by writing a `key.enrolled` fact, then sign with it | **identity red** — the enrolment fact itself must be signed by a key already valid |
| 7 | Re-sign an existing range with the attacker's key | **identity red** — a covered event must name the signer that attested it |
| 8 | Copy a residual tail from another project into `tails/<real-fp>-<forged>/` | **red** — a tail carries its own proof of ownership |
| 9 | **Roll back**: replace the record with a genuine older state | **GREEN, and expected.** A valid prefix is internally consistent; local cryptography cannot see that time moved. What is under test is whether the product **says** it cannot |
| 10 | **Truncate**: drop the last events, leaving a consistent prefix | **GREEN, and expected**, for the same reason |
| 11 | Forge the `tailproof.json` | **red** |

## How each outcome will be read

| outcome | reading |
|---|---|
| every prediction holds | the promise survives **for T2 and identity**, and the T3 boundary is where the product says it is |
| an attack predicted red comes out **green** | **the promise does not survive as written**, and the layer that failed is named. No re-reading of scope afterwards |
| an attack predicted green comes out **red** | the defence is stronger than claimed — and the claim is corrected upward, with the attack that proved it |
| 9 or 10 comes out green **and the product does not say it is uncovered** | a green that reads as tamper-proof, which the verifier's own doc calls the thing it must never print. That is a failure of honesty, not of cryptography |

## What this does NOT test

- **T3 with a real witness.** No anchor and no shared remote is configured here; the exercise
  measures what local verification says when there is none.
- **The transport.** Whether git itself was force-pushed is a question about git, and the answer is
  the same for every file in a repository.
- **Cost.** No model is called. This is filesystem and cryptography.

## What will be published

One line per attack, with the command that performed it, the verdict the product gave, the exit
code, and whether it matched the prediction — plus the raw verifier output. Unlike the p1 tasks,
**nothing here is withheld**: an attack nobody can reproduce is an assertion.

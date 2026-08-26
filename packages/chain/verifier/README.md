# A second reader of the mnema chain format

A verifier for the format specified in [`../FORMAT.md`](../FORMAT.md), written **from that
document** and importing **nothing** of the product it checks.

```
python3 mnema_verify.py record <a record directory>    # T1, T2/T4, T3 over a real record
python3 mnema_verify.py vectors                        # reproduce the 23 published vectors
python3 mnema_verify.py self-test                      # RFC 8032, section 1, section 8's limits
python3 mnema_verify.py all --record <dir>             # all three
python3 mnema_verify.py gaps                           # where FORMAT.md did not suffice
python3 mutate.py list                                 # the inputs it has to refuse
```

Python 3.9 or later. **No third-party packages** — Ed25519 is RFC 8032 by hand, checked
against the RFC's own test vectors, and the OpenTimestamps proof and the Bitcoin block
header are parsed from their own published formats. There is nothing to install.

## Why it exists

`FORMAT.md` said so itself, in *What this document does not promise*:

> **There is no second implementation.** Every digest here was produced by the one codebase
> this document describes, and checked by tests that live in it. […] publishing the vectors
> is the first step toward it rather than a substitute for it.

The interoperability literature is blunt about what that leaves: *a self-compatible
implementation proves very little*. The CCSDS requires **two independent implementations**
completing end-to-end tests as a **precondition** for publishing a technical standard.
Certificate Transparency runs on several implementations checking each other.

What a second reader buys is not redundancy. It is that assumptions which work inside one
product and are false outside it become **visible**. Twenty-five of them did, and they are
the deliverable half of this directory — `mnema_verify.py gaps`.

Three of the twenty-five were places the two readers **disagreed about the same bytes**, and
all three are closed. Two were acceptances — a field no kind declares, on an appended event;
a signer no enrolment authorized — found by *building the input*, because nine mutations both
readers refused prove nothing about what this one accepts. The third ran the other way and is
the quieter of the two failures: this reader **refused an honest event** for carrying
`which`, which sixteen of the twenty-three published vectors carry, because the document
described the envelope as the intersection of its own exemplars. Refusing too much looks like
rigour, so nobody goes looking for it.

## What it checks

| | |
|---|---|
| **T1** | every entry's stored hash is the hash of its content and its position; the sequence is contiguous, and a gap is reported with its location |
| **T2** | each checkpoint's content root folds over the events of its range, from their canonical bytes |
| **T4** | the Ed25519 signature over the checkpoint's signed message, under a key whose material is **recomputed** to the fingerprint that names it |
| **T3** | the OpenTimestamps proof's subject is the checkpoint's digest, the path folds to the merkle root the stored header carries, and the header's own hash meets the target it declares — with section 8's three declared limits refused by name |
| **§1** | the 23 published vectors and the four aggregate digests, plus every refusal section 1 lists |
| **§4** | byte identity: re-serializing what a line holds reproduces that line exactly |
| **§4.1** | every event rebuilt from the fields its `(kind, v)` contract declares in `event-schema.json`, and any other refused — which catches a forged field on a **newly appended** event, where byte identity cannot |
| **§6.2** | enrolment: every event's signer is a key **valid for its anchor** at that point in the fold, with a revocation and a restoring re-add taking effect only when signature-covered |
| — | the tail id's fingerprint is a key the record carries; the undocumented `tailproof.json`; whether the newest confirmed attestation reaches the last event |

## What it does not check

Printed on **every** run, including a verified one, because a gap that looks like coverage
is worse than an absence.

**This list used to have two more entries, and they were places where it ACCEPTED what the
product refuses.** They are gone, which is the only kind of shrinking this list may do:

- **Enrolment** was not in the document at all. It is §6.2 now, and `§6.2` above is it,
  earned by `mutate.py checkpoint-by-an-unenrolled-key` — a checkpoint whose root folds,
  whose `prev` chains and whose Ed25519 signature genuinely verifies, and which is refused
  anyway because nothing ever brought its signer under the anchor its events name.
- **A forged field inside a payload, on an event appended above the last checkpoint** — the
  one a party with **no key** could walk through. The declarations are published now
  (`event-schema.json`, §4.1) and both readers refuse it, naming the same field. Reproduce
  with `mutate.py forged-payload-field-appended`, and its mirror —
  `appended-event-missing-a-declared-field`, a **required field left out**, which no amount
  of byte identity could ever have caught and which one exemplar per kind could never have
  told anybody about.

The window is still reported on every run, because closing those two did not close it:
*N event(s) sit above the last checkpoint and rest on the hash chain ALONE*.

What is left below are boundaries, not acceptances:

- **Section 7**, that a proof is never recomputed over a lifted reading: no published
  vector carries `v > 1` and no upcaster is published, so there is nothing to lift.
- **An authorized cut.** A sequence gap is reported and located; whether it was authorized
  cannot be read from here, because the document does not say what authorizes one.
- **The stored header's place in the Bitcoin chain** — which section 8 says of itself.

## The verdict, and the four things it can be

| exit | verdict | |
|---:|---|---|
| 0 | `VERIFIED` | every check that was planned ran, and none refused |
| 1 | `REFUSED` | a check ran and refused; the report names which |
| 2 | `INCOMPLETE` | nothing refused, but a check that was planned could not run |
| 3 | `BROKEN` | nothing was checked at all, or this program failed |

`INCOMPLETE` exists because of a defect in this program's own ancestor: a 156-line
prototype printed `T2/T4 ok` on a line that ran unconditionally, **after** it had already
recorded a failure. There is no unconditional summary line anywhere here; the verdict is
derived from the findings rather than written beside them.

## The refusals, and how to earn one

`mutate.py` builds the inputs the format refuses, one named mutation at a time, in a copy
of a record you give it. It ships here rather than beside a test: a guard and the mutation
that lights it are one artifact.

```
python3 mutate.py edited-event-chain-repaired /tmp/a-copy-of-a-record
python3 mnema_verify.py record /tmp/a-copy-of-a-record      # REFUSED, exit 1
```

That one is the sharpest of the keyless ones. It edits an event and then recomputes **every**
`hash` and `prev` in the tail, which needs no key at all — the entry hash is keyless. T1
closes again. What refuses it is the content root, folded over the event *content* and not
over stored hashes, which is what section 5 calls the load-bearing invariant of the whole
format. Before this directory existed, that claim had never been checked by anything but the
product's own tests.

`checkpoint-by-an-unenrolled-key` is its counterpart one layer up, and it is the reason this
directory can sign as well as verify. Everything sections 1 to 6 ask for **closes**: the
appended event's entry hash is right, the new checkpoint chains by `prev`, its content root
folds, and its signature verifies under a key whose committed material hashes to exactly the
fingerprint it is filed under. The key is RFC 8032 section 7.1's first test vector, whose
secret the RFC itself publishes — the one key a verifier can hold without holding a secret.
Only §6.2 refuses it, which is the whole difference between *the signature verifies* and
*the signer was allowed to sign*.

## The honest guarantee

**What this buys.** A verdict on a real record, reached from the document and the bytes, by
a program that has never seen the implementation. Twenty-five places where the document was
not enough for that, each one written down. **A refusal for every mutation in `mutate.py`,
with no exception** — the exception used to be the one that existed to demonstrate an
acceptance, and there is no acceptance left to demonstrate. One disagreement with the product
that the document does not settle (which attestation dates a record — gap G23), and that is
all of them.

**What it does not buy.** Independence in the *social* sense. Same author, same repository,
same interest in it working. It is independent in the **technical** sense — another language,
written from the document, importing nothing — and that is enough to turn `FORMAT.md` from
prose into something continuously checked, and to find the ambiguities that are only visible
from outside. The social step, somebody else, is still not taken.

**And it is not a dependency of anything.** The product does not call this, and no step of
anything waits on it. It reads.

## Where it runs

The trunk's suite runs it on both runtimes the repository declares, through
[`../src/chain/second-reader-agrees-on-the-record.test.ts`](../src/chain/second-reader-agrees-on-the-record.test.ts),
[`second-reader-agrees-on-the-bytes.test.ts`](../src/chain/second-reader-agrees-on-the-bytes.test.ts)
and
[`second-reader-is-independent.test.ts`](../src/chain/second-reader-is-independent.test.ts).
It **fails** rather than skips where `python3` is absent: a second reader nobody runs is
prose again.

# A second reader of the mnema chain format

A verifier for the format specified in [`../FORMAT.md`](../FORMAT.md), written **from that
document** and importing **nothing** of the product it checks.

```
python3 mnema_verify.py record <a record directory>    # T1, T2/T4, T3 over a real record
python3 mnema_verify.py record <dir> --require signed  # ...and refuse an event no signature covers
python3 mnema_verify.py vectors                        # reproduce the 38 published vectors
python3 mnema_verify.py self-test                      # RFC 8032, section 1, section 8's limits
python3 mnema_verify.py all --record <dir>             # all three
python3 mnema_verify.py gaps                           # where FORMAT.md did not suffice
python3 mnema_verify.py --json gaps                    # the same registry as data
python3 mutate.py list                                 # the named mutations (most are refused; five are not)
```

Python 3.9 or later. **No third-party packages**: Ed25519 is RFC 8032 by hand, checked
against the RFC's own test vectors, and the OpenTimestamps proof and the Bitcoin block
header are parsed from their own published formats. There is nothing to install.
`pyproject.toml` here names the reader, its version (the release's) and that floor, and holds the
`ruff` rules CI checks it with; it declares no dependency and builds nothing.

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
product and are false outside it become **visible**. Twenty-seven of them did, and they are
the deliverable half of this directory: `mnema_verify.py gaps`.

Four of the twenty-seven were places the two readers **disagreed about the same bytes**, and
all four are closed. Between them they hold five disagreements, four of them acceptances (a
field no kind declares, on an appended event; a signer no enrolment authorized; an event
naming a signer other than the checkpoint over it; an event whose `which` is its `who` inside
a signed range) found by *building the input*, because nine mutations both
readers refused prove nothing about what this one accepts. The fifth ran the other way and is
the quieter of the two failures: this reader **refused an honest event** for carrying
`which`, which sixteen of the twenty-three vectors published when this was found carried, because the document
described the envelope as the intersection of its own exemplars. Refusing too much looks like
rigour, so nobody goes looking for it.

## What it checks

| | |
|---|---|
| **T1** | every entry's stored hash is the hash of its content and its position; the sequence is contiguous, and a gap is reported with its location |
| **T2** | each checkpoint's content root folds over the events of its range, from their canonical bytes |
| **T4** | the Ed25519 signature over the checkpoint's signed message, under a key whose material is **recomputed** to the fingerprint that names it, and a key file whose name is not its material's fingerprint refused whether or not a signature asks for it, as is a `.pub` that holds no key (a directory, a file it may not read, bytes that are not UTF-8, no PEM-wrapped Ed25519 `SubjectPublicKeyInfo`); a name that starts with `._` (macOS metadata) is skipped, as `.DS_Store` is, by name and with the reason, never with a traceback; and every event of the range names that key as its `signerFp`, with a `which` that is not its `who`; and every checkpoint and every event of a tail, checkpointed or not, names the key the tail id begins with, and one that names another is refused as `tail-signer-mismatch` |
| **T3** | the OpenTimestamps proof's subject is the checkpoint's digest, the path folds to the merkle root the stored header carries, and the header's own hash meets the target it declares, with section 8's three declared limits refused by name |
| **§1** | the 38 published vectors and the four aggregate digests, plus every refusal section 1 lists |
| **§4** | byte identity: re-serializing what a line holds reproduces that line exactly; and a line, its link, a checkpoint line or the tail proof holding a key beside the ones it has is refused, naming the keys |
| **§4.1** | every event rebuilt from the fields its `(kind, v)` contract declares in `event-schema.json`, and any other refused, which catches a forged field on a **newly appended** event, where byte identity cannot |
| **§6.2** | enrolment: every event's signer is a key **valid for its anchor** at that point in the fold, with a revocation and a restoring re-add taking effect only when signature-covered; a checker key signs check results only, and a retirement of one (signature-covered as well) leaves it signing nothing; an agent key signs only for the identity that enrolled it, under the `which` it was enrolled as, and nothing that changes who may sign, and a `key.enrolled` naming it is refused, and the facts it signed are counted as attested, those it signed before a retirement are counted per retired key, and every other `which` as declared, in the same numbers the product's census gives |
| **§6.4** | a note or a link taken back by an identity that did not write it is named as not applied, informational: the same retractions the product's census names |
| **§6.5** | a committed key with no tail is noted as a backup only when a signature-covered `backup.declared` by its own identity names it and the key is still that identity's; a declaration naming another identity's key is refused, and every other key with no tail is noted as one whose tail may have gone |
| **§6.7** | every move of a workflow judged where the merged order puts it, against the tables the `workflows` of `event-schema.json` publishes (a birth once, a row with the proof it requires, a successor the record holds, a run ended once, and a `from` that is the state there or the one its writer saw) and a move they do not allow named with the rule it broke, at the same place the product's census names it, the verdict unchanged |
| **§6.1** | every tail carries `tailproof.json`, an Ed25519 signature over its own id under the key the tail id names (looked up by the id, never by the proof's own `signerFp`), and a proof whose `signerFp` is another key is refused as `signer-mismatch` |
| n/a | the tail id's fingerprint is a key the record carries; whether the newest confirmed attestation reaches the last event |

## What it does not check

Printed on **every run that reads a record** (a verified one, a refused one, and one this
program broke on before it read a byte) because a gap that looks like coverage is worse
than an absence. `self-test` and `vectors` read no record and print none.

**This section is not a list.** It is held against what the program prints, entry for entry,
in both directions, by
[`second-reader-says-what-it-does-not-check.test.ts`](../src/chain/second-reader-says-what-it-does-not-check.test.ts).
It said three things while the program said four, the README never named G06, because it
was a list. `python3 mnema_verify.py --json gaps` prints the same five rows from the same
function the verdict prints them with.

**This list used to have two more entries, and they were places where it ACCEPTED what the
product refuses.** They are gone, which is the only kind of shrinking this list may do:

- **Enrolment** was not in the document at all. It is §6.2 now, and `§6.2` above is it,
  earned by `mutate.py checkpoint-by-an-unenrolled-key`: a checkpoint whose root folds,
  whose `prev` chains and whose Ed25519 signature genuinely verifies, and which is refused
  anyway because nothing ever brought its signer under the anchor its events name.
- **A forged field inside a payload, on an event appended above the last checkpoint**: the
  one a party with **no key** could walk through. The declarations are published now
  (`event-schema.json`, §4.1) and both readers refuse it, naming the same field. Reproduce
  with `mutate.py forged-payload-field-appended`, and its mirror:
  `appended-event-missing-a-declared-field`, a **required field left out**, which no amount
  of byte identity could ever have caught and which one exemplar per kind could never have
  told anybody about.

The window is still reported on every record read, because closing those two did not
close it:
*N event(s) sit above the last checkpoint and rest on the hash chain ALONE*.

What is left below are boundaries, not acceptances. Four of them are gaps the registry
classifies as a **limit of this reader** (a question no record can answer, so silence about
it says nothing) and the fifth is a limit `FORMAT.md` draws on itself, which is not a gap
and has no id:

<!-- NOT COVERED: each bullet's italic phrase and its trailing gap id are one row of
     `mnema_verify.py --json gaps`'s `scope`, verbatim and in order. Both directions are
     asserted; do not edit a bullet without the program, or the program without a bullet. -->

- §1: *the refusal of an explicit undefined property, over a record on disk*. JSON has no
  `undefined`, so no line can carry one; §1's refusal is exercised through an in-memory
  sentinel in `self-test` and is unreachable from a file. To look: `python3 mnema_verify.py
  self-test`. (G06)
- §3: *telling an authorized cut from tampering*. A sequence gap is reported and located;
  whether it was authorized cannot be read from here, because the document does not say what
  authorizes one. A cut that leaves the checkpoints behind **is** reported: if the events at
  the end of a tail go and `checkpoints.jsonl` stays, every signed range that outruns the
  entries present is named under §5. §6 makes `prev` the hash of the previous checkpoint's
  signed message, so a checkpoint dropped from the start or the middle is caught; the last
  ones dropped are not. By default both readers accept the checkpoints file deleted alone, and
  the last checkpoints deleted with their events kept; with `--require signed` both refuse
  them. The last events cut together with the checkpoints that covered them pass at every
  level, in both readers: only a copy of the record from before the cut shows them gone, and
  that copy is what the product's verify reads with `--since`. What stays unreadable is the
  **authorization**, and with it whether anything is missing. To look: `git log --stat -- <record>/tails`,
  because a cut is a commit. (G09)
- §7: *that a proof is never recomputed over a lifted reading*. No published vector carries
  `v > 1` and no upcaster is published, so there is nothing to lift. To look, in a checkout of the repository:
  `pnpm vitest run -t 'a chain written before a version bump still proves itself'`. (G18)
- §8: *the stored header's place in the Bitcoin chain*, which section 8 says of itself. To look:
  the verdict prints a command that turns each stored header into its block id, to be looked up
  in any explorer.

The other unresolved gaps are **findings about a record**, not limits: contiguity between
checkpoint ranges (G11), the unit of §8's thousand-step limit (G20), and a Sigstore bundle
beside a checkpoint, which this reader names and does not check (G26). Each is observable,
and each is reported by name with its location where a record has it, so announcing them
here, on a record that does not, would say of every record what is true of some.
`mnema_verify.py gaps` marks which is which.

**TWO ENTRIES LEFT THIS LIST BY BEING ALREADY ANSWERED, and the way they left is worth the
sentence.** *Which attestation inside a checkpoint dates the record* (G23) stood as a limit
of this reader while §8 already said *"Take the earliest confirmed block among them"*, and
*a `.blocks` sidecar with fewer headers than the proof has attestations* (G19) stood as an
open question while §8 already said such an attestation *"is neither coverage nor a break"*.
Both entries, and the note in the product's own test, entered in one commit and all three
went stale against the document they audit. What was actually wrong in the first case was
the PRODUCT: it elected the first attestation a walk of the proof reached and dated the
frozen record twenty minutes later than this reader did. It elects by height now, and the
two readers agree.

**WHAT THIS READER DOES NOT SAY: that a formatter rewrote the record.** The product's `verify` adds one line beside a refusal when the files read back in canonical form verify with no issue and every line put back is covered by a signature; this reader refuses the same records, by the same causes, and stops there. It is left out on purpose: the line moves no verdict, and this reader is worth what its independence is worth, which is measured in how little of it there is to audit. A second implementation of the condition is a second place where a tampering could come to be called a reformat. The verdict over those records is the one both readers give.

## The verdict, and the four things it can be

| exit | verdict | |
|---:|---|---|
| 0 | `VERIFIED` | every check that was planned ran, and none refused |
| 1 | `REFUSED` | a check ran and refused; the report names which |
| 2 | `INCOMPLETE` | nothing refused, but a check that was planned could not run |
| 3 | `BROKEN` | nothing was checked at all, or this program failed |

### `--require signed`: the same question the product's `verify` asks

By default an event written after the last checkpoint is **not** a refusal, here or in the
product's own `verify`: it rests on the hash chain alone, the verdict stays `VERIFIED` with
exit 0, and a note says how many sit there. A consumer that checkpoints on a cadence has such a
residual all the time, and a gate that always fails is a gate somebody switches off.

`--require signed` is how a caller says it will not accept that. It has the **same meaning and
the same exit** as the product's flag of the same name: every event of every tail has to be
covered by a checkpoint that verified, and at least one has to be. An event above the last
checkpoint, or a record in which no checkpoint verified over anything, is **`REFUSED`, exit 1**,
the exit of any other refusal, so a gate that tests for non-zero needs nothing more. The
default is `chained`, which is what a run without the flag has always been, and the default is
the same in both readers. `--require witnessed` is the product's third value and is not offered
here: this reader dates a record by its attestation (§8) and reports whether it reaches the
last event, but does not turn that into a refusal.

Both readers are held to this over the same bytes (an event appended with no key after the
last checkpoint, with and without the flag) by
[`second-reader-agrees-on-the-record.test.ts`](../src/chain/second-reader-agrees-on-the-record.test.ts).

`INCOMPLETE` exists because of a defect in this program's own ancestor: a 156-line
prototype printed `T2/T4 ok` on a line that ran unconditionally, **after** it had already
recorded a failure. There is no unconditional summary line anywhere here; the verdict is
derived from the findings rather than written beside them.

## The refusals, and how to earn one

`mutate.py` builds one named mutation at a time, in a copy
of a record you give it; most are inputs the format refuses, and five are not (see the
honest guarantee below). It ships here rather than beside a test: a guard and the mutation
that lights it are one artifact.

```
python3 mutate.py edited-event-chain-repaired /tmp/a-copy-of-a-record
python3 mnema_verify.py record /tmp/a-copy-of-a-record      # REFUSED, exit 1
```

That one is the sharpest of the keyless ones. It edits an event and then recomputes **every**
`hash` and `prev` in the tail, which needs no key at all: the entry hash is keyless. T1
closes again. What refuses it is the content root, folded over the event *content* and not
over stored hashes, which is what section 5 calls the load-bearing invariant of the whole
format. Before this directory existed, that claim had never been checked by anything but the
product's own tests.

`checkpoint-by-an-unenrolled-key` is its counterpart one layer up, and it is the reason this
directory can sign as well as verify. Everything sections 1 to 6 ask for **closes**: the
appended event's entry hash is right, the new checkpoint chains by `prev`, its content root
folds, and its signature verifies under a key whose committed material hashes to exactly the
fingerprint it is filed under. The key is RFC 8032 section 7.1's first test vector, whose
secret the RFC itself publishes: the one key a verifier can hold without holding a secret.
Only §6.2 refuses it, which is the whole difference between *the signature verifies* and
*the signer was allowed to sign*.

## The honest guarantee

**What this buys.** A verdict on a real record, reached from the document and the bytes, by
a program that has never seen the implementation. Twenty-seven places where the document was
not enough for that, each one written down. **A refusal for every mutation in `mutate.py`
but five, and none of the five is accepted by this reader alone.** Three are accepted by
both readers, because neither can see them: the newest events cut together with the
checkpoints that covered them (`aligned-cut`), a record erased and founded again, and a move
the workflow does not allow, which is named and is not a break. The other two are reported
INCOMPLETE rather than refused, and they are the two places below. This used to say there
was a refusal for every mutation, with no acceptance left. **One disagreement with the
product is pinned.** This paragraph used to say there was none, and a case in
`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts` says otherwise: a tail
cut in the middle with no `tail.pruned`, keys present and checkpoint signatures valid. The
product reads a signed range that outruns the entries present as the record contradicting
itself, and says broken. This reader says INCOMPLETE, because `FORMAT.md` §3 says a reader
of the document alone cannot tell an authorized cut from tampering and should report the gap
and stop. Both readings are faithful to the document. The same file pins one more place the
two verdicts differ, and it is wording rather than disagreement: with the public keys gone,
the product says broken over a signature it cannot verify, and this reader, unable to ask,
says INCOMPLETE. On a record in which no tail holds anything (no `tails/` directory, no tail
directory in it, or only tails that hold no event and no checkpoint), the two agree, and the
same file pins it: both refuse it by name under `FORMAT.md` §4, at every `--require`, with exit
1, and both still name each committed key with no tail (§6.5). This reader says BROKEN, exit 3,
only for a path with no directory at it. One tail deleted whole while another remains is not
that record: both verify it, `--require signed` included. The disagreement that was closed was
not an ambiguity of the document: §8 named the rule and the product did not follow it, so
the product changed and the readers now date the same record from the same block.

**What it does not buy.** Independence in the *social* sense. Same author, same repository,
same interest in it working. It is independent in the **technical** sense (another language,
written from the document, importing nothing) and that is enough to turn `FORMAT.md` from
prose into something continuously checked, and to find the ambiguities that are only visible
from outside. The social step, somebody else, is still not taken.

**And it is not a dependency of anything.** The product does not call this, and no step of
anything waits on it. It reads.

## Where it runs

The trunk's suite runs it on each of the three Node cells the repository's CI declares (the floor's exact patch, the current 24 and 26), through
[`../src/chain/second-reader-agrees-on-the-record.test.ts`](../src/chain/second-reader-agrees-on-the-record.test.ts),
[`second-reader-agrees-on-the-bytes.test.ts`](../src/chain/second-reader-agrees-on-the-bytes.test.ts)
and
[`second-reader-is-independent.test.ts`](../src/chain/second-reader-is-independent.test.ts).
It **fails** rather than skips where `python3` is absent: a second reader nobody runs is
prose again.

The floor at the top of this page is run too, not only stated: a CI job of its own sets up
exactly that Python, type-checks every line of the reader against it with a pinned `mypy`
(the cases only reach the lines they exercise), and runs every test file that starts `python3`.
[`the-python-floor-is-declared-once.test.ts`](../../code/tests/the-python-floor-is-declared-once.test.ts)
fails if this page, the root one, the job, the checker's target and the interpreter the cases
call stop naming the same version. The checker is the job's, not the reader's: running the
reader still needs nothing but the standard library.

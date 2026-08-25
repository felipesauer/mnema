# The mnema chain format

This document specifies the bytes. It is written so that **someone who did not
write this code can implement a verifier from it**, run the published vectors
against their implementation, and get the same digests we do.

Everything below is a statement about behaviour, and every one of them **names the
test that holds it**. A claim with no test beside it is an intention, not a
guarantee, and is marked as such. The version tags in this document are read out
of the source by a guard (`packages/chain/src/format-doc.test.ts`), so a bump in
the code reddens this file rather than leaving it describing a format nobody
writes any more.

## The published vectors

`canonical-vectors.json`, beside this file, is the machine-readable half. It
holds, for every kind of event the catalog can contain:

- the event, exactly as this product writes it;
- the SHA-256 of its canonical bytes.

Plus the aggregate digests: the fold over an empty range, the entry hash of a
genesis entry and of a linked one, and the content root folded over every vector
in file order.

The file has **one** source of those digests: it declares them, and the test
recomputes them from the code
(`packages/chain/src/events/canonical-vectors.test.ts`). A digest changed in the
file alone goes red; a change to the code that moves the bytes goes red on every
row. The set of vectors is total over the catalog **by type**
(`packages/chain/src/events/vectors.ts`): a kind added to the catalog does not
compile until it has one.

To check an implementation: canonicalize each `event` by the rules in §1, SHA-256
the bytes, and compare with the row's `sha256`.

## 1. Canonicalization: an event becomes bytes

Everything the chain proves is proven over these bytes. The requirement is that
**any** party — the writer now, a verifier in ten years, a clone with no secret —
derives the same bytes from the same event.

The form is JSON, serialized under these rules
(`packages/chain/src/events/canonical.test.ts`):

1. **Object keys are sorted**, recursively, by UTF-16 code unit, after step 3.
   Insertion order never affects the output.
2. **Array order is preserved.** Order in an array is semantic.
3. **Every string — value AND key — is normalized to NFC** before it is
   serialized or sorted.
4. **Strings are escaped by JSON semantics** (the shortest form `JSON.stringify`
   produces).
5. **`-0` is emitted as `0`.**
6. **The output is UTF-8** with no insignificant whitespace: no spaces after `:`
   or `,`, no trailing newline.

And these values are **refused**, rather than coerced — a value that cannot
round-trip losslessly would let two different facts produce identical bytes:

- `NaN` and `±Infinity` (`JSON.stringify` turns them into `null`);
- a string containing a **lone surrogate** (not valid Unicode text);
- an **explicit `undefined`** property (drop-or-keep would be an arbitrary
  choice);
- **two keys that normalize to the same string** (the object would be ambiguous).

## 2. Framed hashing

Every digest in this format is a SHA-256 over a **length-framed,
domain-separated** byte stream, never over plain concatenation:

```
digest = SHA-256( frame(domain) ‖ frame(field₁) ‖ frame(field₂) ‖ … )
frame(bytes) = uint32_be(len(bytes)) ‖ bytes
```

The frame is what makes field boundaries unambiguous: without it, `"a" + "bc"`
and `"ab" + "c"` are the same bytes, so two different field tuples could collide
without a SHA-256 collision (`packages/chain/src/chain/hash.test.ts`).

## 3. The entry hash

Binds one event to its position in a tail and to its predecessor. Domain:
`mnema.entry.v1`. Fields, in order:

| # | Field | Framed as |
|---|---|---|
| 1 | the event's canonical bytes (§1) | the bytes |
| 2 | the tail id | UTF-8 of the string |
| 3 | the sequence number | UTF-8 of its **decimal** spelling |
| 4 | the predecessor's entry hash | UTF-8 of the hash, or **an empty field** when there is none |
| 5 | a literal | UTF-8 of `genesis` when there is no predecessor, `linked` otherwise |

A genesis entry and an entry whose predecessor is the empty string produce
different digests — that is what fields 4 and 5 together are for
(`packages/chain/src/chain/hash.test.ts`).

A tail id is `<signing-key-fingerprint>-<installation-id>`. Sequence numbers start
at 0 and are contiguous within a tail; a verifier that meets a gap reports it and
names where (`packages/chain/src/chain/waiver.test.ts`).

## 4. The stored line

A tail is a JSONL file. Each line is the **canonical** serialization (§1) of:

```json
{"event":{…the event as written…},"link":{"hash":"…","prev":"…"|null,"seq":0,"tail":"…"}}
```

The line carries the event **as it was written**, so the bytes on disk are the
bytes the entry hash was taken over; re-serializing an entry read back from a line
reproduces that line byte for byte
(`packages/chain/src/chain/format-on-disk.test.ts`). A genesis link is a `null`
`prev`, never an empty string, and the top-level keys are `event` and `link` with
no insignificant whitespace between them — the same file holds both.

A reader **rebuilds** the event from the fields its kind declares and rejects any
other, so a forged extra field cannot ride along into the signed bytes
(`packages/chain/src/events/parse.test.ts`). What that buys is that the rebuilt
event re-canonicalizes to bytes which differ from the stored line, so the
verifier's "stored bytes equal recomputed bytes" check refuses the line rather
than reading past the forgery (`packages/chain/src/chain/chain.test.ts`).

## 5. The content root

A fold over a sequence of events, recomputed **from their canonical bytes**.
Domain: `mnema.root.v1`.

```
acc₀    = SHA-256( frame("mnema.root.v1") ‖ frame("empty") )
accᵢ₊₁  = SHA-256( frame("mnema.root.v1") ‖ frame(accᵢ) ‖ frame(bytes(eventᵢ)) )
root    = acc_n                       (hex, lower-case)
```

An empty range has a fixed root distinct from any single-event root, and a
two-event fold can never equal a one-event fold over the concatenation
(`packages/chain/src/chain/hash.test.ts`).

**The load-bearing invariant of this whole format:** the root is folded over the
event **content**, never over stored entry hashes. If it folded stored hashes, an
adversary who edited an event and then repaired the keyless hash chain would leave
the signed head unchanged, and the signature over it would still verify. Folding
the content means editing any event flips the root even after every entry hash is
repaired (`packages/chain/src/chain/invariants.test.ts`).

## 6. The signed checkpoint

A checkpoint covers a contiguous range `[fromSeq..toSeq]` of one tail. The signed
message is the canonical bytes (§1) of this object — **the signature field is not
part of it**:

```json
{"contentRoot":"…","fromSeq":0,"prev":"…"|null,"scheme":"mnema-checkpoint/1","signerFp":"…","tail":"…","toSeq":9}
```

- `contentRoot` is §5 folded over the events of the range, in order.
- `prev` is the SHA-256 of the **previous checkpoint's signed message**, or `null`
  for the first. So checkpoints form their own chain: dropping an earlier one
  while keeping a later one breaks the link.
- `signerFp` is the full fingerprint of the signing key, bound into the signed
  bytes so a signature cannot be re-pointed at another key.
- The signature is **Ed25519** over those bytes, hex-encoded, stored as `sig`
  alongside the fields.
- `scheme` is `mnema-checkpoint/1`; a reader refuses a scheme it does not know
  rather than guessing at the fields, and the signature is over the seven keys
  above with `sig` absent
  (`packages/chain/src/chain/format-on-disk.test.ts`).

## 7. Versions, and why a proof is never recomputed over a reading

Every event carries `kind` and `v`. Together they select exactly one payload
contract. A reader lifts an old `v` forward through registered upcasters, so what
a consumer holds is the event re-expressed under **today's** contract.

**A proof is never recomputed over that.** Both digests are taken over the form
that was WRITTEN. Hand a lifted event to a digest and the first kind that ever
gains a `v2` makes every chain written before it report as tampered — entry hashes
stop matching, and checkpoint signatures stop verifying: a keyless-editor alarm
raised by an honest read
(`packages/chain/src/chain/upcast-vs-proof.test.ts`).

## 8. The external witness (T3)

A checkpoint can be **dated by somebody outside this machine**. That closes the one
hole the two layers above cannot: a party who holds the signing key can rebuild the
whole chain and re-sign it, and everything in sections 1–7 will verify. What they
cannot produce is an attestation dated before they started.

What is attested is **the SHA-256 of a checkpoint's signed message** (§6) — the same
digest `prev` links to — and nothing else. No id, no title, no body, no count leaves
the machine. And because checkpoints chain, attesting **one** dates every checkpoint
below it: this is not an attestation per event, nor even per checkpoint.

Two files sit beside the checkpoints they are about:

```
tails/<tailId>/witness/<checkpointHash>.ots      an OpenTimestamps detached proof
tails/<tailId>/witness/<checkpointHash>.blocks   the 80-byte Bitcoin block headers
```

- The `.ots` is **[OpenTimestamps](https://opentimestamps.org)' own format, unaltered**
  — a Merkle path from the digest to a Bitcoin block's merkle root. A stranger runs
  the `ots` client on it, against any Bitcoin node, and gets the same answer without
  this product installed. The file is named by the digest it commits to, so a reader
  knows which checkpoint it is about before opening it.
- The `.blocks` sidecar is **this format's**, and it is what makes verification
  offline: one JSON object per line (§1's canonical form), `{"header":"<160 hex>","height":<n>}`,
  each header the 80 bytes Bitcoin serializes. It is separate from the `.ots` so that
  the file a stranger checks stays byte-for-byte the ecosystem's.

A verifier reading them offline asks three things, and all three are arithmetic:
the proof's subject equals the checkpoint's digest; the path folds to the merkle root
the stored header carries (bytes 36–68, internal order); and the header's own hash
meets the target it declares, which must be at least `0x1800ffff` — 2**40 times the
genesis difficulty. A header mined at an easier target is refused, because one is
found in milliseconds (`packages/chain/src/chain/bitcoin.test.ts`).

**What a reader refuses before it reads.** Both files are committed, so a clone opens
whatever the last person to write the repository put there. Three limits are declared
rather than left to a stack: a path deeper than **1000 steps**, a proof past **1 MiB**,
and a message a path has folded past **4 KiB** are each refused by name. A real proof is
eight or nine steps per calendar, 3,586 bytes complete, and folds messages of about a
hundred bytes — so every limit has between one and four orders of magnitude of room, and
each is a refusal, which can only ever reject an exotic proof and never accept a hostile
one. (Measured on the reader before they existed: a 30 KB file of one repeated byte took
the parse past V8's stack; a 979 KiB file of `append` steps walked in 238 ms and ended
holding a megabyte.)

**A request that has not confirmed is not coverage — and it is never silence.** A
proof is born incomplete — the calendars promise to aggregate it, and a Bitcoin block
carries it minutes to hours later — so between asking and holding there is a third
state, reported as `pending` and counted as nothing
(`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-record.test.ts`). Counting for nothing is not the
same as being dropped, and the reader used to do both: a record whose only proof was
still in flight answered `nothing outside this machine attests this record`, which is
the sentence a record nobody ever stamped earns, and the act that follows from it is
to stamp again. A request is now reported wherever it is found — with the calendar it
is with, when the proof names one — and it still raises no level and satisfies no
`--require` (`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-then-written.test.ts`,
`packages/code/src/commands/witness.test.ts`).

**The attestations accumulate, and a reader asks all of them.** Nothing in this format
removes a witness file: stamp today, write tomorrow, and yesterday's `.ots` stays under
yesterday's digest, still proving that that checkpoint existed at that instant. So a
reader takes the **newest** checkpoint it holds a confirmed attestation for — and the
newest request still open, for when there is no confirmed one — and reports
three things together — the instant, the block, and **how many events were written after
the checkpoint that instant dates**. A record whose newest attestation reaches its last
event reads `covered`; one dated to an earlier point reads `not covered` and says the
date and the remainder in one sentence, because a date without a boundary claims more
than it holds. (Before this, a reader asked only about the last checkpoint, so a record
holding a valid attestation answered `nothing outside this machine attests this record`
the moment one more event was written — an understatement of what its own files prove.
`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-record.test.ts`.)

What this layer does **not** prove, said here rather than in a footnote: the stored
header is checked for its work, not for its place in the chain. A reader who needs
that follows the block id into any explorer, or runs the `ots` client against a node
— which the unaltered `.ots` is there for.

## What this document does **not** promise

Stated plainly, because a published format invites all three readings:

- **It is not an open standard.** It is this product's format, published and
  checkable. There is no standards body, no registry, and no commitment to a
  process for changing it. What is committed is that a change to the bytes moves a
  published digest, which is visible.
- **There is no second implementation.** Every digest here was produced by the
  one codebase this document describes, and checked by tests that live in it. A
  format with three independent implementations checking each other has a kind of
  assurance this one does not have yet, and publishing the vectors is the first
  step toward it rather than a substitute for it.
- **Publishing the format adds no witness — and §8 is not the format's doing
  either.** The threat sections 1–7 do not cover is an edit made *with* the signing
  key: a key holder can rewrite and re-sign, and everything there will verify.
  Detecting that needs somebody OUTSIDE, and this used to say that was outside this
  document and outside this package. §8 brought it inside — but by taking a
  dependency on Bitcoin and on a public calendar answering, not by anything
  publishing these bytes achieved. A record nobody stamped is exactly where it
  always was. See the "What it proves — and what it does not" table in `README.md`.
- **This document specifies the bytes, not the workflow.** Which states a task
  may move between, which scope a fact is written to, what a verifier's verdict
  means — none of that is here.

## The delivery channel, and what it is not

The vectors travel with **this repository**. They are not in any npm tarball:
`@mnema/chain` is an internal package that is never published, and the one
package that is published (`@mnema/code`) ships its compiled `dist/` only. So the
address of the artifact is its path in the repository, and the guard that keeps
this document from pointing at a file that moved is
`packages/chain/src/format-doc.test.ts`.

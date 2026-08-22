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

A tail id is `<signing-key-fingerprint>-<installation-id>`. Sequence numbers
start at 0 and are contiguous within a tail.

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
- **Publishing the format adds no witness.** The threat this format does not
  cover is an edit made *with* the signing key: a key holder can rewrite and
  re-sign, and everything above will verify. Detecting that needs an external
  witness, which is outside this document and outside this package. See the
  "What it proves — and what it does not" table in `README.md`.
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

# The mnema chain format

This document specifies the bytes. It is written so that **someone who did not
write this code can implement a verifier from it**, run the published vectors
against their implementation, and get the same digests we do.

**Somebody has.** [`verifier/`](./verifier/) beside this file is a second implementation, in
Python, written from this document and importing nothing of the product it checks. It
reproduces the 23 published vectors and the four aggregate digests, and reaches the same
verdict as the product over the frozen records in the test suite
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`), on honest records
and on every input the format refuses. Twenty-five points
where this document was **not enough** for that were found in the writing, and every one of
them has been fixed here — `python3 verifier/mnema_verify.py gaps` lists them, with which
were resolved by reading a specification, which by experiment against the published bytes,
and which are still open.

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

The vectors are **exemplars, not a schema** — one event per kind, from which a
required field and an optional one that happens to be present look identical. The
schema is the other artifact, `event-schema.json`, described in §4.1.

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
4. **Strings are escaped by JSON semantics.** Escaped, and **only**: `"` as `\"`,
   `\` as `\\`, and the code points `U+0000` to `U+001F` — using `\b` `\t` `\n`
   `\f` `\r` where a two-character form exists and `\u00xx` in **lower-case** hex
   otherwise. Everything else travels literally in UTF-8: `/` is **not** escaped,
   `U+2028` and `U+2029` are **not** escaped, `U+007F` is **not** escaped, and
   `<`, `>` and `&` are **not** escaped. (It is what `JSON.stringify` produces.
   This used to say only that, and only that is not a rule an implementer outside
   JavaScript can check — they have no `JSON.stringify` to consult. It is also not
   a safe default to assume: Go's `encoding/json` escapes `<`, `>` and `&` unless
   told otherwise, so an implementation obeying every other rule here produces
   different bytes for any title containing them.
   `packages/chain/src/chain/second-reader-agrees-on-the-bytes.test.ts` runs the
   rule against `JSON.stringify` over each of those characters.)
5. **`-0` is emitted as `0`.**
6. **The output is UTF-8** with no insignificant whitespace: no spaces after `:`
   or `,`, no trailing newline.
7. **A number is spelled the way ECMA-262's `Number::toString` spells it**: the
   shortest decimal digits that round-trip, written out in full while the decimal
   exponent is in `(-7, 21]` and exponentially outside it. So `1.0` is `1`, `1e-6`
   is `0.000001`, `1e-7` is `1e-7`, `1e20` is `100000000000000000000` and `1e21` is
   `1e+21`. This rule used to be missing entirely, and it is the one an
   implementation outside JavaScript gets wrong without noticing: Python's default
   spells `1.0` as `1.0` and `1e-7` as `1e-07`, and Go's spells `1e20` as `1e+20`
   (`packages/chain/src/chain/second-reader-agrees-on-the-bytes.test.ts`, which
   compares the rule against `JSON.stringify` itself over every boundary it has).

And these values are **refused**, rather than coerced — a value that cannot
round-trip losslessly would let two different facts produce identical bytes:

- `NaN` and `±Infinity` (`JSON.stringify` turns them into `null`), and the JSON
  literals `NaN`, `Infinity` and `-Infinity` on a stored line, which are not JSON
  but which several parsers accept;
- a string containing a **lone surrogate** (not valid Unicode text). Note that
  `JSON.stringify` *does* produce bytes for one — `"\ud800"` — so rule 4 read on
  its own says to emit it and this line says not to. This line wins;
- an **explicit `undefined`** property (drop-or-keep would be an arbitrary
  choice). JSON has no `undefined`, so no stored line can carry one: this refusal
  is reachable only by a party canonicalizing from memory, which is the writer;
- **two keys that normalize to the same string** (the object would be ambiguous)
  — and that reaches the **literal duplicate** `{"a":1,"a":2}` as well as the
  NFC collision. It has to be said, because every library JSON parser, including
  Python's `json` and JavaScript's `JSON.parse`, silently keeps the last of two
  identical keys: a reader that lets its parser do that accepts a line this
  format refuses (`packages/chain/src/chain/second-reader-agrees-on-the-bytes.test.ts`).

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

A tail id is `<signing-key-fingerprint>-<installation-id>`, and the fingerprint
being **a public key the record actually carries** is a requirement rather than a
description of the shape. Without it, the per-entry `link.tail == <directory>`
check only proves that a tail is consistent with a directory name whoever wrote
the repository chose: a tail copied into `tails/<fabricated>/`, relabelled, and
re-chained — which needs no key at all, since the entry hash is keyless — would
have its events counted a second time with everything verifying. A verifier
refuses a tail whose fingerprint prefix is not a committed key
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`), and the
locally chosen suffix is bound by the tail proof below.

Sequence numbers start at 0 and are contiguous within a tail; a verifier that
meets a gap reports it and names where
(`packages/chain/src/chain/waiver.test.ts`). **What authorizes a gap is not
specified here.** There is a mechanism — the catalog has a `tail.pruned` kind, and
the test named above is about waivers — and this document does not describe what a
waiver is, where it lives, or what it signs. So a party reading only this document
cannot tell an authorized cut from tampering, and the honest thing for them to do
is report the gap and stop. That is a hole in this document, not in the format.

## 4. The stored line, and where it is stored

**A tail is a directory, not a file.** This section used to open by calling a tail
"a JSONL file", which is what a reader implementing from this document discovers
is false the moment they open one: a naive `*.jsonl` glob reads the checkpoints as
if they were events. The layout, which only ever appeared here incidentally in §8:

```
<record>/keys/<fingerprint>.pub                 the public keys (§6)
<record>/tails/<tailId>/NNNNNN.jsonl            the segments — six digits, in name order
<record>/tails/<tailId>/checkpoints.jsonl       the signed checkpoints (§6)
<record>/tails/<tailId>/tailproof.json          the tail proof (§6.1)
<record>/tails/<tailId>/witness/<hash>.ots      an external attestation (§8)
<record>/tails/<tailId>/witness/<hash>.blocks   its offline sidecar (§8)
```

The tail is the concatenation of its segments in name order, and sequence numbers
are contiguous across that concatenation — **which segment a given sequence number
falls in is not specified**, and a verifier should not depend on it. Nothing else
in the tail directory is a segment.

Each line of a segment is the **canonical** serialization (§1) of:

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

**Byte identity alone is not enough for that, and this document used to leave a
reader with nothing else.** It catches a field added to a line that was already
written, because the stored entry hash stops matching. It cannot catch a NEWLY
APPENDED event carrying one: the entry hash takes no key, so whoever can write
the repository computes it; above the last checkpoint no signature covers it; and
the envelope keys are all present. What refuses that is the declaration, and the
declarations were published nowhere — measured, on an independent verifier built
from this document, which read such an event as verified while this product read
it as unreadable. The next section is that hole, closed.

### 4.1 The field declarations

`event-schema.json`, beside this file, is the **second machine-readable half**:
what every kind declares, in the same closed vocabulary the reader applies. It is
not a description of the reader — it is the reader's own table, serialized, and a
guard holds the two byte for byte
(`packages/chain/src/events/event-schema.test.ts`). The vectors are one exemplar
per kind, from which required and optional cannot be told apart; this file is the
schema.

```json
{"schemaVersion":1,"describedBy":"FORMAT.md","rules":{…},"envelope":{…},"transitionFields":{…},
 "contracts":[{"kind":"memory.captured","v":1,"payload":{"content":"string"}}, …]}
```

- **A contract is selected by `kind` and `v` together**, which is the pair every
  event already carries (§7). A reader looks up the row whose `kind` and `v` both
  match the line, and **refuses a line whose pair no row declares** — a version
  ahead of the table is a contract the reader does not have, not one it may guess
  at. A kind that gains a second version gains a second row; the file's shape does
  not change, which is what makes such a change one visible row in a diff.
- **The top-level keys of an event are the keys of `envelope`, plus `payload`.**
  Six envelope fields are required and two — `which` and `run` — are optional, and
  an event carrying one of those is an ordinary event rather than an anomaly.
- **Every object here is CLOSED.** A key that the matching declaration does not
  name is refused, in the envelope, in the payload, and inside `transitionFields`.
  The reader rebuilds each object from exactly the declared keys and never returns
  the parsed one.
- **A declared field that is optional and absent stays absent** in the rebuild — it
  is never filled in with a default, an empty string or a `null`, because the
  rebuild has to canonicalize to the bytes that were signed.

The `rules` object in the file carries a one-line gloss of each rule name, so the
artifact is readable on its own. This is the normative statement of the same
vocabulary:

| rule | a field under it is |
|---|---|
| `string` | present, and a non-empty string |
| `string?` | absent, or a non-empty string. Absent is not `null` and not `""` |
| `string\|null` | present, and either a non-empty string or an explicit `null` — a VALUED absence (the state a birth transition left behind), which is why it is a spelling of its own and not an optional |
| `boolean` | present, and exactly `true` or `false`. **Nothing is coerced**: `"false"`, `0` and `null` are all falsy in JavaScript and none of them is the position of a switch |
| `count` | present, and a whole number of at least 1 (a safe integer). A float, a `-0` or a `1e3` is refused |
| `fields?` | absent, or the object `transitionFields` declares — closed the same way, and **never empty**: an empty `fields` carries no proof, and admitting it would make `{}` a second, byte-distinct spelling of "no fields" |
| `string[]?` | absent, or a non-empty array of non-empty strings |
| `version` | (envelope only) present, and a whole number of at least 1; with `kind` it selects the contract |
| `kind` | (envelope only) present, and the non-empty string naming the contract |
| `instant` | (envelope only) present, and the exact spelling `Date.prototype.toISOString` produces — UTC, millisecond precision, trailing `Z` — of a real date. Every producer stamps `at` through the clock, which IS `toISOString`, so a timezone offset or a missing sub-second digit is a corrupt or forged line rather than a differently-spelled one |

An implementation that applies this table refuses what this product refuses: the
same appended event that used to read as verified from outside now reads as
refused (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).

## 5. The content root

A fold over a sequence of events, recomputed **from their canonical bytes**.
Domain: `mnema.root.v1`.

```
acc₀    = SHA-256( frame("mnema.root.v1") ‖ frame("empty") )
accᵢ₊₁  = SHA-256( frame("mnema.root.v1") ‖ frame(accᵢ) ‖ frame(bytes(eventᵢ)) )
root    = acc_n                       (hex, lower-case)
```

**Inside `frame(accᵢ)` the accumulator is the raw 32 bytes**, not the hex it is
finally reported as. Both readings of the line above are grammatical and they
produce different roots, so this sentence is the difference between implementing
§5 and flipping a coin about it. `contentRootOverAllVectors` in
`canonical-vectors.json` is what settles it from outside: only one of the two
reproduces it.

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
- `prev` is lower-case hex, like every digest here.
- `signerFp` is the full fingerprint of the signing key, bound into the signed
  bytes so a signature cannot be re-pointed at another key. **The fingerprint is
  the SHA-256 of the key's `SubjectPublicKeyInfo`** — the DER `spki` encoding,
  including the twelve-byte RFC 8410 prefix for `id-Ed25519` — in lower-case hex.
  That sentence is what makes the clause before it *checkable*: a verifier that
  cannot recompute a fingerprint from key material has to trust the filename the
  key arrived under, and then a signature is re-pointed at another key by renaming
  a file. The keys are `<record>/keys/<fingerprint>.pub`, PEM-wrapped
  `SubjectPublicKeyInfo`, and a verifier recomputes the name from the contents
  (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).
- The signature is **Ed25519** over those bytes (RFC 8032), hex-encoded, stored as
  `sig` alongside the fields. The checkpoints of a tail live in
  `checkpoints.jsonl`, one canonical line each — the eight keys, `sig` included,
  sorted by §1 — in chain order.
- **Whether the signer was AUTHORIZED is a layer above this one**, and §6.2 is
  that layer. §6 is satisfied by a signature that verifies under the key its
  `signerFp` names; that the key was *valid for its anchor at that point in the
  chain* is a separate question, answered by folding the chain's own enrolment
  facts. This used to say the rule "is not specified in this document", and an
  implementation built from the document alone accepted a signature by any key in
  `keys/` and was right to. It is specified now.
- `scheme` is `mnema-checkpoint/1`; a reader refuses a scheme it does not know
  rather than guessing at the fields, and the signature is over the seven keys
  above with `sig` absent
  (`packages/chain/src/chain/format-on-disk.test.ts`).

### 6.1 The tail proof

Beside the segments of every tail sits `tailproof.json`: the owner's signature over
its own tail id, made once at birth. It went undocumented until an independent
verifier found a signed artifact in a tail directory that this document had never
mentioned, and had to try five candidate messages to learn what it signs.

```json
{"scheme":"mnema-tail/1","sig":"…","signerFp":"…","tail":"…"}
```

The signed message is the same shape as §6 — the canonical bytes (§1) of the object
with **`sig` removed**, so `{"scheme","signerFp","tail"}` and nothing else. The
signature is Ed25519 under the key `signerFp` names, which is the fingerprint the
tail id begins with.

What it is for is the other half of §3's requirement. The fingerprint prefix of a
tail id is a committed key, but the installation-id suffix is chosen locally and
binds to nothing on its own — so a party holding no key could copy a tail whose
events are not yet checkpointed into `tails/<real-fingerprint>-<forged>/` and have
them counted twice. Only the key holder can sign a statement naming a new tail id,
and a genuine proof does not transfer to a different one, because the id **is** the
message (`packages/chain/src/chain/format-on-disk.test.ts`).

### 6.2 Enrolment: which key was authorized, and when

A signature that verifies proves **which key** made it. It does not prove that the
key was allowed to. Those are different claims and the second is the one that
matters, so this section says how a reader gets it from the record and nothing
else. It went unwritten while the kinds that carry it — `key.enrolled` and
`key.revoked` — sat in the published vectors: the bytes of the facts that carry
the authorization were published, and the rule that reads them was not.

**An identity is one ANCHOR with a set of keys**, and the set changes over the
length of the chain. The anchor id is derived from a fingerprint:

```
anchor(fp) = "mnid:" ‖ SHA-256( UTF-8 of the 64-character lower-case fingerprint )   (hex, lower-case)
```

The hash is over the fingerprint's **hex text**, not over the 32 bytes it spells —
the same distinction §5 makes for the accumulator, and the same coin-flip if it is
left unsaid. An anchor is a value distinct from any fingerprint, which is what
leaves room for several keys under one anchor without the anchor ever being one of
them.

**The order the facts are folded in.** Enrolment spans tails — a key enrolled on
one machine authorizes events on another — so the fold runs over **every tail
merged into one order**: within a tail, `seq` order, which the hash chain proves
and which nothing may override; across tails, the head with the smallest `at` goes
next, ties broken by tail id ascending. That is the same k-way merge a reader uses
for anything else that has to be deterministic across tails.

**Three facts change the set**, and each is refused as an operation — not merely
recorded — when its own conditions do not hold. `subject` is always the anchor.

| kind | what it must satisfy | what it does |
|---|---|---|
| `identity.founded` | `signerFp == payload.foundingFp`, `subject == anchor(foundingFp)`, and `who == subject` | adds `foundingFp` to the anchor's set |
| `key.enrolled` | `who == subject`; `signerFp` is in the anchor's set **at this point**; and `payload.reverseSig` is a valid Ed25519 signature, by the key `payload.newFp` names, over the UTF-8 of `enroll:<anchor>:<newFp>` | adds `newFp` |
| `key.revoked` | `who == subject`; `signerFp` is in the anchor's set at this point | removes `payload.revokedFp`, from this point forward |

The `reverseSig` is the new key's own proof of possession, and it is checked
against `keys/<newFp>.pub` **with that file's fingerprint recomputed** (§6): a
member could otherwise enrol a key it does not hold, or swap the file afterwards
and have someone else's signature verify against it.

**And every other event is authentic only if its `signerFp` is in the set of its
own `who` at its point in the fold.** That is the whole rule; there is no
"the anchor is my own key" shortcut. A lone key still founds its anchor, so one
key is a one-member set.

**Two of the three take effect only when they are themselves SIGNATURE-COVERED**,
and this is the part a reader gets wrong by omission rather than by error. An
event above the last checkpoint of its tail rests on the hash chain alone, and the
entry hash takes no key — so a party with no key at all can append there.

- A `key.revoked` in that window is **ignored**. A revocation removes a key that
  judges OTHER, already-checkpointed events, so honouring an uncovered one would
  let a keyless party fabricate a tail, revoke a member from it, and flip an
  honest fully-signed chain to failing — a denial of authenticity with no key. A
  legitimate revoker checkpoints the revocation; a keyless party cannot, because a
  checkpoint needs the tail's private key.
- An `identity.founded` or `key.enrolled` that would **restore a key some covered
  `key.revoked` removed** is ignored in that window too, and for the mirror
  reason: it would undo a signed removal and re-authorize that key's later,
  checkpointed work. A first enrolment, or any addition that restores nothing
  covered, is not gated — it only ever empowers events naming the added key, and
  those sit in the same untrusted window anyway.

"Covered" means: the event's own `seq` is at or below the highest `seq` reached by
a checkpoint of its tail whose signature verified.

**What this does NOT decide**, said here because it looks like it should: whether
the tail an event sits in is genuine. A keyless party who fabricates a tail under
a real enrolled fingerprint names a valid signer and passes this fold — and is
refused earlier, by §3's requirement on the tail id and by §6.1's tail proof. The
fold only ever runs over tails whose key owns them
(`packages/chain/src/chain/enrollment.test.ts`,
`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).

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

**This is the one section a second implementation cannot check today**, and it is
said here rather than left to be discovered: no kind in the published vectors
carries a `v` above 1, and no upcaster is published, so there is nothing for an
outside reader to lift. The claim rests on the test above, which lives inside the
codebase it is about. The first kind to gain a `v2` should gain a published vector
for the old `v` alongside it.

The top-level keys of an event are the keys `event-schema.json` declares under
`envelope`, plus `payload` — **eight names, of which two are optional**. This
paragraph used to read *"the seven top-level keys of an event are `at`, `kind`,
`payload`, `signerFp`, `subject`, `v` and `who`"*, and that sentence was false: it
was the INTERSECTION of the published vectors, and `which` and `run` are carried
by sixteen and three of those same vectors respectively. What falsified it is that
an independent verifier believed it — it took the intersection, as the sentence
invited, and **refused an honest event for carrying `which`**, on a record this
product read as fine (§4.1, gap G25). A required field and an optional one look
identical in an exemplar, which is the whole reason the declarations are now
published rather than described.

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

The arithmetic of the third one, spelled out because only the second one's byte order
was: the header's own hash is the **double** SHA-256 of its 80 bytes, compared as a
**little-endian** integer against the target that `bits` (bytes 72–76, little-endian)
declares in Bitcoin's compact form — `(bits & 0x007fffff) << 8·((bits >> 24) − 3)`.
Under that expansion `0x1800ffff` is `0xffff · 2^168` and the genesis `0x1d00ffff` is
`0xffff · 2^208`, and `208 − 168 = 40`, which is where the sentence above comes from.

**The sidecar and the proof's attestations do not match up one to one, in either
direction.** A `.blocks` file may carry headers the proof beside it does not use, and a
proof may attest a block the sidecar has no header for — the frozen `witnessed-record`
does both at once, attesting blocks 963688, 963689 and 963690 while shipping two headers.
The pairing is by the height the attestation declares. A bitcoin attestation whose header
is absent is simply one that cannot be folded offline; it is neither coverage nor a break.

**Which attestation dates the record, when a checkpoint has several.** It usually has
several — three calendars, three attestations, and they land in different blocks. Take
the **earliest confirmed block** among them: an attestation in an earlier block is the
stronger claim, since existing at that instant implies existing at every later one, and
the alternative — the first one a walk of the proof happens to reach — makes the reported
date depend on the order the branches of a third-party file were serialized in. This
sentence was missing, and its absence is the one thing two faithful readers of this
document have been measured disagreeing about
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, which pins both
answers and the reason).

**What a reader refuses before it reads.** Both files are committed, so a clone opens
whatever the last person to write the repository put there. Three limits are declared
rather than left to a stack: a path deeper than **1000 steps**, a proof past **1 MiB**,
and a message a path has folded past **4 KiB** are each refused by name. **A step is one
OpenTimestamps operation** — one `append`, `prepend` or hash — which is the unit the limit
counts and which used to be left to the reader to guess. Measured over the three frozen
proofs: 8 to 14 operations from the digest down to a calendar's own `pending` leaf, and
**77 to 83** down to a bitcoin leaf, in files of 3,586 to 3,761 bytes folding messages of
about a hundred. So the depth limit has a little over one order of magnitude of room, the
size limit nearly three, and the fold limit nearly two — each is a refusal, which can only
ever reject an exotic proof and never accept a hostile one. (This paragraph used to justify
the depth limit with "eight or nine steps per calendar", which is the distance to a
`pending` leaf and not the distance the limit guards; the number it implied was an order of
magnitude off the one the counter sees.) (Measured on the reader before they existed: a 30 KB file of one repeated byte took
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
the checkpoint that instant dates**. The ACT that completes a request walks the same way,
newest first, stopping at the first attestation that confirms
(`packages/code/src/commands/witness.test.ts`); it asked only about the last checkpoint
for a while after the reader stopped doing so, which left a record able to hold a request
the reader reported and the act would not finish. A record whose newest attestation reaches its last
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
- **There is a second implementation, and it is not an independent PARTY.** This
  entry used to read *"there is no second implementation"*, and
  [`verifier/`](./verifier/) is what falsified it: a verifier in Python, written
  from this document, importing nothing of the product, reproducing the published
  vectors and reaching the same verdict as the product over real records —
  **including on every input the format refuses**, which is the half that took a
  second delivery: it accepted two things the product refused (a field no kind
  declares, on an appended event; a signer no enrolment authorized) and refused one
  thing the product accepts (an honest event carrying `which`). §4.1 and §6.2 are
  those three, closed. What that buys is technical independence — another language,
  another author-session, no shared code — and it is what surfaced the
  twenty-five points where this document was not enough, which are now fixed above.
  What it does **not** buy is social independence: same author, same repository,
  same interest in it working. A format with three implementations maintained by
  three parties checking each other has a kind of assurance this one still does not
  have. The step that is taken is the technical one; the step that is not is
  somebody else.
- **A change to the format is visible, and that is all that is promised about
  changing it.** This entry used to say that the per-kind field declarations were
  not published, and that in consequence an implementation built from this
  document could not refuse a newly APPENDED event carrying a field no kind
  declares — the door a party with **no key** could walk through. `event-schema.json`
  and §4.1 closed it, and the same measurement now runs the other way: the second
  reader refuses that event
  (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`). What
  remains true is the sentence above it: there is no standards body, no registry
  and no committed process. What IS committed is that a change to the bytes moves a
  published digest and a change to a contract moves a row of a published file, and
  both are visible.
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

The vectors travel with **this repository**, and so does the second implementation.
They are not in any npm tarball: `@mnema/chain` is an internal package that is never
published, and the one package that is published (`@mnema/code`) ships its compiled
`dist/` only. So the address of both artifacts is a path in the repository, and both
are checked to still be there by a guard rather than assumed: this document's pointer
by `packages/chain/src/format-doc.test.ts`, and the verifier's presence — including
that no `.gitignore` has swallowed it — by
`packages/chain/src/chain/second-reader-is-independent.test.ts`.

# The mnema chain format

This document specifies the bytes, and the rules by which a reader decides which of
them it applies (§6.2, §6.4, §6.7, §6.8). It is written so that **someone who did not
write this code can implement a verifier from it**, run the published vectors
against their implementation, and get the same digests we do.

**Somebody has.** [`verifier/`](./verifier/) beside this file is a second implementation, in
Python, written from this document and importing nothing of the product it checks. It
reproduces the 39 published vectors and the four aggregate digests, and checks the frozen
records in the test suite beside the product
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`), on honest records
and on every input the format refuses. The two verdicts differ in two pinned cases. With the
public keys removed, the product says broken over a signature it cannot verify, and this
reader, unable to ask, says INCOMPLETE. And on a tail cut in the middle, the product
calls the signed range a contradiction and says broken, while
this reader reports a gap it cannot judge, because §3 leaves a reader of this document alone
unable to tell an authorized cut from tampering. On a line holding bytes that are not UTF-8,
found by JSONTestSuite, the two used to part: the product decoded them to U+FFFD and found the
line canonical, while this reader refused it. Both refuse it now, naming the same byte (§4,
`packages/chain/src/chain/outside-vectors.test.ts`). On a record in which no tail holds
anything, the two used to part as well: the product said verified, exit 0, and this reader
said BROKEN, exit 3, or VERIFIED when a tail proof was left. Both refuse it now, by name,
exit 1 (§4). Twenty-seven points
where this document was **not enough** for that were found in the writing.
`python3 verifier/mnema_verify.py gaps` lists them, with which were resolved by reading a
specification, which by experiment against the published bytes, and which are still open.

Everything below is a statement about behaviour, and every one of them **names the
test that holds it**. A claim with no test beside it is an intention, not a
guarantee, and is marked as such. The version tags in this document are read out
of the source by a guard (`packages/chain/src/format-doc.test.ts`), so a bump in
the code reddens this file rather than leaving it describing a format nobody
writes any more. The same guard reads the counts above (the vectors, the aggregate
digests, the points `gaps` lists) off `canonical-vectors.json` and off `gaps` itself,
so a vector or a gap added reddens the sentence that counts them.

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

Under `signedMessages` the file also holds five signed messages: a checkpoint (§6) under each
scheme, a second-scheme checkpoint whose `prev` is the hash of a first-scheme one, and a tail
proof (§6.1) under each scheme, each as its stored line, the message its signature is over and
that message's SHA-256, with the record's name derived from its genesis tail (§6.10). They are
signed by RFC 8032 section 7.1's first test key, whose secret the RFC publishes, so an
implementation checks the bytes it signs and verifies, not only the bytes it hashes. The code
builds them again and requires the file to equal what it builds
(`packages/chain/src/chain/signed-vectors.test.ts`), and the second reader reproduces each and
verifies its signature (`python3 verifier/mnema_verify.py vectors`).

The vectors are **exemplars, not a schema**: one event per kind, plus the cases that
carry a rule of their own: a second `task.created` whose title is written in NFD, three
`task.transitioned` (a birth, a move that carries proof fields, a move the task workflow
allows), and a second `memory.captured` that carries the citation `after` (§4.1), from
which a required field and an optional one that happens to be present look identical. The
schema is the other artifact, `event-schema.json`, described in §4.1.

## 1. Canonicalization: an event becomes bytes

Everything the chain proves is proven over these bytes. The requirement is that
**any** party (the writer now, a verifier in ten years, a clone with no secret)
derives the same bytes from the same event.

The form is JSON, serialized under these rules
(`packages/chain/src/events/canonical.test.ts`):

1. **Object keys are sorted**, recursively, by UTF-16 code unit, after step 3.
   Insertion order never affects the output.
2. **Array order is preserved.** Order in an array is semantic.
3. **Every string (value AND key) is normalized to NFC** before it is
   serialized or sorted.
4. **Strings are escaped by JSON semantics.** Escaped, and **only**: `"` as `\"`,
   `\` as `\\`, and the code points `U+0000` to `U+001F`, using `\b` `\t` `\n`
   `\f` `\r` where a two-character form exists and `\u00xx` in **lower-case** hex
   otherwise. Everything else travels literally in UTF-8: `/` is **not** escaped,
   `U+2028` and `U+2029` are **not** escaped, `U+007F` is **not** escaped, and
   `<`, `>` and `&` are **not** escaped. (It is what `JSON.stringify` produces.
   This used to say only that, and only that is not a rule an implementer outside
   JavaScript can check: they have no `JSON.stringify` to consult. It is also not
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
   compares the rule against `JSON.stringify` itself over every boundary it has). It
   is also RFC 8785's rule, and both readers spell the numbers of its Appendix B and
   the first 10,000 lines of the generator its authors publish a SHA-256 for exactly
   as those do (`packages/chain/src/chain/outside-vectors.test.ts`).

And these values are **refused**, rather than coerced: a value that cannot
round-trip losslessly would let two different facts produce identical bytes:

- `NaN` and `±Infinity` (`JSON.stringify` turns them into `null`), and the JSON
  literals `NaN`, `Infinity` and `-Infinity` on a stored line, which are not JSON
  but which several parsers accept;
- a string containing a **lone surrogate** (not valid Unicode text). Note that
  `JSON.stringify` *does* produce bytes for one (`"\ud800"`) so rule 4 read on
  its own says to emit it and this line says not to. This line wins;
- an **explicit `undefined`** property (drop-or-keep would be an arbitrary
  choice). JSON has no `undefined`, so no stored line can carry one: this refusal
  is reachable only by a party canonicalizing from memory, which is the writer;
- **two keys that normalize to the same string** (the object would be ambiguous),
  and that reaches the **literal duplicate** `{"a":1,"a":2}` as well as the
  NFC collision. It has to be said, because every library JSON parser, including
  Python's `json` and JavaScript's `JSON.parse`, silently keeps the last of two
  identical keys: a reader that lets its parser do that accepts a line this
  format refuses (`packages/chain/src/chain/second-reader-agrees-on-the-bytes.test.ts`); the
  product's own reading of a stored line refuses it too
  (`packages/chain/src/chain/both-readers-read-the-same-bytes.test.ts`).

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
different digests: that is what fields 4 and 5 together are for
(`packages/chain/src/chain/hash.test.ts`).

A tail id is `<signing-key-fingerprint>-<installation-id>`, and the fingerprint
being **a public key the record actually carries** is a requirement rather than a
description of the shape. Without it, the per-entry `link.tail == <directory>`
check only proves that a tail is consistent with a directory name whoever wrote
the repository chose: a tail copied into `tails/<fabricated>/`, relabelled, and
re-chained (which needs no key at all, since the entry hash is keyless) would
have its events counted a second time with everything verifying. A verifier
refuses a tail whose fingerprint prefix is not a committed key
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`), and the
locally chosen suffix is bound by the tail proof below.

An entry hash is also what a CITATION names. The envelope's optional `after` (§4.1)
lists the entry hashes of the heads of other tails that the writer had read when it
wrote, so a reader can place the event after them ("Reading many tails"). It is in
the envelope, and so in the content a checkpoint signs (§5, §6); it is not in the
link, because the link is protected by this hash alone, which takes no key, and a
citation there could be swapped by whoever can write the repository.

Sequence numbers start at 0 and are contiguous within a tail; a verifier that
meets a gap reports it and names where
(`packages/chain/src/chain/waiver.test.ts`, "leaves a PARTIAL cut as loud as it has
always been"), and both readers refuse it, naming the `seq`
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, `reordered-lines`).

**A fork is a break of its own, and both readers name it.** Two different entries
that hold one `seq` and name the same `prev` (or both open the tail, at `seq` 0) are
one tail written from one head in two places and then joined: a checkout copied
whole, a backup restored, each side appending, and a merge that kept both sides. A
reader that meets an entry whose `seq` an earlier entry of the tail already holds,
from the same parent and with another entry hash, reports a **fork** at that `seq`
rather than a gap; a line repeated byte for byte holds no second fact, and is still a
gap. It is refused like every other break, and it changes no byte of this format
(`packages/chain/src/chain/a-tail-is-not-forked.test.ts`; the second reader agrees,
`forked-tail` in `second-reader-agrees-on-the-record.test.ts`). This product's writer
avoids the common way to make one: it keeps, outside the record, the last entry it
wrote to its tail, and when the tail no longer ends there (one checkout switched to
another branch, an installation id copied into another checkout) it writes to a new
tail instead of appending. A copy that carries that note with it cannot be seen by
its writer, which is why the readers name what it leaves.

**A cut has one account in the format, and it is for a WHOLE tail: the waiver.** A
`tail.pruned` (`payload.tail`, `payload.throughHash`, `payload.eventCount`,
`payload.reason`; its `subject` is the anchor the named tail served) is written on
ANOTHER tail, before the cut, while the tail it names is still there. What it claims
is checked against the disk by the writer, which refuses a waiver the named tail
does not bear out (no events there, another head, another count, another anchor)
and one naming the tail it is written to ("the door refuses a waiver the record does
not bear out"); a reader checks its fields as §4.1 declares them and nothing more, because a
moment after the cut nothing on disk can bear the claim out, and refusing the line
would refuse the tail that holds it. What it does, in this product's `verify`: a
committed key with no tail at all, which the census otherwise names with three
possible readings (a merge that dropped it, a machine that never wrote, a removal),
is named with the account instead: who authorized the cut, how many events, through
which head. It moves neither the verdict nor the exit (same file, "a cut tail with a
waiver: the note names the account"). The second reader beside this file does not
read waivers, and names such a key as it names any key with no tail (§6.5). What it
does not do: a waiver about a tail that is still present is never consulted, so it
cures no break on it and covers no `seq` gap in it ("what a waiver does not touch").
It is not permission either: anyone who can write to the record can sign one, and it
names who did. Writing one removes nothing.

**What authorizes a cut of PART of a tail is not specified here**, and no operation
of this product makes one. So a party reading only this document cannot tell such a
cut from tampering, and the honest thing for them to do is report the gap and stop.
That is a hole in this document, not in the format.

## 4. The stored line, and where it is stored

**A tail is a directory, not a file.** This section used to open by calling a tail
"a JSONL file", which is what a reader implementing from this document discovers
is false the moment they open one: a naive `*.jsonl` glob reads the checkpoints as
if they were events. The layout, which only ever appeared here incidentally in §8:

```
<record>/.gitattributes                         "* -text", written by this product's writer; not part of the proof
<record>/.gitignore                             what git leaves out of the tree; not part of the proof
<record>/.editorconfig                          `unset` for every property an outer EditorConfig could impose on these bytes; written by `init`; not part of the proof
<record>/README.md                              written by `init`, for a person or an agent who opens the folder; not part of the proof
<record>/site/                                  the page `mnema site` writes by default; ignored by the tree's .gitignore; not part of the proof
<record>/locks/                                 the lock of each tail while a write holds it (`<tailId>.lock`), the note of which heads a tail last cited (`<tailId>.cited`), the note of the last entry this installation wrote to its tail (`<tailId>.head`) and the projection a reader keeps (`projection.db`, and the files SQLite keeps beside it); ignored by the tree's .gitignore; never read by a reader; deleting it costs a rebuild, one repeated citation or one new tail, never a verdict; not part of the proof
<record>/inherit.json                           the record this one inherits, by its location and one commit (`mnema inherit`); committed; not part of the proof
<record>/keys/<fingerprint>.pub                 the public keys (§6)
<record>/tails/<tailId>/NNNNNN.jsonl            the segments, six digits, in name order
<record>/tails/<tailId>/checkpoints.jsonl       the signed checkpoints (§6)
<record>/tails/<tailId>/tailproof.json          the tail proof (§6.1)
<record>/tails/<tailId>/witness/<hash>.ots      an external attestation (§8)
<record>/tails/<tailId>/witness/<hash>.blocks   its offline sidecar (§8)
```

**A reader enumerates `keys/` and `tails/`, and nothing else at the root.** Every other
entry there, the four files above that say they are not part of the proof, the `locks/` and `site/` folders, `inherit.json`,
or anything a person leaves, is not read, and a verdict is the same with it as without it,
whatever it holds: a file that is not UTF-8, a link to nothing, a directory named `tails` or
`keys` further down
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, "what a person leaves
beside the record, to both readers"). No `kind`, `v` or field comes with such an entry, so
§7.1 has nothing to promise of it: a record without it reads as it always did, and a version
from before it reads a record that has one exactly as this one does, because neither
enumerates the root. The name `private` is not for a person to use there: `<record>/private/`
is the private tree of a project outside a git repository and, inside one, where an earlier
version kept it before it moved into the repository's git directory; the product names one
still there as left behind and, when asked, moves it.

The tail is the concatenation of its segments in name order, and sequence numbers
are contiguous across that concatenation: **which segment a given sequence number
falls in is not specified**, and a verifier should not depend on it. Nothing else
in the tail directory is a segment.

**A tail that holds no event is not counted as a tail.** A tail directory whose
segments hold no line and that holds no checkpoint line (in practice one holding
only its `tailproof.json`, which is what an older writer left when a new key's
first write was refused) asserts nothing. A reader:

- does not count it among the record's tails, and folds nothing from it into what
  it says of the record: not the level, not the external witness (§8), so a record
  every event of which is witnessed stays witnessed beside one;
- still checks what it does hold: its id against the committed keys (§3) and its
  tail proof (§6.1). A failure there is a refusal like any other, and holding
  nothing excuses nothing;
- says it once, as information, and removes nothing. Its directory still names its
  key's tail, so that key is not one "with no tail" (§6.5).

Only a line of no length is no line, the piece after a file's final newline, and,
wherever it falls, the nothing between two newlines in a row: both readers pass over
it. It holds no bytes and moves none that a hash covers, and a writer never leaves
one. A line of whitespace is not canonical (§1.6), so a segment holding one is not
empty; it is read, and refused. The cost, said: a tail
whose segments and checkpoints were deleted with its tail proof kept reads as one
that never held anything. That is no new blindness: the same tail deleted whole,
with its key, beside another tail, already leaves nothing for a reader to cross, and
only a copy of the record from before can testify to either. Where it was the only tail
holding anything, the record is refused, by the rule below.

**A record in which no tail holds anything asserts no fact, and is refused.** When no
tail is counted (there is no `tails/` directory, there is no tail directory in it, or
every tail directory in it holds no event and no checkpoint), a reader refuses the record
by name, whatever level the caller requires of it, and with the same refusal as any other,
not a verdict of its own. It still says what §6.5 says of each committed key with no tail,
so a record whose one tail was deleted says whose key it was. A record is never in this
shape by being founded, because founding writes events and a checkpoint before it returns;
it is in it when every tail was removed, with the keys or without them, or when the
directory was made and nothing public was ever written to it. A record with another tail
that holds something is not this case: one tail removed whole beside it is §6.5's note,
and a reader verifies that record. A path with no directory at it is not a record, and
this rule says nothing of it
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, "a record in which
no tail holds anything, to both readers").

Each line of a segment is the **canonical** serialization (§1) of:

```json
{"event":{…the event as written…},"link":{"hash":"…","prev":"…"|null,"seq":0,"tail":"…"}}
```

The line carries the event **as it was written**, so the bytes on disk are the
bytes the entry hash was taken over; re-serializing an entry read back from a line
reproduces that line byte for byte
(`packages/chain/src/chain/format-on-disk.test.ts`). A line that is NOT that
serialization of the value it holds (a space after a colon, the keys in another
order, its text in another Unicode composition, a letter written as an escape, a
carriage return left by a checkout that rewrote line endings) is refused, even though
its value recomputes every hash and signature: the bytes on disk are then not the
bytes the proof was taken over. The same holds for a checkpoint line and the tail
proof, and both readers refuse each of them
(`packages/chain/src/chain/both-readers-read-the-same-bytes.test.ts`). When a carriage
return at the end is all that differs, both readers say CRLF in the refusal: it is what
git leaves on every line of a checkout with `core.autocrlf=true`. A writer puts a
`.gitattributes` holding `* -text` at the root of a project tree, beside its
`.gitignore`, so git does not rewrite the line ends of a clone; it reaches a clone once
it is committed, and an archive or an editor that rewrites them is not stopped by it.
A stored block
header that is not canonical is not read either, so the attestation it would have
checked is not counted; the product drops that one line and the second reader the
whole sidecar, which is a difference in what is left uncheckable, not in what is
accepted. A genesis link is a `null`
`prev`, never an empty string, and the top-level keys are `event` and `link` with
no insignificant whitespace between them: the same file holds both.

**A key no writer puts there is refused, by name, in every structure this document
signs or chains.** A stored line holds `event` and `link` and nothing else, and its link
holds `hash`, `prev`, `seq` and `tail` and nothing else; a checkpoint line holds its eight
keys (§6) and a tail proof its four (§6.1), and nothing else. None of those extra places
is covered by a hash or a signature: the entry hash takes the event, the tail, the seq and
the prev (§3), and a signature takes the keys its section names. So a key added beside
them, with the line left canonical, leaves every hash and every signature closing; only
the set of keys tells that line from one a writer wrote, and both readers refuse it, with
the keys they found and the keys the structure has, in one sentence: `top-level keys are
['event', 'forged', 'link'], not ['event', 'link']`, `link keys are […], not ['hash',
'prev', 'seq', 'tail']`, `checkpoint keys: missing [], unexpected ['forged']`, `tail-proof
keys are […], not ['scheme', 'sig', 'signerFp', 'tail']`. The keys are checked before the
bytes, so a line that is both re-spelled and carries one is refused for the key. A key in
the event itself is §4.1's. A stored block header (§8) holds `header` and `height`; one
with any other key is not read, as one that is not canonical is not. This rule was
tightened after the first publication (§7.1): no writer of 0.1.0 to 0.1.2 put such a key in
a record, and a version from before it verifies such a record and refuses nothing
(`both-readers-read-the-same-bytes.test.ts`; `second-reader-agrees-on-the-record.test.ts`,
`unknown-key-beside-event-and-link`, `unknown-key-in-a-link`,
`unknown-key-in-a-checkpoint` and `unknown-key-in-the-tail-proof`).

**The shape is checked before the bytes, in one order, so a line broken in two of the ways
named here is refused for the same first cause by both readers.** A stored line: it is an
object (`a stored line that is not a JSON object`), its keys are `event` and `link`, both of
them are objects (`event and link must both be objects`), and its link has its four keys. A checkpoint line or a tail
proof: it is an object, its `scheme` is one the reader knows (`a checkpoint scheme this reader
does not know: 'other'`, and `a tail-proof scheme ...` for §6.1), and then its
keys, because a reader refuses a scheme it does not know rather than guessing at the fields. A
scheme that is a string is named as quoted there, one absent or `null` as `None`, and any other
value by its JSON type alone (`a number`, `a boolean`, `an array`, `an object`). Only then are
the bytes compared with the canonical serialization. The order moves no verdict, since each
check refuses on its own; it decides which one a reader names first
(`both-readers-read-the-same-bytes.test.ts`, "the two readers name the same check first";
`second-reader-agrees-on-the-record.test.ts`, `event-not-an-object-beside-a-key-in-the-link`,
`link-is-a-string`, `checkpoint-of-an-unknown-scheme`, `tail-proof-of-an-unknown-scheme` and
`tail-proof-scheme-not-a-string`).
The type of each value inside a link or a checkpoint is not in this order yet: the second
reader checks it before the bytes and the product after them, in other words, so a line both
re-spelled and holding such a value is named for its bytes by one and for the value by the
other. Nor is the count after the first cause: on a checkpoint line under a scheme it does not know
(`checkpoint-of-an-unknown-scheme`), the product reports three issues, the scheme and a broken `prev` in
each of the two checkpoints after it, where the second reader reports two.

**A stored line is UTF-8, and a line that is not is refused** (§1.6). A reader decodes
the bytes strictly: a sequence that is not well-formed UTF-8 (a lone continuation byte,
an overlong form, a surrogate, a code point past U+10FFFF, a sequence cut short) is not
replaced with U+FFFD and read on, which would hand the parser canonical text the bytes on
disk are not. Both readers refuse the line and name the offset, within the line, of the
first byte that does not begin a character (`not UTF-8 at byte N`); a byte-order mark is
kept as the character it is, so a line that begins with one is not canonical. The same
holds for a checkpoint line, the tail proof and a committed public key, whose bytes hold
no key when they are not UTF-8; a stored block header is ASCII by construction, and one
that is not is not read, as above
(`packages/chain/src/chain/every-reader-refuses-bytes-that-are-not-utf8.test.ts`).

**The one piece both readers forgive is the torn last line.** Every complete append ends in
a newline, so a write a crash interrupted leaves exactly one unterminated piece at the end of
the stream: the end of the tail's LAST segment, or the end of the checkpoints. When that piece
does not read, both readers drop it and say so as a note (`partial-final-line`), and the
verdict is the one the record without it earns. That holds when the crash cut the piece
inside a multi-byte character: those bytes are a torn write, not a line that is not UTF-8.
The same bytes anywhere else (ended by a newline, or at the end of an earlier segment)
are a line, and are refused (same test).

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
declarations were published nowhere: measured, on an independent verifier built
from this document, which read such an event as verified while this product read
it as unreadable. The next section is that hole, closed.

### 4.1 The field declarations

`event-schema.json`, beside this file, is the **second machine-readable half**:
what every kind declares, in the same closed vocabulary the reader applies. It is
not a description of the reader: it is the reader's own table, serialized, and a
guard holds the two byte for byte
(`packages/chain/src/events/event-schema.test.ts`). The vectors are one exemplar
per kind, from which required and optional cannot be told apart; this file is the
schema.

```json
{"schemaVersion":1,"describedBy":"FORMAT.md","rules":{…},"envelope":{…},"transitionFields":{…},
 "contracts":[{"kind":"memory.captured","v":1,"payload":{"content":"string"}}, …],
 "workflows":{"decision.transitioned":{"states":[…],"birth":{…},"moves":[…]}, …}}
```

The `workflows` object is not a field declaration: it says which of the lines a declaration
admits a reader applies, and §6.7 is its normative statement.

- **A contract is selected by `kind` and `v` together**, which is the pair every
  event already carries (§7). A reader looks up the row whose `kind` and `v` both
  match the line, and **refuses a line whose pair no row declares**: a version
  ahead of the table is a contract the reader does not have, not one it may guess
  at. The refusal names the pair and what the reader holds of that kind (§7.1).
  A kind that gains a second version gains a second row; the file's shape does
  not change, which is what makes such a change one visible row in a diff.
- **The top-level keys of an event are the keys of `envelope`, plus `payload`.**
  Six envelope fields are required and three (`which`, `run` and `after`) are
  optional, and an event carrying one of those is an ordinary event rather than an
  anomaly.
- **Every object here is CLOSED.** A key that the matching declaration does not
  name is refused, in the envelope, in the payload, and inside `transitionFields`.
  The reader rebuilds each object from exactly the declared keys and never returns
  the parsed one.
- **A declared field that is optional and absent stays absent** in the rebuild: it
  is never filled in with a default, an empty string or a `null`, because the
  rebuild has to canonicalize to the bytes that were signed.

The `rules` object in the file carries a one-line gloss of each rule name, so the
artifact is readable on its own. This is the normative statement of the same
vocabulary:

| rule | a field under it is |
|---|---|
| `string` | present, and a non-empty string |
| `string?` | absent, or a non-empty string. Absent is not `null` and not `""` |
| `string\|null` | present, and either a non-empty string or an explicit `null`: a VALUED absence (the state a birth transition left behind), which is why it is a spelling of its own and not an optional |
| `boolean` | present, and exactly `true` or `false`. **Nothing is coerced**: `"false"`, `0` and `null` are all falsy in JavaScript and none of them is the position of a switch |
| `count` | present, and a whole number of at least 1 (a safe integer). A float, a `-0` or a `1e3` is refused |
| `fields?` | absent, or the object `transitionFields` declares, closed the same way, and **never empty**: an empty `fields` carries no proof, and admitting it would make `{}` a second, byte-distinct spelling of "no fields" |
| `string[]?` | absent, or a non-empty array of non-empty strings |
| `version` | (envelope only) present, and a whole number of at least 1; with `kind` it selects the contract |
| `kind` | (envelope only) present, and the non-empty string naming the contract |
| `hashes?` | (envelope only) absent, or a non-empty array of entry hashes (§3), 64 lower-case hex characters each, in strictly ascending order. Strictly, because an array's order is part of its canonical bytes (§1): any other order, or a repetition, would be a second spelling of the same set. `after` is the one field under it |
| `instant` | (envelope only) present, and the exact spelling `Date.prototype.toISOString` produces (UTC, millisecond precision, trailing `Z`) of a real date. Every producer stamps `at` through the clock, which IS `toISOString`, so a timezone offset or a missing sub-second digit is a corrupt or forged line rather than a differently-spelled one |

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
message is the canonical bytes (§1) of this object, **the signature field is not
part of it**:

```json
{"contentRoot":"…","fromSeq":0,"prev":"…"|null,"scheme":"mnema-checkpoint/1","signerFp":"…","tail":"…","toSeq":9}
{"contentRoot":"…","fromSeq":0,"prev":"…"|null,"record":"…","scheme":"mnema-checkpoint/2","signerFp":"…","tail":"…","toSeq":9}
```

The second scheme signs one key more, `record`: the name of the record the tail belongs to
(§6.10). Both are read, by every reader, for ever; which one a writer writes is the writer's.

- `contentRoot` is §5 folded over the events of the range, in order.
- `prev` is the SHA-256 of the **previous checkpoint's signed message**, or `null`
  for the first. So checkpoints form their own chain: dropping an earlier one
  while keeping a later one breaks the link.
- `prev` is lower-case hex, like every digest here.
- `signerFp` is the full fingerprint of the signing key, bound into the signed
  bytes so a signature cannot be re-pointed at another key. **The fingerprint is
  the SHA-256 of the key's `SubjectPublicKeyInfo`** (the DER `spki` encoding,
  including the twelve-byte RFC 8410 prefix for `id-Ed25519`) in lower-case hex.
  That sentence is what makes the clause before it *checkable*: a verifier that
  cannot recompute a fingerprint from key material has to trust the filename the
  key arrived under, and then a signature is re-pointed at another key by renaming
  a file. The keys are `<record>/keys/<fingerprint>.pub`, PEM-wrapped
  `SubjectPublicKeyInfo`, and a verifier recomputes the name from the contents
  and refuses a file whose name is not that fingerprint, **whether or not any
  signature of the record is checked under it**: the names are what §6.5 crosses
  with the tails, and a file whose name is not its key is what a rename that
  re-points a signature leaves behind
  (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`,
  `unused-key-misnamed`). A `.pub` there that holds no key is refused the same way, by its
  name and with the reason, because its name stands for no key: one that is not a file,
  one whose bytes are not UTF-8 (§1), and one with no `-----BEGIN PUBLIC KEY-----` block,
  or whose first such block, once its ASCII whitespace is removed, is not strict base64
  (the alphabet and the padding) of the twelve-byte prefix above followed by 32 bytes. Text
  outside the block is no reason to refuse a key
  (`a-key-file-that-holds-no-key-is-refused.test.ts`), and so is one the process may not
  read (reason `it cannot be read`). A name under `keys/` that **starts with `._`** is the
  metadata macOS writes beside a file (AppleDouble), not a key: a reader skips it, whatever
  it holds, exactly as it skips `.DS_Store`, which does not end in `.pub`; every other
  `*.pub` must hold a key.
- The signature is **Ed25519** over those bytes (RFC 8032), hex-encoded, stored as
  `sig` alongside the fields. The checkpoints of a tail live in
  `checkpoints.jsonl`, one canonical line each (the eight keys, `sig` included,
  sorted by §1) in chain order, and a line with any other key is refused (§4).
- **The Ed25519 rule is the strict one**, and it is the same for every signature
  this document names (a checkpoint's, a tail proof's, an enrolment's). With A the
  public key's 32 bytes, R the first 32 bytes of the signature and S the last 32 as a
  little-endian integer, a signature verifies only if:
  1. A and R are **canonical** encodings: the 255-bit `y` is below
     p = 2^255 − 19, and the sign bit is not set where `x` is 0 (`y` = 1 or `y` = p − 1);
  2. neither A nor R is a point of **small order** ([8]P is the identity). With
     rule 1 in force there are eight such encodings, the ones CCTV's
     `ed25519/README.md` lists canonically;
  3. **S < L**, the order of the base point;
  4. **[S]B = R + [k]A**, the equation *without* the cofactor, k being SHA-512(R ‖ A ‖
     message) reduced mod L.

  A point with a small-order *component* that is not itself of small order passes
  rules 1 and 2. This is the rule of ed25519-dalek's `verify_strict`. It has to be
  written down because "Ed25519 (RFC 8032)" is not one rule: over the 1,077
  Ed25519 vectors of Wycheproof, CCTV and ed25519-speccheck, Node 22 and Node 24 up
  to 24.18 accepted 301 and Node 24.19 and later accepted 132 (nodejs/node#64026),
  so a record forged with a small-order key verified under one Node and failed
  under the other. Under this rule all three verifiers of a record (the product,
  which checks rules 1 to 3 itself before `node:crypto`; the second reader in
  `verifier/`; and the page's verifier) give the publishers' verdict on every one
  of those vectors and the five of RFC 8032 §7.1, on every Node the CI runs
  (`packages/code/tests/every-verifier-gives-one-ed25519-verdict.test.ts`). Of
  CCTV's 914, the rule accepts these 43 and refuses the other 871: 7, 29, 50, 117,
  139, 161, 182, 249, 305, 411, 425, 438, 465, 473, 481, 489, 497, 511, 525, 538,
  565, 573, 581, 589, 597, 611, 625, 638, 665, 673, 681, 689, 697, 711, 725, 738,
  765, 773, 781, 789, 797, 832, 899. Of speccheck's twelve it accepts case 3 only.
  The vectors are copied, with their licenses, commits and SHA-256 sums, in
  `packages/chain/conformance/vectors/`
  (`packages/chain/src/chain/outside-vectors.test.ts` checks the sums). No honest
  signature is touched: a key or an R of small order is not what signing produces.
- **Whether the signer was AUTHORIZED is a layer above this one**, and §6.2 is
  that layer. §6 is satisfied by a signature that verifies under the key its
  `signerFp` names; that the key was *valid for its anchor at that point in the
  chain* is a separate question, answered by folding the chain's own enrolment
  facts. This used to say the rule "is not specified in this document", and an
  implementation built from the document alone accepted a signature by any key in
  `keys/` and was right to. It is specified now.
- **Every event in a checkpoint's range names that checkpoint's `signerFp`, and its
  `which`, when present, is not its `who`.** A reader refuses a checkpoint whose
  signature verifies over a range holding an event that breaks either, and does not
  count that range as signature-covered. The checkpoint is the one thing that proves
  which key signed the range; an event's own `signerFp` is a claim inside the bytes it
  signed, and §6.2 folds that claim. Without this sentence the holder of a role key,
  a checker's, writes an event naming the person's key, signs the checkpoint with its
  own, and §6.2 sees the person. `which` and `who` are compared in one canonical form:
  NFC, then with every leading and trailing character of this set removed: U+0009 to
  U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F,
  U+3000 and U+FEFF, so `which` = `who` followed by U+00A0 is refused. The set is
  written out because "trimmed" is not one rule across languages: it is what
  JavaScript's `trim` removes, and Python's `strip()` also removes U+001C to U+001F and
  U+0085. The product applied both halves before this document said them, and the
  second reader verified the record that breaks the first until it did
  (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).
- **A tail belongs to one key (§6.1), and only that key writes to it.** A checkpoint's
  `signerFp`, and the `signerFp` of every event of the tail, is the fingerprint the tail id
  begins with. A reader refuses a checkpoint or an event that names another, as
  `tail-signer-mismatch`, which is not §6.1's `signer-mismatch`: that one is about who signed
  the tail id, this one about who wrote inside the tail. The sentence above binds the events of a
  range to the key that signed it and says nothing about whose tail the range is in, so without
  this one a second key of the record, valid for the anchor, wrote its events into another key's
  tail, signed a checkpoint over them there, and both readers verified the record. The rule is
  over every event of the tail, checkpointed or not: an event above the last checkpoint is bound
  to no checkpoint at all, so the rule refuses one only when it names another key. An event above
  the last checkpoint that names the tail's own key is not refused here, and it still stands as not
  yet signature-covered (§6.2). The writer this document describes names a tail and signs in it with
  one key pair, so no record it wrote breaks this. It is a rule tightened after the first
  publication (§7.1), so a version from before it verifies such a record and refuses nothing
  (`packages/chain/src/chain/a-tail-is-written-by-the-key-its-id-names.test.ts`;
  `second-reader-agrees-on-the-record.test.ts`, `tail-written-by-another-enrolled-key` and
  `event-by-another-enrolled-key-above-the-checkpoint`).
- `scheme` is `mnema-checkpoint/1` or `mnema-checkpoint/2`; a reader refuses a scheme it does
  not know rather than guessing at the fields, before it reads the other keys or the bytes (§4),
  and the signature is over the seven keys above, or the eight of the second scheme, with `sig`
  absent. A line holds exactly the keys of its scheme and `sig`: a first-scheme line carrying
  `record`, or a second-scheme line without it, is refused by its keys
  (`packages/chain/src/chain/format-on-disk.test.ts`).
- `prev` is the SHA-256 of the previous checkpoint's signed message **under that checkpoint's own
  scheme**, so a second-scheme checkpoint links to a first-scheme one before it, and its
  signature, over its own `prev`, covers the tail's history before it (§6.10).

### 6.1 The tail proof

Beside the segments of every tail sits `tailproof.json`: the owner's signature over
its own tail id, made once at birth. It went undocumented until an independent
verifier found a signed artifact in a tail directory that this document had never
mentioned, and had to try five candidate messages to learn what it signs.

```json
{"scheme":"mnema-tail/1","sig":"…","signerFp":"…","tail":"…"}
{"record":"…","scheme":"mnema-tail/2","sig":"…","signerFp":"…","tail":"…"}
```

The signed message is the same shape as §6: the canonical bytes (§1) of the object
with **`sig` removed**, so `{"scheme","signerFp","tail"}` and nothing else, or, under the second
scheme, `{"record","scheme","signerFp","tail"}`, which also names the record the tail belongs to
(§6.10). The
signature is Ed25519 under the key `signerFp` names, which is the fingerprint the
tail id begins with. The file holds the keys of its scheme, `sig` included, and a proof with any
other key is refused (§4).

So a reader takes the key from the **tail id**, recomputes its fingerprint from the
committed material as §6 says, and refuses a proof whose `signerFp` is any other
fingerprint: one another key of the record signed, naming itself, verifies under the
key it names and proves nothing about who owns this tail, and one the tail's own key
signed naming another key says what this section says it cannot. The two readers of
this repository once each accepted one of the two, and both refuse them now, as
`signer-mismatch` (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).

What it is for is the other half of §3's requirement. The fingerprint prefix of a
tail id is a committed key, but the installation-id suffix is chosen locally and
binds to nothing on its own, so a party holding no key could copy a tail whose
events are not yet checkpointed into `tails/<real-fingerprint>-<forged>/` and have
them counted twice. Only the key holder can sign a statement naming a new tail id,
and a genuine proof does not transfer to a different one, because the id **is** the
message (`packages/chain/src/chain/format-on-disk.test.ts`).

### 6.2 Enrolment: which key was authorized, and when

A signature that verifies proves **which key** made it. It does not prove that the
key was allowed to. Those are different claims and the second is the one that
matters, so this section says how a reader gets it from the record and nothing
else. It went unwritten while the kinds that carry it (`key.enrolled` and
`key.revoked`) sat in the published vectors: the bytes of the facts that carry
the authorization were published, and the rule that reads them was not.

**An identity is one ANCHOR with a set of keys**, and the set changes over the
length of the chain. The anchor id is derived from a fingerprint:

```
anchor(fp) = "mnid:" ‖ SHA-256( UTF-8 of the 64-character lower-case fingerprint )   (hex, lower-case)
```

The hash is over the fingerprint's **hex text**, not over the 32 bytes it spells,
the same distinction §5 makes for the accumulator, and the same coin-flip if it is
left unsaid. An anchor is a value distinct from any fingerprint, which is what
leaves room for several keys under one anchor without the anchor ever being one of
them.

**The order the facts are folded in.** Enrolment spans tails (a key enrolled on
one machine authorizes events on another) so the fold runs over **every tail
merged into one order**: within a tail, `seq` order, which the hash chain proves
and which nothing may override; across tails, among the heads whose citations
(`after`) have all been taken, the one with the smallest `at` goes next, a tie going to
the tail id that is smaller as text by UTF-16 code unit. That is the same merge a reader
uses for anything else that has to be deterministic across tails ("Reading many tails",
where the whole tie-break is written out).

So a key's first event follows its enrolment whatever the two machines' clocks said, as
long as it cites the head of the enroller's tail it had read, which is at or after the
enrolment, since it was read after it. This product's writer always cites. An event that
cites nothing is placed by its `at` alone, as every event was before citations existed:
then a second machine whose clock is behind the enroller's stamps its first event before
the enrolment, and the fold refuses an honest record. Both halves are held over drawn
skews, by both readers (`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`,
"R7: over any skew, citing the enrolment is verified by both, and not citing is what `at`
alone says").

A citation of an entry hash the record does not hold is ignored in the order and named
in this product's census, informational; so is an event stamped before an entry it cites,
which is a writer's clock measured from the record alone. Neither is a break (same file,
"a citation of an entry the record does not hold: ignored in the order, said by both";
"the clock that ran behind what it cites is measured and said, informational, by both").

**Three facts change the set**, and each is refused as an operation, not merely
recorded, when its own conditions do not hold. `subject` is always the anchor.

| kind | what it must satisfy | what it does |
|---|---|---|
| `identity.founded` | `signerFp == payload.foundingFp`, `subject == anchor(foundingFp)`, and `who == subject` | adds `foundingFp` to the anchor's set |
| `key.enrolled` | `who == subject`; `signerFp` is in the anchor's set **at this point**; `payload.newFp` is not, at this point, an agent key (below; a retired one included); and `payload.reverseSig` is a valid Ed25519 signature, by the key `payload.newFp` names, over the UTF-8 of `enroll:<anchor>:<newFp>` | adds `newFp` |
| `key.revoked` | `who == subject`; `signerFp` is in the anchor's set at this point | removes `payload.revokedFp`, from this point forward |

The `reverseSig` is the new key's own proof of possession, and it is checked
against `keys/<newFp>.pub` **with that file's fingerprint recomputed** (§6): a
member could otherwise enrol a key it does not hold, or swap the file afterwards
and have someone else's signature verify against it.

**A fourth fact grants a ROLE rather than a membership, and a fifth withdraws it**; two
kinds are judged by the role instead of by the sets above:

| kind | what it must satisfy | what it does |
|---|---|---|
| `checker.enrolled` | `subject == anchor(payload.checkerFp)`; `signerFp` is in the set of `who` at this point; and `payload.reverseSig` is a valid Ed25519 signature, by the key `checkerFp` names (fingerprint recomputed, as above), over the UTF-8 of `check-enroll:<who>:<checkerFp>` | makes `checkerFp` a CHECKER key |
| `checker.retired` | `subject == anchor(payload.checkerFp)`; and `signerFp` is in the set of `who` at this point | when SIGNATURE-COVERED: `checkerFp` is a checker no longer, and is RETIRED |
| `check.passed`, `check.failed` | `signerFp` is a checker key at this point, and `who == anchor(signerFp)` | none |

A checker key signs check results and **nothing else**: an event of any other kind
whose `signerFp` is a checker key at its point in the fold is refused, whatever its
kind, its own `identity.founded` included. A checker joins no identity; it speaks under
the anchor its own key derives, so a reader can tell a machine's result from a person's
act. The consent message is not §6.2's `enroll:` message, so a consent given to join an
identity cannot enrol a checker, nor the reverse.

**A retired key signs nothing.** From its retirement on, an event of any kind whose
`signerFp` is a retired key is refused (a result, and any other kind, its own
`identity.founded` included) and so is a `checker.enrolled` naming it: a retired key does
not come back, a new key is enrolled instead. Who may retire is who may enrol (any
identity, by a key in its set at that point) and the checker key's consent is not asked,
because a leaked key is the case the fact is for. Like a `key.revoked`, a `checker.retired`
takes effect only when it is itself signature-covered: it refuses the key's LATER results,
which are other, possibly checkpointed, events, so honouring one in the window above the
last checkpoint would let a party with no key fail an honest runner's results.

A result the key signed BEFORE its retirement stays authentic: the key held the role when
it signed, and the fold judges every event at its own point. What "before" means is the
merged order above, and across tails that order is the `at` each tail's writer stamped, so
a leaked key can place a result before its own retirement. A reader of this format
therefore learns from the record that the key was retired, and which results it signed
before; this product's `verify` names those in its census, informational, and does not
call them breaks
(`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`).

**A sixth fact grants a key the role of an identity's AGENT, and a seventh withdraws it.** An
agent key is a member of the identity that enrolled it (its facts speak for that identity,
`who`) with a role that narrows what it signs. It is how a person lets a program sign for them
without handing it the key that enrols, revokes and declares.

| kind | what it must satisfy | what it does |
|---|---|---|
| `agent.enrolled` | `who == subject`; `signerFp` is in the anchor's set at this point and is not an agent key; `payload.name` has no leading or trailing character of the set below, and is not `who`; `payload.agentFp` is, at this point, in no identity's set, and is not a checker key, an agent key or a retired key; and `payload.reverseSig` is a valid Ed25519 signature, by the key `agentFp` names (fingerprint recomputed, as above), over the UTF-8 of `agent-enroll:<anchor>:<agentFp>:<name>` | adds `agentFp` to the anchor's set, as an AGENT key named `name` |
| `agent.retired` | `who == subject`; `signerFp` is in the anchor's set at this point and is not an agent key; and `payload.agentFp` is an agent key of this anchor at this point | when SIGNATURE-COVERED: removes `agentFp` from the set; it is RETIRED |

The set is U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F,
U+205F, U+3000 and U+FEFF, the one §6 compares `which` and `who` in. It is written out because
"trimmed" is not one rule across languages. `anchor` is `mnid:` and 64 hex characters and
`agentFp` is 64, so `name` is the last field of the consent message and is taken whole, a colon
in it included; and no consent message is a prefix of another, so a consent given for one role,
one identity or one name enrols the key as no other.

**An event whose `signerFp` is an agent key at its point in the fold is refused when any of these
holds**, whatever else it satisfies:

1. its `who` is not the anchor that enrolled the key;
2. its `which` is absent, or is not, byte for byte, the `name` the key was enrolled under;
3. its kind is one that changes who may sign, or what a key may sign: `identity.founded`,
   `key.enrolled`, `key.revoked`, `backup.declared`, `checker.enrolled`, `checker.retired`,
   `agent.enrolled`, `agent.retired`, `account.linked`. (A `check.passed` or `check.failed`
   already needs a checker key.)

This is judged at the event's point in the merged order, after the two tests above (a retired
key, a checker key) and before the conditions of the event's own kind, against the agent keys as
every earlier event in that order left them. A key is an agent key from its `agent.enrolled` on,
and stays one: a `key.revoked` naming it takes it out of the set like any key, and the role stays
with it, so no later fact turns it into a key without the role. An `agent.enrolled` that would
restore a key some covered `key.revoked` removed is gated as any such addition is.

**A key holds one role.** An `agent.enrolled` naming a key that is already in an identity is
refused (the table above), and so is the other order: a `key.enrolled` naming a key that is, at
that point, an agent key of any identity, retired or not, whichever identity vouches for it. A
key taken in as a plain member would sign as one, without the three limits above. The
conditions of `key.enrolled` are checked in the order its row writes them, so a `key.enrolled`
by a voucher not valid at that point is refused for that first. This rule was tightened after
the first publication (§7.1): no writer of 0.1.0 to 0.1.2 wrote such a `key.enrolled`, and a
version from before it verifies such a record and refuses nothing
(`second-reader-agrees-on-enrolment.test.ts`, "a key.enrolled naming the agent key of its own
identity"; `second-reader-agrees-on-the-record.test.ts`, `key-enrolled-names-an-agent-key`).
It holds inside ONE record: a record that never heard of the `agent.enrolled` can still enrol
the key as a member ("What this document does not promise").

**A retired agent key signs nothing**, exactly as a retired checker key: from its retirement on,
an event of any kind it signs is refused, and so is an `agent.enrolled` or a `checker.enrolled`
naming it. Like a revocation, an `agent.retired` takes effect only when signature-covered, so a
party with no key cannot retire an honest agent. Only the identity that enrolled the key retires
it, by a key of its own that is not an agent key, so a leaked agent key cannot retire its
siblings, nor be used to retire itself out of the record's sight.

What the key signed BEFORE its retirement stays authentic, for the reason a checker's results do,
and "before" is the same merged order and the same `at` the key itself wrote: a leaked agent key
can place a fact before its own retirement. A reader therefore learns from the record that the key
was retired, and how many facts it signed before; this product's `verify` names those in its
census, as it names a retired checker's, informational, and the second reader says the same count.

**What a reader learns from it.** An event signed by an agent key that the fold accepts names, in
`which`, the name its identity enrolled that key under: its agent is ATTESTED by an agent key
enrolled as that name. Any other `which` is DECLARED: the key that signed stated it. Which process
held the agent key, and which model drove it, is a property of the machine (its sandbox, its
users) that the record does not carry. This product's `verify` counts both in its census,
informational, and the second reader says the same counts
(`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`, "an agent").

**And every other event is authentic only if its `signerFp` is in the set of its
own `who` at its point in the fold.** That is the whole rule; there is no
"the anchor is my own key" shortcut. A lone key still founds its anchor, so one
key is a one-member set.

**Some of these facts take effect only when they are themselves SIGNATURE-COVERED**,
and this is the part a reader gets wrong by omission rather than by error. A
`key.revoked`, a `checker.retired`, an `agent.retired` and a `backup.declared` (§6.5)
always; an `identity.founded`, a `key.enrolled` and an `agent.enrolled` only when it
would restore a key a covered `key.revoked` removed. The two bullets below give the
reason for each half; the rows of `checker.retired`, `agent.retired` and
`backup.declared` say the same of each. Both readers gate these seven kinds in the
fold (`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`: "a
residual re-enrolment does NOT undo a covered revocation: refused by both", "a
retirement in the window no checkpoint covers: ignored by both", "a declaration no
checkpoint covers: ignored by both, and the key still warns"). An
event above the last checkpoint of its tail rests on the hash chain alone, and the
entry hash takes no key, so a party with no key at all can append there.

- A `key.revoked` in that window is **ignored**. A revocation removes a key that
  judges OTHER, already-checkpointed events, so honouring an uncovered one would
  let a keyless party fabricate a tail, revoke a member from it, and flip an
  honest fully-signed chain to failing, a denial of authenticity with no key. A
  legitimate revoker checkpoints the revocation; a keyless party cannot, because a
  checkpoint needs the tail's private key.
- An `identity.founded` or `key.enrolled` that would **restore a key some covered
  `key.revoked` removed** is ignored in that window too, and for the mirror
  reason: it would undo a signed removal and re-authorize that key's later,
  checkpointed work. A first enrolment, or any addition that restores nothing
  covered, is not gated: it only ever empowers events naming the added key, and
  those sit in the same untrusted window anyway.

"Covered" means: the event's own `seq` is at or below the highest `seq` reached by
a checkpoint of its tail whose signature verified.

**What this does NOT decide**, said here because it looks like it should: whether
the tail an event sits in is genuine. A keyless party who fabricates a tail under
a real enrolled fingerprint names a valid signer and passes this fold, and is
refused earlier, by §3's requirement on the tail id and by §6.1's tail proof. The
fold only ever runs over tails whose key owns them
(`packages/chain/src/chain/enrollment.test.ts`,
`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`).

### 6.3 An account an identity names

`account.linked` (`payload.service`, `payload.account`) is an identity saying which account
it holds; this product writes two services: `github`, an account on the code host, and
`sigstore`, the identity a Sigstore certificate names (an e-mail address, or a GitHub Actions
workflow as `https://github.com/<owner>/<repo>/.github/workflows/<file>@<ref>`). A `sigstore`
link to an e-mail address carries **`sha256:` and the lower-case hex SHA-256 of the address**,
trimmed and in lower case, never the address: the record is append-only and cloned, and the
address is a person's; a workflow is carried as it is. A reader compares a certificate's address
by computing the same value (`sigstoreAccountOf`, `packages/core/src/identity/account.ts`). The
value is a string like any other: neither the canonical form, the chaining nor the signature of
the event treats it differently. It is **not part of
the fold above**: it adds and removes no key, so a reader authenticates it by the rule every
other event is authenticated by, and by nothing else. Its `subject` is the anchor and its `who`
is the same anchor: an identity names only its own account.

A verification of the format does not read it. It is read by two readings that have to be
asked for: `mnema verify --against-github` (a `github` link) and `mnema verify
--against-sigstore` (a `sigstore` link, §8.1). Each honours a link only when its `who` is its
`subject` and it is SIGNATURE-COVERED (§6.2's meaning): one in the keyless window above the
last checkpoint could be appended by somebody holding no key, naming an account on which they
had published this identity's public key, or an e-mail of their own
(`packages/code/src/commands/verify-github.test.ts`,
`packages/code/src/sigstore/sigstore.test.ts`).

### 6.4 A note taken back

`note.retracted` (`payload.reason`) takes back the memory (`memory.captured`) or observation
(`observation.recorded`) its `subject` names. Like §6.3's link it is **not part of the fold**
and is authenticated by the rule every other event is. Nothing about its bytes, its chaining
or its signature differs from any other kind; what this section adds is who it speaks for.

**Only the identity that wrote a note takes it back: a retraction applies when its `who` is the
`who` of the note it names.** The comparison is on the anchor, not the key, so any key in that
anchor's set (a second machine enrolled into the identity, a cold backup restored) retracts,
and a key of another identity does not. Of the retractions of one note that apply, the first in
the merged order of §6.2 holds. A retraction whose `who` is not the note's is not applied: a
reader keeps serving the note. It is **not a break**: the event is intact and its key speaks
for its own `who`; what it lacks is authority over somebody else's note, so this product's
`verify` names it in its census, informational, and the exit is unchanged. A retraction of a
note the tree does not hold has no author to compare with, and is neither applied nor named
(`packages/core/src/knowledge/only-the-identity-that-wrote-a-note-retracts-it.test.ts`).

**A note is the identity that wrote it first.** The `who` of a note, the one every comparison
above is made with, is the `who` of the FIRST `memory.captured` or `observation.recorded` of its
id in the merged order of §6.2, of either kind, since one id names one note. This product's
writer mints a note's id at its capture, so it never writes one id twice; a record that holds a
second writing of an id holds one made past it. A later writing by the same identity (any key of
its anchor) is served in place of the earlier one. A writing by another identity is not applied:
the note's content, author and capture time stay the first writer's, and a retraction that
identity signs is a stranger's, as above. Like a stranger's retraction it is **not a break**,
and this product's `verify` names it in its census, informational, with the exit unchanged
("a note is the identity that first wrote it", in the test file above). The first writing and
not the last, because the last is whichever writing the latest `at` stamped, and `at` is the
signer's to write: a key of any identity would take a note, its content and its retraction by
stamping a later clock. Nor the order of the tail ids, which begin with a key's fingerprint and
are a signer's to choose. The merged order is what this product's writer cannot be made to lose:
it cites the heads it had read (`after`), and a writing that cites the note comes after it
whatever its clock says. What no order can settle is two writings no citation relates: there
the earlier `at` is taken, which a hand-made writing can backdate; the reader then serves that
one, and the census names the other, so the contest is shown whichever writing was taken. A
binary from before this rule served the last writing in the merged order, and its `verify` took the
author from the last writing in tail-id order, so the two could disagree.

**A link is taken back the same way.** `link.retracted` (`payload.target`, `payload.rel`,
`payload.reason`) names the edge a `knowledge.linked` asserted. A link has no id of its own, so
the retraction names it as the link did: its `subject` is the link's subject, and `target` and
`rel` are the link's, byte for byte. It is a new kind; no existing kind, field or byte changes.

A reader folds the links in the merged order of §6.2 into the set of ASSERTIONS that stand, one
per (subject, target, rel, `who`). A `knowledge.linked` makes its `who`'s assertion of the edge
stand; a `link.retracted` withdraws, at its point in that order, the standing assertion of the
edge it names whose `who` is its own `who`: the same comparison as a note's, on the anchor, so
any key of the identity that linked takes the link back. An edge is served while any assertion
of it stands, and its origin is the first that does; an edge whose only asserter took it back is
applied by nothing, so a rule it addressed at a path stops acting there (a reading of the
history of what names what may still show the link, saying it was taken back). A later
`knowledge.linked` of the same edge by the same identity stands again. A retraction whose `who`
asserted the edge nowhere in the tree, while another identity did, is not applied, is **not a
break**, and is named in this product's census for the reason a stranger's note retraction is.
A retraction of an edge the tree does not hold at all is neither applied nor named
(`packages/core/src/knowledge/only-the-identity-that-linked-retracts-it.test.ts`).

A verification of the format does not need either rule (they decide what a reader SERVES, not
what verifies) and neither moves a verdict in either reader. The second reader beside this file
names a retraction neither rule applies, and a writing of a note by an identity that did not
write it first, as this product's `verify` does, and accepts the record
(`packages/chain/src/chain/second-reader-agrees-on-what-is-not-applied.test.ts`, "by another
identity, names both" and "written again and taken back by another identity"). A binary from before the note rule
applied every note retraction, whoever signed it; a binary from before `link.retracted` refuses
it as a (kind, v) its table does not hold (§4.1), so a record holding one does not verify there.

### 6.5 A key kept as a backup

A key's fingerprint is the id of the tail it writes (§3), so `keys/` is a roster of the tails
that should exist, and a reader can cross the two. A committed key with no tail has innocent
readings (a machine that never wrote, a merge that dropped a tail) and a guilty one: a tail
removed to hide its events. One key has no tail by design: the cold backup an identity keeps
off the machine, which signs nothing until it is restored. Without a fact saying which key that
is, every honest record warned about it on every clone, and a warning that is always on is one a
reader learns to skip.

`backup.declared` (`payload.backupFp`) is that fact. It is **not part of the fold of §6.2**: it
adds and removes no key and makes no event authentic or not. It is judged at its point in the
merged order of §6.2, and refused (as a `key.enrolled` would be) when any condition fails:

| kind | what it must satisfy | what it does |
|---|---|---|
| `backup.declared` | `who == subject`; `signerFp` is in the anchor's set at this point; and `payload.backupFp` is in the anchor's set at this point | when SIGNATURE-COVERED: `backupFp` is the anchor's declared backup |

An identity declares only its own keys: a declaration naming a key another identity holds, or a
key never enrolled, is refused, not ignored, because it is a signed claim about somebody else's
roster. **It takes effect only when it is signature-covered** (§6.2's meaning), for the
revocation's reason mirrored: a party with no key can append above the last checkpoint, and an
uncovered declaration would let it silence the warning about a tail it removed.

**How a reader uses it.** For each committed key whose fingerprint names no tail: if a covered
`backup.declared` names it, and the key is still in that anchor's set at the end of the fold (a
backup revoked since is not), the absence is expected and is said as a backup's. Any other key
with no tail is said as one whose tail may have gone; a key declared a backup and revoked since
is said so, as declared and revoked, rather than as a key the record declares no backup for. Both are notes, never a refusal: an
absence is not something a reader can prove was tampering. They still run, and still say the
same, when no tail of the record holds anything: that record is refused by §4, and these notes
are said beside the refusal, so each committed key with no tail is still named
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, "both readers still
name every committed key with no tail"). A record written before this kind
existed carries no declaration, so its backup reads as any other key with no tail; this
product's `verify` still says it as a backup on the machine that made it, from that machine's
own registration, and the words of the note say why elsewhere. A binary from before this kind
refuses to read a record that holds one, as it does any kind it does not know (§4.1)
(`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`,
`packages/code/src/commands/verify.test.ts`).

What it does not answer: a backup that WAS restored and signed would have a tail of its own, so
a declared backup with no tail is also what a restored backup whose tail was removed looks like.
The note says so.

### 6.6 A stack adopted, and removed

A stack is a directory of skills and agent definitions identified by its **digest**: the SHA-256
of one line per file, `path NUL sha256(file) LF`, in byte order of the path. `@mnema/stacks`
publishes the rule and a shell reproducer. Two kinds say which stacks govern the work in a tree:

| kind | subject | payload |
|---|---|---|
| `stack.adopted` | the name the stack is installed under | `name`, `version`, `digest`, `scope` |
| `stack.removed` | the same name | `version`, `digest`, `scope`, the adoption's own |

`name` is the name the stack declares. The subject differs from it only when the person renamed the
stack to settle a collision. `version` is the author's label and is not the identity; `digest` is
the identity. `scope` names the tree the fact is written in: `public` (the project, shared:
committed and cloned), `private` (the project, this person's only), or `global` (every project of
this person). A stack installed into a folder of its own governs nothing and records no fact.
Nothing about their bytes, their chaining or their signature differs from any other kind, and they
are **not part of the fold of §6.2**.

**Neither carries a path, a source address or a credential, by construction.** The payload is
closed (§4.1), so a field like `source` is refused by the readers. This product's write door admits
only closed forms and refuses anything else before appending:

- the subject and `name` are the stack-name form: lower-case ASCII letters, digits and single
  hyphens, at most 64;
- `digest` is 64 lower-case hex characters;
- `scope` is one of the three words above;
- `version` uses ASCII letters, digits, `.`, `+` and `-`, starts with a letter or a digit, and is at
  most 64 long. It is screened for a credential first, because a key id fits those characters.

None of these forms can hold a separator, `~`, `:` or `@`. A removal copies its version, digest
and scope from the adoption standing under its subject in the same tree, and is refused when none
stands. The writer appends either fact and signs a checkpoint over it in one hold of the tail's
lock, so each is covered by a signature as soon as it lands
(`packages/core/src/workflow/stack-operations.test.ts`).

These forms are the WRITE side's. A reader of the format applies §4.1 alone: a `stack.adopted`
whose fields are non-empty strings is a valid line whatever they hold, as a line of any kind is.
Which adoption stands, and whether the files on a disk still hash to its digest, is a reading of
this product, not a verification of the format. The second reader beside this file accepts both
kinds by their rows of `event-schema.json`, with no code of its own for them. A binary from before
these kinds refuses them as a (kind, v) its table does not hold (§4.1), so a record holding one
does not verify there
(`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`).

### 6.7 A move of a workflow

Four kinds move a subject through a workflow: `decision.transitioned`, `task.transitioned` and
`skill.transitioned`, each through the table the `workflows` object of `event-schema.json`
holds under its kind, and `run.ended`, which closes a run. Nothing about their bytes, their
chaining or their signature differs from any other kind, and they are **not part of the fold of
§6.2**. What this section adds is which of them a reader applies.

A table has the workflow's `states`, its `birth` and its `moves`. Each move is a row: a `from`
state, an `action`, the `to` state it reaches, the proof fields it `requires` (names of
`transitionFields`, §4.1), and, on the two rows of the decision workflow whose action is
`supersede`, `"by": true`. In summary, and normatively in the file:

| kind | birth | moves |
|---|---|---|
| `decision.transitioned` | `null → proposed` by `create` | `proposed → accepted` by `accept`, `proposed → rejected` by `reject` (each requires `note`); `proposed → superseded` and `accepted → superseded` by `supersede` (requires `reason`, names `by`) |
| `task.transitioned` | `null → DRAFT` by `create` | twelve rows, with cycles: `IN_PROGRESS` to `BLOCKED` by `block` and back by `unblock`, to `IN_REVIEW` by `submit_review` and back by `request_changes`, to `DONE` by `complete` and back by `reopen`; the one workflow with cycles |
| `skill.transitioned` | `null → proposed` by `create` | `review`, `adopt`, `reject` (each requires `note`) and `adopted → deprecated` by `deprecate` (requires `reason`) |

**A reader judges every move at its point in the merged order** of "Reading many tails", and
applies it only when it is legal:

- **A birth** (`from: null`) is legal when its `action` and `to` are the table's `birth`, and the
  subject has no state yet. A second birth of a subject is not applied.
- **Any other move** is legal when the subject has a state at that point (a birth before it);
  `(from, action)` is a row and `to` is that row's `to`, so a state that is not one of the table's
  is never reached; every field the row `requires` is present in `fields`; the row with `"by":
  true` names in `by` a decision whose birth the record holds and that is not its own subject,
  and no other row carries a `by`; and **`from` is the state the subject is in at that point, or
  the state its writer saw**, or, when what its writer saw holds nothing of the subject, a state
  the subject had been in before that point.
- **`run.ended`** is legal when the run has a `run.started` before it and no `run.ended` applied
  before it, or when the run was open in what its writer saw.

**The state at a point** is the `to` of the last move applied before it, in the merged order,
so a move that is not applied moves nothing after it either. **The state its writer saw** is
the same fold over only the moves its writer had read: the entries of its own tail before it,
and, on every other tail, the entries up to the last one its own tail cites in `after` at or
before it. A citation of a hash the record does not hold reads as nothing seen, as it is
nothing ordered. The first of the two is what reads a record whose writers cited nothing as it
was written; the second is what keeps two machines that moved one subject without seeing each
other a divergence and not an illegal move ("What is detected", in "Reading many tails"). A
writer whose own tail holds nothing of the subject before the move, and that cites nothing of it,
did not say what it read, and the bytes cannot say it for it: it is held to a state the subject
had been in before that point (the `to` of a move applied before it, the birth's among them)
so two such machines that moved one subject out of one state are a divergence too, and a move
out of a state the subject never reached is still not applied.

**The rule a move broke** is one of seven, named in the census and the same in both readers:
`not-born` (a move of a subject with no birth before it, or the end of a run with no start before
it); `born-twice` (a birth of a subject already born); `not-in-the-table` (a birth that is not the
table's `birth`, or a `(from, action)` that is no row of it, or a `to` that is not that row's);
`proof-missing` (a field the row requires is absent); `successor` (a `by` where the row takes none,
none where it takes one, the move's own subject, or a decision the record holds no birth of);
`not-the-state-seen` (`from` is neither the state at that point nor the one its writer saw); and
`ended-twice` (the end of a run after an end its writer had seen). A birth that carries a `by` is
`successor`, since the birth row takes none. A `run.started` of a run already started changes
nothing and is not named: the first start stays, and the ends are judged against it.

**A move that is not legal is not applied, and it is not a break.** A reader reads the subject
as if the move had not been written (its state, the moves it says it made, the divergences)
and this product's `verify` names the move in its census, with the rule it broke, informational,
the exit unchanged: the precedent of a stranger's retraction (§6.4). The event is intact,
hashed, chained and signed by a key of its own `who`; what it lacks is a place in the workflow,
which is a reading of the record rather than a fact about its bytes
(`packages/chain/src/events/workflow.test.ts`; `packages/chain/src/chain/moves.test.ts`;
`packages/chain/src/chain/the-census-names-a-move-the-workflow-does-not-allow.test.ts`;
`packages/core/src/projections/a-move-the-workflow-does-not-allow-is-not-applied.test.ts`).

**A record this section reads differently from before it.** The product's writer judges a move
by the same table before it appends, so a record it wrote holds no move this section refuses,
with two exceptions it could write before it judged the chain and cited what it read. Two moves
out of one state on one tail (two writes that raced before the tail had a lock, or a projection
edited on the disk) are one move and a second one its writer had seen leave that state: the
second is not applied, and is named. And a machine that cited nothing (every record before
citations) and moved a subject its own tail had moved before is judged by the state the subject
is in at its point of the merged order, or by its own tail's: a clock behind what it had read, or
a move concurrent with another machine's out of a state its own tail had seen it leave, puts it
among the moves not applied. Both are named, and neither changes a verdict.

**A subject is one workflow's.** The state at a point and the state a writer saw are folded per
kind and subject: a decision and a task that carry one `subject` are two subjects, and a run's end
is judged against its own `run.started`. A `by` names a decision, so the births it is checked
against are the decision workflow's.

**Both readers judge.** The second reader beside this file reads the tables from the `workflows`
of `event-schema.json`, never from a copy of its own, judges every move by the rules above, and
names the moves it does not apply with the same rule at the same tail and `seq` as this product's
census, the verdict unchanged
(`packages/chain/src/chain/second-reader-agrees-on-what-is-not-applied.test.ts`, over one record
per rule, two machines with and without citations, and drawn records on two tails).

**A binary from before this section** (this product's, or the second reader's) applies every
move, whatever its `from`, `action` and `to`, and names none: a record holding a move this section
does not apply verifies there as it verifies here, and is read there as if the move were legal.
That binary does not refuse it, and nothing in the record can make it: the move is a kind and a
version it already reads (§4.1). This section tightened rules inside kinds and versions that
already existed, before the first publication; §7.1 says why the promise between versions starts
after it.

### 6.8 A decision recorded again

`decision.recorded` (`payload.title`, `payload.rationale`, `payload.adr`, and
`payload.alternatives` when it says what was turned down) is the text of the decision its
`subject` names. Nothing about its bytes, its chaining or its signature differs from any other
kind, and it is **not part of the fold of §6.2**. What this section adds is which of several
writings of one `subject` a reader applies.

**A decision is the text its first judgment was made on.** A JUDGMENT of a decision is a move
of it after its birth (§6.7: an accept, a rejection, a supersede), and its writer was shown a
text when it made it. Of every `decision.recorded` of one `subject`, the text is the FIRST in the
merged order of §6.2 among those the writer of the decision's first APPLIED judgment had read:
by the sight §6.7 judges a move with, the writings its own tail holds before it and, on every
other tail, those up to the last entry its tail cites at or before it. While nothing has judged
the decision, and when the writer of its first judgment had read none of its writings (a record
written before citations, a writer that cited nothing), the text is the FIRST writing in the
merged order. Its title, rationale, alternatives and label are the decision's, its `who` is who
recorded it and its `at` when. Every other writing is not applied, **whoever signed it**:
another identity, and the identity that wrote the text with any key of it. A move §6.7 does not
apply judges nothing, so it binds no text. The moves of the decision are judged and applied as
they are with one writing. A reader serves the text, and this product's `verify` names every
other writing in its census, with the rule `decision-rewrite`, informational, the exit
unchanged: like a stranger's writing of a note (§6.4) it is **not a break**, since the event is
intact and its key speaks for its own `who`; what it lacks is a place in a decision that was
already written
(`packages/core/src/projections/a-decision-is-the-text-its-first-judgment-saw.test.ts`,
`packages/chain/src/chain/decision-text.test.ts`).

**Why the judgment binds the text.** An accept is a person's word on what they read, and what
they had read is in the bytes: its own tail, and the heads its tail cites, which this product's
writer cites at every append ("Reading many tails"). A writing dated back on a tail the judgment
never cited, appended after it or on a clone its writer had not pulled, is first in the merged
order whatever it says, because `at` is the signer's to write; it is not what was accepted, and
it is named, never served ("serves the text accepted, and names the writing dated back from an
older tail after the accept"). For a judgment made by this version, a writing the judge had read IS what it was shown, since every
reader of this version serves the first writing in the order while nothing has judged the decision,
so the judgment holds for it, and the later honest writing is the one named ("serves the text the accept
was shown, when its writer had read the writing dated back"). The text is bound at the FIRST
judgment and never moved after it: a later move, a supersede included, is made on a decision that
already has a text, so nothing appended after the accept, by any key, changes what was accepted.
An accept made by a binary from before this section may have been shown the LAST writing, which is
what that binary served: if a writing dated back that it read precedes the honest one, this
version serves the dated back writing and names the honest one.

**Stricter than a note, and why.** A note served its author's later writing in place of the
earlier one (§6.4). A decision does not, because no honest writer writes one twice: this
product's writer mints a decision's id when it records it, and changing one's mind about a
decision is a new decision that supersedes it, never a new text under the old id. So every second
writing of a `subject` was made past the writer, by hand, and a rule that let its author's own
key replace the text would let a key that is that identity's, or a cold backup of it, change what
a person accepted after they accepted it. The first and not the last, for the reason §6.4 gives:
the last is whichever writing the latest `at` stamped, and `at` is the signer's to write.

**A second writing in the same bytes is named too.** A writing whose payload repeats the text's
changes nothing a reader serves, and it is named all the same: the product's writer never
appends it (a response lost and asked for again records a new id, not the same one), so it was
made past the writer as well, and a rule that kept it silent would have to say which bytes count
as the same, in both readers, for a case that only a hand-made line reaches. Naming it costs a
census line and hides nothing.

**What no order can settle.** Before any judgment, two writings no citation relates are ordered
by `at`, which a hand-made writing can backdate to come first: a pending decision shows that one
and names the other, so the contest is shown whichever writing was taken, and whoever judges it
next is shown the text the judgment then holds to. A judgment whose writer cited nothing is held
to the first writing on its own tail, and one with none there to the first in the order. And a
key that may judge the decision can judge it FIRST, with a move of its own dated before the
accept on a tail the accept did not read, on the text it wrote: the decision is then judged by
that move, on that text, and the accept that did not see it is a second move out of the same
state, named as a divergence of the two ("What is detected", under "Reading many tails"). No
rule over these bytes tells that apart from two people judging at once; the record names it.

**Both readers judge.** The second reader beside this file names every writing that is not the
text with the same rule at the same tail and `seq` as this product's census, the verdict
unchanged, over records written by hand and over drawn records with clocks that disagree and
citations that come and go
(`packages/chain/src/chain/second-reader-agrees-on-what-is-not-applied.test.ts`, "a decision
recorded again", "a decision is the text its first judgment saw", and "drawn records on two
machines"). A reader that keeps a cache serves what a replay serves: a cache brought forward over
the first judgment of a decision written more than once reads the record again
(`packages/core/src/projections/many-tails.properties.test.ts`, "X reads as the writing its
first judgment saw"). **A binary from before this section** applies every writing in the merged
order, so it serves the LAST one, and names none (an accept made there may have seen the last
writing: if a writing dated back that it read precedes the honest one, this version serves the
dated back one and names the honest one): a record holding a second writing verifies
there as here and is read there with the later text. This section tightened a rule inside a kind
and version that already existed, after the first publication: §7.1 says what that promise
covers, and it does not cover this (a rule tightened is allowed; the two binaries read the same
bytes two ways, and the earlier one refuses nothing).

### 6.9 A run whose agent was announced by nobody

`which` is a name the writer states (§6.2, "What a reader learns from it"). Over MCP this product's
writer states the name the client announced in its handshake (`clientInfo.name`), and where the
client announced no usable one it states a default, `unknown-agent`: a client that never sent
`initialize`, as a revision of the protocol allows, and one whose handshake named nobody (no name,
a blank one, or one §6 cannot compare). Before this section the record said nothing more, so the
default read as a name a client had announced, and a client that announced the word
`unknown-agent` read as one that announced nothing.

`run.unannounced` (`payload.handshake`, a boolean) is the writer saying so. Its `subject` is a run,
and it carries no `run`, as the run's own birth carries none; this product's writer appends it in the same append as that run's
`run.started`, and only when the run's agent is that default: never for a name a client announced,
whatever it is, and never where an agent key signs (§6.2), since its `which` is then the name the
record enrolled it under. `handshake` is `true` when a handshake ran and named nobody, and `false`
when none ran. Nothing about its bytes, its chaining or its signature differs from any other kind,
and it is not part of the fold of §6.2: its signer is held to its `who` like any event's.

**What it marks.** A `run.unannounced` marks the run its `subject` names, **for the key that signed
it and for no other**, and only where a `run.started` signed by that same key, with that same
`subject`, is in the record: a mark naming a run that no `run.started` of its key opened marks
nothing, the run another key opened under that id included, and its own facts are then declared
like any other. A fact belongs to a marked run when that same key signed it and its `run` is the
run, or it is a `run.*` fact whose `subject` is the run and which carries no `run`: its
`run.started`, its `run.unannounced` and its `run.ended`. Keyed by the signer, so a key cannot say
of another key's facts that their agent was announced by nobody. Any mark marks: two marks of one
run by its key mark it once, and where their `handshake` disagree (one `true`, one `false`) the run
is marked all the same, every mark counted as one of its facts; `handshake` decides nothing a
reader counts: the record holds both statements, and no reading of this product takes either as
the run's. A reader
counts the facts of a marked run that a key without the agent role signed apart from the other
declared names: this product's `verify` names them in its census as `unannounced-which`, one note
per `which`, informational, the exit unchanged, and the second reader says the same counts under
this section's number
(`packages/chain/src/chain/second-reader-agrees-on-enrolment.test.ts`, "a run marked
run.unannounced" and "a mark its key opened no run for marks nothing"). The product's other readings say it beside the name: `mnema show`, the opening
document, `audit_accountability` and the record page
(`packages/code/tests/a-client-that-never-initializes.test.ts`).

**What it does not say.** It is the writer's statement, as `which` is: it proves nothing about
which program connected, and a writer may leave it out. A run with no mark makes no claim either
way, and every run written before this kind existed has none: an `unknown-agent` there may be the
default or a name a client announced, and no reader can tell. **A binary from before this kind**
refuses a record that holds one by naming the kind (§7.1): its `verify` fails, the whole tail
that holds the mark unreadable to it, and every reading of it that needs that tail fails with it.
It reads every record that holds none: a client that announces a usable name in its handshake
writes no new bytes.

### 6.10 The record a tail belongs to

One person signs every record they write in with one key, and the public keys travel with the
record. So a signature made for one record verified in any other holding the key: a tail of
record A, copied with its key into record B, read as that person's acts in B. The second schemes
of §6 and §6.1 name the record, so that **a signature made for one record does not count in
another**.

```
record       = SHA-256( frame("mnema.record.v1") ‖ frame(UTF-8 of the genesis tail id) )   (§2, hex)
genesis tail = the tail whose first entry (seq 0) carries the smallest `at`, compared as text;
               a tie goes to the smaller tail id, compared as text by UTF-16 code unit
```

The name is derived and never drawn: a new record names itself from its own tail, and two
machines that never saw each other derive the same name from the tail every clone of the record
holds. It is carried only in what is signed, the tail proof and the checkpoint under their second
schemes; no file and no event carries it. A reader never recomputes it as an authority: it checks
that the tails agree, and names, as information, the genesis tail when one of the record's tails
hashes to the name (`packages/chain/src/chain/record-name.test.ts`).

A tail **names** a record by its second-scheme tail proof, when that proof verifies, and
otherwise by its latest second-scheme checkpoint whose signature, root and binding verify (§6). A
checkpoint that failed names nothing, and a tail that holds nothing (§4) counts toward no name.
A tail born before records were named is bound to one by its owner's first second-scheme
checkpoint, whose `prev` covers the history before it.

Both readers refuse, by the same names (`packages/chain/src/chain/a-tail-of-another-record-is-refused.test.ts`,
`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`):

- **`record-mismatch`**: two verified artifacts of one tail name two records, its proof and a
  checkpoint or two checkpoints. Said once per tail.
- **`scheme-downgrade`**: a first-scheme checkpoint under a second-scheme tail proof, or after a
  second-scheme checkpoint in the tail's order: a signature made for no record where the tail had
  named its own. Read over every checkpoint line, verified or not, since the scheme is in the
  bytes. Said once per tail.
- **`another-record`**: the named tails of the directory name two records or more. The refusal
  is about the record and names every group with its tails, on purpose: a reader of a directory
  alone cannot tell which group was there first, and counting tails would let a graft of many
  win. A tail grafted from another record, and two records an honest `init` began on two branches
  and a merge joined, both read this way.

A tail that names no record, in a record whose other tails name one, is **said and not refused**,
as a census note `unnamed-tail`: a tail written before records were named on a machine that
wrote nothing since, and, the guilty reading, a tail of another record written before, which
nothing here tells from this record's own. A record none of whose tails names one (every record
written before 0.1.5, until a writer of 0.1.5 writes in it) is unnamed, and both readers say so in
the same words, `record: unnamed (written before 0.1.5): a tail of another record could not be
told from this record's own`: `verify` as a clause of its verdict, before the witness clause, and
the second reader in a note. Neither refuses it. Each frozen record
in the suite is read this way, byte for byte as it was written, and
`__fixtures__/named-by-its-genesis`, written once by the signing code of the second schemes, is
read as named: a genesis tail born before and bound by its first second-scheme checkpoint, and a
tail born named.

**What this implementation's writer signs under**, from 0.1.5: every tail proof and every
checkpoint it writes is of the second scheme, and names the record its own tail already names;
else the one record the directory's other tails name; else (no tail names one) the record the
directory continues, where it continues one: a project's private tree founded in the repository's
git directory takes the record its tree from before the repository (`.mnema/private/`) names, so
`mnema doctor --fix private-tree` joins one record; else the record whose genesis tail is found by
the rule above, its own tail where no tail holds a first entry, so a new
record names itself from its first tail. A tail is read for this as the readers read it: by its
second-scheme proof, else by its last checkpoint when that one is of the second scheme, each
signature checked under the committed key its id names. The writer writes nothing where the other
tails name two records, or where its own tail names one and every other named tail another
(`ANOTHER_RECORD`). It never appends to a tail whose end it holds no note of having written
(the `<tailId>.head` of §4): it opens a new tail, named, instead. So a tail written before 0.1.5
is never bound by its owner's first second-scheme checkpoint in practice, and stays unnamed: the
protection holds from 0.1.5 on (`packages/chain/src/chain/the-writer-names-the-record.test.ts`).

**A cut of the genesis tail does not rename the record while a tail carries the name.** A writer
takes the name the other tails carry before it asks the genesis rule, so once one tail names the
record, the genesis may go. The waiver of §3 is that tail when this implementation cuts the
genesis: it is written before the cut, while the genesis is still on disk, on the pruner's own
tail, whose second-scheme proof names the record from that genesis; after the cut, every writer
signs under the name it carries, and a branch made before the cut that named the record from the
same genesis merges into a record of one name, which both readers verify where the writers after
the cut are keys of identities founded elsewhere than the cut tail (none that tail founded or enrolled)
(`packages/code/tests/the-record-name-survives-a-cut-of-its-genesis.test.ts`, whose writers are keys
of their own). The cut keeps the name, not the identity the cut tail founded or enrolled: the
identity lives only in the tail that wrote it (`identity.founded`, `key.enrolled`, `agent.enrolled`,
`checker.enrolled`), and the waiver carries none of it, so after a cut a key that tail introduced
fails T2/T4 in both readers wherever its events stay in another tail, and the writer refuses its
next write (`STALE_ANCHOR`). That is the writer's rule and not the readers': `tail prune` refuses to
authorize such a cut, for a key not revoked or revoked with events in a tail that stays, unless
the keys are named (`--lose-keys`), and starts the waiver's reason with
them; no reader consults it (`packages/code/tests/a-tail-that-holds-keys-is-not-cut-without-naming-them.test.ts`). Where no tail
carrying the name is left when the genesis goes (the genesis removed with no waiver, or cut by a
writer from before 0.1.5, whose waiver lives on a tail that names no record), a writer from 0.1.5
on names the record from the genesis among the tails still present, and a branch that had named it
from the old genesis leaves, once merged, a directory of two names that both readers refuse
(`another-record`; the cut with no waiver, in the same test). So does a tail written before records
were named whose first `at` is earlier than the genesis, brought by a branch on which a writer from
0.1.5 on named the record after it (same test). This document does not mend either: the product's `verify --since` refuses such a
branch before the merge.

## 7. Versions, and why a proof is never recomputed over a reading

Every event carries `kind` and `v`. Together they select exactly one payload
contract. A reader lifts an old `v` forward through registered upcasters, so what
a consumer holds is the event re-expressed under **today's** contract.

**A proof is never recomputed over that.** Both digests are taken over the form
that was WRITTEN. Hand a lifted event to a digest and the first kind that ever
gains a `v2` makes every chain written before it report as tampered; entry hashes
stop matching, and checkpoint signatures stop verifying: a keyless-editor alarm
raised by an honest read
(`packages/chain/src/chain/upcast-vs-proof.test.ts`).

**This is the one section a second implementation cannot check today**, and it is
said here rather than left to be discovered: no kind in the published vectors
carries a `v` above 1, and no upcaster is published, so there is nothing for an
outside reader to lift. The claim rests on the test above, which lives inside the
codebase it is about. The first kind to gain a `v2` should gain a published vector
for the old `v` alongside it, and that is an intention, not a guarantee: the table of
vectors is held total by KIND (`packages/chain/src/events/vectors.ts` does not compile
while a kind has no row), not by `(kind, v)`, so nothing yet makes a new `v` bring its
vector with it.

The top-level keys of an event are the keys `event-schema.json` declares under
`envelope`, plus `payload`: **nine envelope names, of which three are optional**. This
paragraph used to read *"the seven top-level keys of an event are `at`, `kind`,
`payload`, `signerFp`, `subject`, `v` and `who`"*, and that sentence was false: it
was the INTERSECTION of the published vectors, and `which` and `run` were carried
by sixteen and three of the vectors published then (how many carry them now is
`canonical-vectors.json`'s to say, not this paragraph's). What falsified it is that
an independent verifier believed it: it took the intersection, as the sentence
invited, and **refused an honest event for carrying `which`**, on a record this
product read as fine (§4.1, gap G25). A required field and an optional one look
identical in an exemplar, which is the whole reason the declarations are now
published rather than described.

**`after` moved no `v`.** It is envelope, not a payload contract, and both digests are
taken over the written form as they always were. A reader from before it refuses a record
that carries one, because the envelope is closed (§4.1): the consequence a new kind has too.

### 7.1 What one version promises another

From the first version of this product published to the npm registry, 0.1.0, every version keeps two
promises about the records the others wrote, and one rule that makes the second possible. They
are this product's, and the test named below holds both readers beside this document to them.

- **Backward: a version reads every record an earlier one wrote.** Every line a published
  version wrote is read by every later one under the contract its `kind` and `v` selected,
  lifted through the registered upcasters when that kind has gained a later `v`, and the proof
  is taken over the line as written (§7, above). A later version does not refuse such a line for
  its shape, except where the tightening below says otherwise. This is a promise about reading the
  lines, not about the verdict over them (below).
- **Forward: a version refuses by name what it cannot read.** A line whose `kind` and `v` no row
  of a reader's table declares is refused (§4.1), never guessed at and never skipped, and the
  refusal names the pair, what the reader reads of that kind, and, in this product, which mnema
  refuses: *mnema \<version\> does not read "memory.foretold" at v1: it reads no version of that
  kind. If a newer mnema wrote the line, read the record with it.* (or *it reads that kind up to
  v1*, for a version ahead of the one it holds). The second reader names the pair and what the
  table it read declares of the kind. Nothing in a record says which version wrote a line, and no
  field is added to say it, so the refusal names the version that does not read the line rather
  than the one that does. This product's `verify` fails on it. A checkpoint or a tail proof under
  a scheme of its family a reader does not read is refused the same way, before its other keys:
  *a checkpoint scheme this reader does not know: '\<a later scheme\>': mnema \<version\> reads
  mnema-checkpoint/1 and mnema-checkpoint/2. If a newer mnema wrote the line, read the record
  with it.* The second reader names the scheme and the schemes it reads. A value that is no
  scheme of the family is named alone. Versions released before 0.1.5 name no version in this
  refusal, and refuse every second-scheme line as a scheme they do not know.
- **A rule of authenticity or of legality is never loosened within an existing `kind` and `v`.**
  What a line may carry (§4.1), which key may sign it (§6.2), who may take a note or a link back
  (§6.4), which moves a workflow allows (§6.7) and which writing of a decision is its text (§6.8)
  stay what they were for every `kind` and `v`
  that already exists. A new permission, one between records included, is a new `kind` or a new
  `v`, which a version from before it refuses by naming the version, as above. The envelope is
  shared by every kind, so it gains no field within an existing `kind` and `v` either, as `after`
  did before the first publication. This is what keeps the forward promise whole: a permission
  added inside an existing pair would be read by a version from before it as a forged, illegal or
  broken line, with nothing refused, so two versions would read the same bytes two ways and
  neither would say why.

`packages/chain/src/chain/the-promise-between-versions.test.ts` holds a record to each promise.
Backward, `__fixtures__/written-by-an-earlier-binary`, a record this product's command line wrote
on 15 October 2026 and that is never written again: an identity with its backup key, a note
taken back, three decisions accepted, superseded and rejected, a task blocked, sent back from
review, approved, reopened and completed, a link that governs a path: both readers verify it,
every move applied, nothing refused. Forward, a signed, chained and checkpointed record whose
third line carries a kind no version declares, and then a version ahead of the one declared:
both readers refuse it with the words above.

**What the promise does not cover.**

- **What came before the first publication.** The versions released before it changed rules
  inside kinds and versions that already existed. §6.4 made a retraction its author's and §6.7
  put the workflows in the format: a binary from before them reads a later record under its own
  rules: it applies the retraction or the move a later one does not, and refuses no line for it.
  `after` entered the envelope with no new `v`: a binary from before it refuses a line that
  carries one by naming the field, not the version (§7, above). And those binaries' refusals of a
  pair they do not hold name the kind, and for a version ahead the two versions, but not the
  mnema that refuses. That is why the promise starts at the first publication rather than
  earlier.
- **A rule tightened within an existing `kind` and `v` after it.** The promise forbids loosening;
  it does not forbid tightening. A later version may come to leave unapplied or name what an
  earlier one applied, as §6.7 did, or to fail a record an earlier one verified, on a rule other
  than a line's shape; then the two read the same bytes two ways: the earlier one applies the
  line as its rule allows and refuses nothing, because the line is a pair it reads. What bounds
  such a change is the backward promise (the later version still reads every line an earlier one
  wrote) and that it is a change to this document and to the changelog, visible in a diff. It is
  not a refusal a version from before it can give.
- **The unknown-key rule is such a tightening, and a shape one.** §4 refuses a line that carries a
  key its writer does not declare, so it refuses on a line's shape, which the backward promise above
  otherwise leaves alone. It was tightened after the first publication. A version from before it
  verifies such a line and refuses nothing, as above. It holds backward only because no published
  writer ever wrote such a key: 0.1.0, 0.1.1 and 0.1.2 were each checked by writing records of every
  kind with that binary, and none of them wrote one. A later writer that does would be refused by
  the rule itself, and by no earlier version.
- **A `key.enrolled` naming an agent key is such a tightening, and a legality one** (§6.2, "A
  key holds one role"). It holds backward because no published writer wrote one: each of 0.1.0,
  0.1.1 and 0.1.2 wrote a record (committed, private and global trees) through every flow that
  enrols, retires and asks again for an agent key and enrols a member and a checker, and was
  then handed a copy of its agent's key file to enrol as a person's: none of the nine trees holds
  such a fact, and each binary refused the copy because its record already enrolled the key as
  an agent. What a published writer can still produce is the case between two records: a member
  enrolling, in a record that never held the `agent.enrolled`, a copy of a key another record
  made an agent. That is not refused by this rule and is said below.
- **Reading forward.** No version reads a pair it does not hold: it refuses. A reader that
  skipped the line and read the rest would say a record verifies with facts in it that it cannot
  judge.
- **The order between tails.** It rests on the writers' clocks and on what each cites ("Reading
  many tails"), a limit stated there and outside this promise.

## 8. The external witness (T3)

A checkpoint can be **dated by somebody outside this machine**. That closes the one
hole the two layers above cannot: a party who holds the signing key can rebuild the
whole chain and re-sign it, and everything in sections 1–7 will verify. What they
cannot produce is an attestation dated before they started.

What is attested is **the SHA-256 of a checkpoint's signed message** (§6), the same
digest `prev` links to, and nothing else. No id, no title, no body, no count leaves
the machine. And because checkpoints chain, attesting **one** dates every checkpoint
below it: this is not an attestation per event, nor even per checkpoint.

Two files sit beside the checkpoints they are about:

```
tails/<tailId>/witness/<checkpointHash>.ots      an OpenTimestamps detached proof
tails/<tailId>/witness/<checkpointHash>.blocks   the 80-byte Bitcoin block headers
```

- The `.ots` is **[OpenTimestamps](https://opentimestamps.org)' own format, unaltered**:
  a Merkle path from the digest to a Bitcoin block's merkle root. A stranger runs
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
meets the target it declares, which must be at least `0x1800ffff`, 2**40 times the
genesis difficulty. A header mined at an easier target is refused, because one is
found in milliseconds (`packages/chain/src/chain/bitcoin.test.ts`).

The arithmetic of the third one, spelled out because only the second one's byte order
was: the header's own hash is the **double** SHA-256 of its 80 bytes, compared as a
**little-endian** integer against the target that `bits` (bytes 72–76, little-endian)
declares in Bitcoin's compact form: `(bits & 0x007fffff) << 8·((bits >> 24) − 3)`.
Under that expansion `0x1800ffff` is `0xffff · 2^168` and the genesis `0x1d00ffff` is
`0xffff · 2^208`, and `208 − 168 = 40`, which is where the sentence above comes from.

**The sidecar and the proof's attestations do not match up one to one, in either
direction.** A `.blocks` file may carry headers the proof beside it does not use, and a
proof may attest a block the sidecar has no header for: the frozen `witnessed-record`
does both at once, attesting blocks 963688, 963689 and 963690 while shipping two headers.
The pairing is by the height the attestation declares. A bitcoin attestation whose header
is absent is simply one that cannot be folded offline; it is neither coverage nor a break.

**Nothing confirmed, and more than one thing reached.** A proof can reach a block whose
header is absent *and* a calendar that has not answered. Both are the same non-coverage,
so neither moves a level, but a reader that reduces them to ONE statement must not let
the order the branches of a third-party file were serialized in decide which. That is the
paragraph below's rule, on this side of it: a semantically identical `.ots` can reorder,
so an order-picked report is one two faithful readers disagree about over the same bytes.
Where a **height** breaks the tie, take the **lowest**: the same tie-break as below, so
this document holds one rule over that set and not two. This document does **not** require
one statement: publishing the whole set is order-independent by construction, and the
reference reader in `verifier/` does exactly that. The rule was missing, and the product
was measured reporting either of two sentences for one set of facts, chosen by which
attestation the file happened to list first (`packages/chain/src/chain/witness.test.ts`).

**Which attestation dates the record, when a checkpoint has several.** It usually has
several: three calendars, three attestations, and they land in different blocks. Take
the **earliest confirmed block** among them, which is the one of **lowest height**: an
attestation in an earlier block is the stronger claim, and the alternative (the first
one a walk of the proof happens to reach) makes the reported date depend on the order
the branches of a third-party file were serialized in.

**By HEIGHT, and the instant is the block's own declared `nTime`.** This paragraph used
to argue from time (*existing at that instant implies existing at every later one*)
and Bitcoin's consensus does not guarantee that ordering. A block's `nTime` is declared
by whoever mined it and is only BOUNDED: above the median of the preceding eleven blocks,
below the receiving node's clock plus two hours. So a block of lower height may carry a
later instant, and an election by instant would rest on a miner's field. Height is the
chain's own order, it is what the reference OpenTimestamps client elects by (it orders
attestations by ascending height and stops at the first valid one), and the instant a
reader prints is then that block's declared `nTime`, which the consensus bounds rather
than fixes. No published vector has a height and an instant in opposite orders, so
nothing in this document's own corpus exercises the distinction; it is written down
because a reader who inferred monotonicity from the old sentence would have inferred it
from prose and not from the chain.

This rule was missing, and its absence was the one thing two faithful readers of this
document were measured disagreeing about: the product elected the first attestation a
walk reached that had a header and dated the frozen `witnessed-record` twenty minutes
later than the reference reader did
(`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`, which now pins
the agreement and the reason it was ever a disagreement). **What the rule does not buy,
measured:** the published date still depends on which headers the writer kept: deleting
one line of the `.blocks` sidecar moves it under either rule. The election makes two
readers agree over the bytes as shipped, and makes the answer independent of an `.ots`
file's serialization order. It does not make it independent of the sidecar.

**What a reader refuses before it reads.** Both files are committed, so a clone opens
whatever the last person to write the repository put there. Three limits are declared
rather than left to a stack: a path deeper than **1000 steps**, a proof past **1 MiB**,
and a message a path has folded past **4 KiB** are each refused by name. **A step is one
OpenTimestamps operation** (one `append`, `prepend` or hash) which is the unit the limit
counts and which used to be left to the reader to guess. Measured over the three frozen
proofs: 8 to 14 operations from the digest down to a calendar's own `pending` leaf, and
**77 to 83** down to a bitcoin leaf, in files of 3,586 to 3,761 bytes folding messages of
about a hundred. So the depth limit has a little over one order of magnitude of room, the
size limit nearly three, and the fold limit nearly two: each is a refusal, which can only
ever reject an exotic proof and never accept a hostile one. (This paragraph used to justify
the depth limit with "eight or nine steps per calendar", which is the distance to a
`pending` leaf and not the distance the limit guards; the number it implied was an order of
magnitude off the one the counter sees.) (Measured on the reader before they existed: a 30 KB file of one repeated byte took
the parse past V8's stack; a 979 KiB file of `append` steps walked in 238 ms and ended
holding a megabyte.)

**A request that has not confirmed is not coverage, and it is never silence.** A
proof is born incomplete (the calendars promise to aggregate it, and a Bitcoin block
carries it minutes to hours later) so between asking and holding there is a third
state, reported as `pending` and counted as nothing
(`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-record.test.ts`). Counting for nothing is not the
same as being dropped, and the reader used to do both: a record whose only proof was
still in flight answered `nothing outside this machine attests this record`, which is
the sentence a record nobody ever stamped earns, and the act that follows from it is
to stamp again. A request is now reported wherever it is found (with the calendar it
is with, when the proof names one) and it still raises no level and satisfies no
`--require` (`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-then-written.test.ts`,
`packages/code/src/commands/witness.test.ts`).

**The URI a `pending` leaf carries is an address, and the format does not vouch for
it.** It is `varbytes` written by whoever answered the original request, so a `.ots` (a
file that travels, and that any client will hand you) names who a return visit talks to
next. Reading it is this format's business; going there is not, and the act that does go
holds it to an https host at a public timestamp operator, refusing a redirect that leaves
that host (`packages/chain/src/chain/witness-request.ts`,
`packages/chain/src/chain/witness-request.test.ts`). Measured on the built product before
that check existed: a forged proof aimed the act at a chosen host and port over cleartext,
its redirect was followed to a second host, and the act reported no refusal either time.
Nothing about the bytes changed (the value on the path is still a hash of a hash) so
what this closes is contact and not disclosure.

**The attestations accumulate, and a reader asks all of them.** Nothing in this format
removes a witness file: stamp today, write tomorrow, and yesterday's `.ots` stays under
yesterday's digest, still proving that that checkpoint existed at that instant. So a
reader takes the **newest** checkpoint it holds a confirmed attestation for (and the
newest request still open, for when there is no confirmed one) and reports
three things together: the instant, the block, and **how many events were written after
the checkpoint that instant dates**. The ACT that completes a request walks the same way,
newest first, stopping at the first attestation that confirms
(`packages/code/src/commands/witness.test.ts`); it asked only about the last checkpoint
for a while after the reader stopped doing so, which left a record able to hold a request
the reader reported and the act would not finish. A record whose newest attestation reaches its last
event reads `covered`; one dated to an earlier point reads `not covered` and says the
date and the remainder in one sentence, because a date without a boundary claims more
than it holds. (Before this, a reader asked only about the last checkpoint, so a record
holding a valid attestation answered `nothing outside this machine attests this record`
the moment one more event was written, an understatement of what its own files prove.
`packages/chain/src/chain/witness.test.ts`,
`packages/chain/src/chain/witnessed-record.test.ts`.)

What this layer does **not** prove, said here rather than in a footnote: the stored
header is checked for its work, not for its place in the chain. A reader who needs
that follows the block id into any explorer, or runs the `ots` client against a node,
which the unaltered `.ots` is there for.

### 8.1 A Sigstore countersignature

A third file can sit beside a checkpoint:

```
tails/<tailId>/witness/<checkpointHash>.sigstore.json   a Sigstore bundle, v0.3
```

It is **[Sigstore](https://www.sigstore.dev)'s own bundle, unaltered**
(`application/vnd.dev.sigstore.bundle.v0.3+json`, a `messageSignature`): an ECDSA signature
over **the checkpoint's signed message** (§6), whose SHA-256 is the file's name, made with a
short-lived Fulcio certificate, and logged in Rekor as a `hashedrekord` of that digest. The
message itself is not in the bundle and never left the machine; a reader recomputes it from
`checkpoints.jsonl`. A stranger checks it with Sigstore's own tools (`cosign verify-blob
--bundle`) against that recomputed message, without this product installed.

**It is no witness level.** A verification of the format does not read it, and neither
reader moves its verdict, its level or its exit for it: the `.ots` above is the only file T3
counts. It is read by one reading that has to be asked for, `mnema verify
--against-sigstore`, which checks it offline against the Sigstore trust root the binary
carries and answers in notes. A reader that only knows `.ots` passes it by, and the reference
reader in `verifier/` names each one as not checked (gap G26).

**What it says, and what it does not.** The certificate names an e-mail address, or a GitHub
Actions workflow of a repository, not a person, not a GitHub login, and not a mnema
identity. Anybody can countersign the digest of any checkpoint they can read, so a bundle on
its own dates the checkpoint, at Rekor's time or a timestamp authority's (on a Rekor v2 entry), and says nothing about who
wrote it. It speaks for an identity of the record only where that identity named the same
e-mail or workflow in a signature-covered `account.linked` with `service: "sigstore"` (§6.3)
(`packages/code/src/sigstore/sigstore.test.ts`): for an e-mail, the hash of the one the
certificate names. The identity it names is public by construction: it is in Rekor's log and in
the committed file, in clear; the hash §6.3 records protects the event, not the bundle.

## Reading many tails

A record holds one tail per machine (§4), and each tail is proved in its own `seq` order by its own
hash chain (§3). Across tails, the bytes carry one kind of order and only one: a CITATION. The
envelope's optional `after` (§4.1) names the entry hashes of the heads of other tails that the
writer had read when it wrote. A reader that wants ONE sequence of events, to replay them into a
state, has to choose the rest. This section says which choice the product's reader makes, and what
it leaves undecided. Apart from §6.2, which folds enrolment in this same order, and §6.7, which
judges every move in it (and §6.4, which names it for the retraction that holds, and §6.8, which
binds a decision's text by the same sight), it describes what
the code does and is not part of what a verifier checks: another reader may order the tails
otherwise without disagreeing about a single byte. It would then disagree about what those two
sections do with the bytes: §6.2 can refuse an event of an honest record that another order
places before the enrolment it depends on, and §6.7 names the moves it does not apply where the
order puts them. Every sentence names the case that holds it. Unless another file is named, a
case named P, MR, R5 or R6 is in `packages/core/src/projections/many-tails.properties.test.ts`,
and a case named R1 to R4 or R8 in `packages/chain/src/chain/causal-order.properties.test.ts`;
each compares the reader with a model of the sentence, a few lines long, written in the test.

**The order inside a tail is `seq`, always.** The reader never compares the `at` of two events of
one tail, so a clock that stepped back between two appends does not move the later-sequenced event
earlier. A tail's events appear in the merged sequence in `seq` order whatever their `at` says (P1:
"within a tail the order is seq, even when at runs backwards"), and whatever they cite (R5: "under
clocks that disagree, the merge is the causal model, and every tail is read in seq order").

**The order across tails is a selection of heads.** Each tail is a queue, read from `seq` 0. At
every step the reader looks at the first unread event of each tail that still has one, its head,
and keeps the heads that are READY: every entry the head cites has already been taken. Among those
it takes the head with the smallest `at`. A tie goes to the head whose tree comes first in the list
the reader was given, compared as a NUMBER, and then to the head of the tail with the smaller tail
id, compared as text by UTF-16 code unit: the product's reader and the second reader beside this
file compare tail ids that way. A reader of one record has one tree, so for it the tie goes to the
tail id; several trees are taken up in "Several trees are merged by the same selection",
below. The tail whose head was taken advances by one, and the step repeats until every tail is read. `at` is the text of the field,
compared as text. So an event is never taken before what it cites, whatever the two clocks said (R1:
"an entry is never taken before what it cites, whatever the instants say"). With no citation every
head is ready, and the order is exactly the selection by `at` that every record was read in before
citations existed (R2: "with no citation, the order is exactly the selection of heads by at of
before"; and over records on disk, "the optimized merge equals the naive one over generated tails").
This is not a sort of all the events by `(at, tail, seq)`: such a sort would put a later-sequenced
event of a tail before an earlier one the moment their `at` ran backwards, and the selection never
does. One consequence is worth stating, because it surprises: an event whose `at` is far in the
future holds back every event after it in its own tail, since none of them can be read until it is
(the same case).

**A citation only ever holds its own event back.** It never moves anything earlier: adding a
citation to an event moves that event, the events after it in its tail, and whatever cites those,
and leaves the order of everything else as it was (R3: "a citation added to an entry moves nothing
that does not depend on that entry"). The writer controls its own `at` already, which moves its
events either way, so a citation gives no capability a writer did not have. A citation of a hash
the record does not hold (a clone that lacks a tail, a tail that was cut) is ignored: the order is
the one the event would have without it (R4: "a citation of a hash the tree does not hold changes
nothing, and is returned"), and this product's `verify` names it in its census, informational (§6.2).
If no head is ready, which takes a cycle of citations and so a SHA-256 collision (a cited hash
existed before the entry citing it was written), the head with the smallest `at` is taken anyway,
so the order is total whatever the bytes say; that case is not held by a test, because an honest
writer cannot produce it.

**What this product's writer cites.** At every append, the head of each other tail of the same
record that its own tail has not cited yet, read off the disk as it writes: what existed when it
wrote, and so nothing it cannot back. Nothing new to cite, no field
(`packages/chain/src/chain/cited-heads.test.ts`, "cites the head of another tail the first time,
and not again until that tail moves"). A writer cites the tails of its own record only.

**What a citation fixes.** Three honest records the selection by `at` alone read wrong, each
written by a machine whose clock is an hour behind, on top of what it had pulled
(`packages/core/src/projections/the-order-follows-what-was-read.test.ts`): a decision superseded
there read as still in force; a task cancelled there read as started, its cancellation a move
from a state the task was not in (§6.7); a link retracted there went on standing. With the
citation each reads as it happened ("with the citation it reads superseded, and its successor
stands"; "with the citation it reads cancelled, and nothing is named"; "with the citation the link
is retracted"). The fourth is
§6.2's: an enrolled machine's first event refused by `verify` on an honest record.

**The order does not depend on how the reader met the tails.** The tails read as the same sequence
whatever order they were written into the directory, copied in, or listed (MR1: "the order the
tails are written into the directory changes nothing, in the model or on disk"). Of that, the
model half is held everywhere; the on-disk half is held only where a directory listing does not
come back sorted, because the reader sorts it. Nothing here holds that a tail copied in a second
time, byte for byte, changes nothing: the copy lands on the same paths with the same bytes, so
there is no defect that case could catch. A tail copied under another id is not a second tail:
each of its entries names the tail it was written to, and the reader reports the break at the
directory it was found in (MR3: "a tail copied under another id does not read as a second tail";
the verifier's side of the same fact is in §3).

**Appending never reorders what was read.** An event appended to a tail lands after everything
that tail already held, and the events read before stay in the same relative order with it there.
So an event about something else moves neither the state a decision is in nor what is said about
its divergence (MR4: "appending an event about another subject, on any tail, at any instant,
leaves X as it was"). Cutting events off the end of a tail leaves a tail whose events are read as
before; when a signed checkpoint covers the cut, it is no longer a shorter tail but one the
verifier calls broken (MR5: "a cut above the last checkpoint verifies, reads as the model of the
prefix, and chains"; "a cut BELOW a checkpoint is the one a verifier calls broken").

**A reader that keeps a cache gets the same sequence as one that replays.** A cache brought
forward arrival by arrival, or deleted at any point and built again, answers what a replay of the
whole record answers (P2: "after any arrivals, with the cache deleted at a drawn point, it
answers what a replay answers"; and with every machine citing, R6: "a cache brought forward is a
replay, with citations and clocks that disagree"). When an arrival would sort before something the
cache already holds (a tail from a colleague that carries older facts), the cache is built again
rather than extended. So it is when an arrival is an entry a covered event cited and could not find,
since that event now waits for it (R6: "an arrival that a covered event cited, and could not find,
is not a suffix; the cache reads again"), and when an arrival cites an entry the cache cannot
place without reading the record again (R6: "an ARRIVAL citing what the record does not hold yet
still waits for it when it comes, read incrementally").

**Several trees are merged by the same selection, with the tree's position in the tie.** A reader
that merges more than one record (a team's committed tree and a person's own) breaks a tie between
tails of different trees by the position of each tree in the list it was given, compared as a
NUMBER, and only then by the tail id (MR2: "across trees, a tie goes to the tree first and then the
tail: the model of that says it"). So with ten trees or more the eleventh listed is read after the
second on a tie, as with fewer (across ten trees or more: "the tree position in the tie is compared
as a number, so the tree listed eleventh sorts after the one listed second"). It used to be
compared as text, which put `"10:…"` before `"1:…"`; nothing was written that depended on it. A
citation resolves inside its own tree, so it reorders a tree against itself and nothing else, and
merging the trees is merging each tree and then the trees by `at` and position (R8: "merging the
trees is merging each tree and then the trees, by at and then position"). Where no two heads share
an instant, the trees merged are the single record holding all their tails, whichever order they
are listed in (MR2: "with no two heads on the same instant, the parts joined are the whole").

**What is detected.** Two moves of one decision, or one skill, out of the same state are two facts
signed by machines that had not seen each other; the reader names them whichever of the two the
sequence puts last, and removes neither
(`packages/core/src/projections/divergent-moves.test.ts`, "says the decision two machines moved
out of `proposed`, with both moves as evidence"). A move repeated byte for byte is one move read
twice, not two: it is what a tail whose last entry was duplicated holds, a tail both readers
refuse at the repeated `seq` (§3), and this product's reading says no divergence of it
(`packages/core/src/projections/divergent-moves.test.ts`, "reads a move repeated byte for byte as
one move: a duplicated entry, not a divergence"). Two moves out of one state where the writer of
the second had seen the first are not that: the second is a move the workflow does not allow
(§6.7), not applied and named in the census, and no divergence is said of it
(`packages/core/src/projections/a-move-the-workflow-does-not-allow-is-not-applied.test.ts`,
"takes a second move out of one state, on the tail that saw the first, for no divergence"). A task has a state machine with cycles, so the
same fact cannot be read from its `from` alone: tasks are read by their position in the sequence
(`packages/core/src/projections/divergent-moves.test.ts`, "the task table has one, a reopened
task leaves a state again, so tasks are read by their order"). An accept and a retirement (a rejection, or a supersede) of one decision out of
the same state, by moves that did not see each other, are more than that, because the fold would let
the later `at` decide whether the decision governs: a reader that says what is in force leaves such
a decision out and says why, whichever move is last, and the call is put back in force by a
new decision, which a person, or an agent where agent-accepts is on, accepts (the same words
recorded again make one, whichever move was last). The census names it as `decision-divergence`, informational, the exit unchanged, at the
tail and `seq` of the first of the moves in the merged order, in both readers (the second reader
names it as a §6.7 note with the same rule and place:
`packages/chain/src/chain/second-reader-agrees-on-what-is-not-applied.test.ts`, "without
citations, the reject on A and the accept on B are a divergence, named by both at the accept"; the
readings of the product: `packages/code/tests/an-accept-and-a-retirement-that-crossed-are-in-force-nowhere.test.ts`).
Two accepts, or two retirements, are a divergence and nothing more: both say one thing about what
governs. Two decisions of one record that
carry the same `ADR-<n>` label are reported as a collision, and neither label is changed
(`packages/core/src/projections/decision.test.ts`, "adrCollisions: the label collision
detector").

**What is not resolved.** The sequence does not decide which of two concurrent moves wins: two
moves neither of which cites the other. The state a projection shows is the one the last move in
the sequence leaves, so it is whichever move the selection puts last, and the divergence is named
beside it (for an accept against a retirement of a decision, the state does not decide what is in force) (MR4: "what is read of X is what the model reads of X"). Nothing here corrects a clock:
`at` stays the wall clock its writer stamped. Where nothing is cited, a machine whose clock is
behind still sorts its events earlier than events it had already read; that is what a record
written before citations reads as, fixed and not endorsed. A writer that cited nothing is judged
by the state its subject is in at its point of that sequence, or by what its own tail holds of it
(§6.7), so a move it made on top of
what it had read, sorted before it, is one no reader applies (clocks that disagree, with nothing
cited: "uncited, a clock that runs behind sorts an honest task sequence out of its order, and the
move is not applied").
What does not change under any clock is the order inside a tail, and that two moves out of one
state of a decision are named, as a divergence, or as a move not applied (the same: "uncited, a
machine with a skewed clock keeps its own order, and two moves out of one state are always
named"). A move of a task out of a state the task had already left at that point is applied
only when its writer had not seen it leave (§6.7), so the moves the task reading names are, by
the citations too, moves that did not see each other.

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
  vectors and reaching the product's verdict over real records, save the two pinned
  cases at the top of this document,
  **including on every input the format refuses**, which is the half that took a
  second delivery: it accepted two things the product refused (a field no kind
  declares, on an appended event; a signer no enrolment authorized) and refused one
  thing the product accepts (an honest event carrying `which`). §4.1 and §6.2 are
  those three, closed. A fourth acceptance was found later (an event naming a
  signer other than the checkpoint over it) and §6 closes it. What that buys is
  technical independence (another language, another author-session, no shared
  code) and it is what surfaced the twenty-seven points where this document was
  not enough; the ones `gaps` still lists as unresolved are not fixed above.
  What it does **not** buy is social independence: same author, same repository,
  same interest in it working. A format with three implementations maintained by
  three parties checking each other has a kind of assurance this one still does not
  have. The step that is taken is the technical one; the step that is not is
  somebody else.
- **A key is an agent's only in the record that enrols it as one.** The role is a fact
  of a record (§6.2), not a property of the key: another record, which has not heard of
  that `agent.enrolled`, can enrol the same key as an ordinary member when one of its
  members vouches for it, and both readers accept that. Nothing in the format stops a
  key from being an agent of one identity and a member of another, in different
  records; it is stopped only inside one record, where a `key.enrolled` naming an agent
  key is refused (§6.2, "A key holds one role"). The product's `key request --key` and
  `key enroll` refuse a key by its fingerprint when the machine they run on keeps it for
  one of its agents, or a record they reach enrols it as an agent: a guard against a
  person's mistake on that machine, not a proof, since a copy of the key on another
  machine, or a writer that is not this product, is not asked.
- **A retirement is a fact of one record too.** An `agent.retired` refuses what the key
  signs after it in the record that holds the retirement (§6.2); a project's private tree
  and a machine's global tree are records of their own, and one that has not received the
  retirement still accepts the key's later facts and counts them as attested. The
  product's `mnema verify` crosses the trees of a project it verifies (the committed one,
  the private one, and the global one with `--global`): an event signed by an agent key
  that another of those trees retired, with an `at` later than that retirement's, is a
  break there, and is not counted as attested. That is the product's reading of a set of
  records, not a rule of this format: the second reader and the verifier page
  read one tree at a time and do not make it, and no reader sees a retirement written in
  a tree it was not given (another machine's private tree, or the global tree without
  `--global`). The cross has two limits of its own. `key revoke --agent` writes the
  retirement in one tree after the other, so an event the agent signed in a tree between
  the two retirements is refused in the tree whose retirement came later. And the cross
  compares the `at` each event carries, which the key that signs it writes, so a leaked
  key that writes an `at` earlier than the retirement passes it.
- **A change to the format is visible, and §7.1 is all that is promised about
  changing it.** This entry used to say that the per-kind field declarations were
  not published, and that in consequence an implementation built from this
  document could not refuse a newly APPENDED event carrying a field no kind
  declares: the door a party with **no key** could walk through. `event-schema.json`
  and §4.1 closed it, and the same measurement now runs the other way: the second
  reader refuses that event
  (`packages/chain/src/chain/second-reader-agrees-on-the-record.test.ts`). What
  remains true is the sentence above it: there is no standards body, no registry
  and no committed process. What IS committed is that a change to the bytes moves a
  published digest and a change to a contract moves a row of a published file, and
  both are visible; and, from the first publication, what one version promises
  another (§7.1).
- **Publishing the format adds no witness, and §8 is not the format's doing
  either.** The threat sections 1–7 do not cover is an edit made *with* the signing
  key: a key holder can rewrite and re-sign, and everything there will verify.
  Detecting that needs somebody OUTSIDE, and this used to say that was outside this
  document and outside this package. §8 brought it inside, but by taking a
  dependency on Bitcoin and on a public calendar answering, not by anything
  publishing these bytes achieved. A record nobody stamped is exactly where it
  always was. See the "What it proves, and what it does not" table in `README.md`.
- **The name of a record names a lineage, not a repository** (§6.10). A record copied whole (a
  fork, a `.mnema/` copied into a template) is the same record, and its tails verify in both
  copies. Anyone may still write their own tail into a record: the name is not secret, and a
  party who knows it signs a tail naming it with their own key, which is a contribution, not a
  graft; review is the gate for that, as before.
- **A tail written before records were named is never named by being read.** It stays unnamed
  until its owner signs a second-scheme checkpoint over it, and one whose last such checkpoint is
  cut off together with the events it covered (the aligned cut of §6) is unnamed again. A graft
  of an unnamed tail is a census note, not a refusal, to a reader of the directory alone; what
  refuses one that arrives in a pull request is the product's reading of the base, not this
  document. And a graft made between two records both written before, before either named
  itself, can make them derive one name, if the grafted tail is the older record's genesis.
- **This document specifies the bytes and the rules that read them, not the
  product's reading of them.** Which moves of a workflow a reader applies is here
  (§6.7), as are the enrolment fold (§6.2), who may take a note back (§6.4) and which writing of
  a decision is its text (§6.8). Which
  scope a fact is written to, and what a green verdict is worth to the person who
  reads it, are not: those are the product's.

## The delivery channel, and what it is not

The vectors travel with **this repository**, and so does the second implementation.

**THIS SECTION SAID THEY TRAVELLED BY NO OTHER CHANNEL, and that is no longer true.** It
read: *"They are not in any npm tarball: `@mnema/chain` is an internal package that is
never published"*. What falsified it is that `@mnema/chain` is now released in its own
right, and that its `files` was decided rather than defaulted: `dist/`, this document,
both artifacts and `verifier/`, precisely so that the tarball is a second address for
everything this section is about. A reader who installs the package and never clones has
the document, the vectors, the declarations and a verifier that runs against them.

So there are two channels and both are guarded, because an address nobody checks is an
address that quietly stops resolving:

- **In the repository.** This document's pointer to each artifact, by
  `packages/chain/src/format-doc.test.ts`; the verifier's presence, including that no
  `.gitignore` has swallowed it, by
  `packages/chain/src/chain/second-reader-is-independent.test.ts`.
- **In the tarball.** That all four travel, and that the verifier RUNS out of an extracted
  copy with nothing of this workspace beside it, by
  `packages/code/tests/what-a-package-publishes-is-what-its-page-promises.test.ts`.

What has not changed is the sentence underneath the old one: `@mnema/code` still ships its
compiled `dist/` only, so the address of both artifacts, for a reader who took the tool
rather than the engine, is still a path in the repository.

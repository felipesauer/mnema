# The third promise, attacked

**Eleven attacks were frozen in [protocol.md](../../protocol.md) before any of them ran. Nine were
carried out — two of the eleven are the same operation, and one collapses into two others — and
every prediction held.**

The attacker: **write access to the repository and to the machine, no private key.** Every attack ran
on a record founded in a throwaway sandbox with the product's own build. No model was called; this is
filesystem and cryptography. The scripts are in [`attacker/`](attacker/) and the verifier's own output
for each attack is in [`raw/`](raw/), because an attack nobody can reproduce is an assertion.

## What happened

| # | attack | predicted | result |
|---|---|---|---|
| 0 | *(baseline, untouched)* | green | exit 0, `local integrity verified (T1/T2/T4)` |
| 1 | Edit one event's content in place | T1 red, naming the entry | **held** — `#4: entry hash mismatch: content or link was altered` |
| 2 | Edit **and repair every entry hash** | T1 green, T2 red | **held** — **zero** T1 issues, and `checkpoint failed: content-root-mismatch` |
| 3 | Delete an event from the middle and re-chain | T2 red | **held** |
| 4 | Delete the whole tail | census issue, no green that hides it | **held, with a default named below** |
| 5 | Append an event signed by an unenrolled key | identity red | **held** — `event signer ffff… is not a key enrolled for` |
| 6 | Generate a real key, forge its enrolment with a **valid** reverse signature, sign with it | identity red | **held** — `key.enrolled is signed by a key not valid for the anchor at this point` |
| 7 | Re-sign a range with the attacker's key | identity red | **collapses into 5 and 6.** A keyless attacker holds only their own key, and both of those are that key trying to speak |
| 8 | Copy a tail into `tails/<real-fp>-<forged>/` | red | **held** — one T1 and six T2 issues |
| 9 · 10 | Roll back to a genuine older state · truncate to a consistent prefix | **green, and expected** | **held.** On an append-only chain these are one operation, reported as one |
| 11 | Forge `tailproof.json` | red | **held** |

## The attack that matters most

Attack 2 is the one the design was built against, and attack 6 is the one that would end the product
if it worked.

In 6 the attacker generates a real Ed25519 key, computes its fingerprint the way this code does, and
signs `enroll:<anchor>:<newFp>` with it — a **valid** reverse signature, the new key genuinely
consenting. Then they append that enrolment and sign a forged decision with the key they just
enrolled. Every hash links. Every shape matches the catalog.

It is refused because **the enrolment itself must be signed by a key that is already valid**. The
attacker's key can prove that it consented. It cannot prove that anybody invited it.

## The honesty test, which is why two greens were predicted

A rollback verifies **green**, and it should: a valid prefix is internally consistent, and local
cryptography cannot see that time moved. What the pre-registration put under test was whether the
product **says so**. It does, in the same sentence as the verdict:

```
public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered;
… external witness (T3): not covered — enable an anchor or push to a shared remote
```

And a gate can refuse it: on that record `--require=witnessed` exits **1** while `--require=signed`
exits **0** — which is correct, because the signatures really are valid. **The product does not
confuse "the signatures hold" with "nothing was removed".**

## The default that is named rather than defended

A record whose tail was **deleted entirely** passes a bare `mnema verify` at exit **0**. Nothing is
hidden: the verdict reads `local integrity verified (T1 only) — no signature was checked`, reports
`0 tail(s)`, and names the committed keys with no tail. And `--require=signed` exits **1** there.

So the product can say it, and the caller has to ask — the shape of `npm audit --audit-level`, and
the shape this repository already chose for `--allow-no-record`. **It is a default a gate must not
rely on.**

## Three attacks stopped by the wrong layer, and redone

A defence credited for catching a broken attack is not a defence that was tested. On the first pass:

- **2** — the repair wrote hashes into a detached object, so T1 still failed and T2's independence went
  untested. Redone; only then did T1 come back clean and T2 alone refuse.
- **5** — the forged event carried the wrong `seq`, so T1 caught a numbering mistake instead of
  identity catching a forgery. Redone.
- **6** — the forged `key.enrolled` did not match the catalog's shape and the line was rejected as
  `UNREADABLE`. That is a real defence — the typed closed catalog — but it is not the identity layer.
  Redone with a well-formed enrolment and a real key.

## What this does not say

T3 with a witness configured was not exercised: no anchor and no shared remote existed here. Whether
the transport was force-pushed is a question about git. And no attack was mounted by someone holding a
valid private key — that is T3 by definition, and this product delegates it rather than claiming it.

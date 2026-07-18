# Integrity model

"Tamper-evident" is a claim that deserves to be precise, so here is exactly
what protects the log, what each layer buys you, and — just as important —
what it does *not* defend against. The protection is layered: each one catches
what the one below it can't.

## The three layers

**Layer 1 — hash chain (always on).** Every event carries the hash of the one
before it, so the log is a chain. This catches **accidental** corruption,
reordering, and truncation: flip a byte in a past line and the links stop
matching. On its own a plain chain is *not* proof against a deliberate attacker
— someone who edits a past line can also recompute every hash after it and hand
you a chain that still links cleanly. That is what the next layers close.

**Layer 2 — authenticity (keyed HMAC + machine signatures).** Two independent
secrets an in-repo attacker doesn't have:

- **Per-project HMAC secret.** Each event's hash is keyed with a secret that
  lives **outside the repo** at `~/.config/mnema/projects/<key>/hmac.key` (mode
  `0600`). Only a non-secret fingerprint is committed. Recomputing the chain
  now requires the secret, not just the algorithm — so an agent (or anyone)
  with write access to the repo files cannot forge a valid rewrite.

  A teammate or a second machine needs that secret to verify the keyed chain:
  `mnema project secret export` prints it as an out-of-band envelope, and
  `mnema project secret import` installs one received the same way — the secret
  itself never touches the repo.
- **Per-machine Ed25519 signatures.** At a checkpoint interval the chain *head*
  is signed by a per-machine private key (also `0600`, outside the repo); the
  public key is committed as `.mnema/keys/<actor>.<fingerprint>.pub` so any
  clone can verify. A signed checkpoint pins the chain length: rolling the log
  *back* below a signed checkpoint is detected as tampering, not mistaken for a
  crash.

The **v3→v2 downgrade** — stripping the keyed events to pass off an unkeyed
chain — is closed by version monotonicity plus a fingerprint-implies-v3 rule,
so an attacker can't quietly drop to the weaker format.

**Content attestation — verifiable by anyone, no secret needed (opt-in).**
The HMAC proves authenticity only to a *secret-holder*; a **public clone or an
outside reviewer** has no way to check it. So the per-machine Ed25519 key can
also sign a **content-recomputable root** over each batch of events, written to
`.mnema/audit/attest/<to>.att`. Once those `.att` files are committed, a
stranger recomputes that root from the events on disk and verifies the
signature against the committed public key — with **no secret at all**. Editing
any covered event changes the root and breaks the signature; without this,
editing v3 content passes green for anyone lacking the project secret.
Attestations are emitted automatically at each checkpoint; `mnema audit
reattest` backfills or repairs them. `mnema audit verify` reports coverage per
batch and **never shows green beyond the last attestation**.

Whether to commit the `.att` files is the project's choice: Mnema's own repo
does **not** commit its own — its `.mnema/` is a development workbench (a
knowingly churned, non-canonical audit trail), not a reference. For a worked
example of a repo that adopts attestation, look to a real adopting project
rather than to Mnema's own tree.

**Layer 3 — temporal anchoring (opt-in, default `none`).** A pluggable
provider stamps the signed head into an external, independently verifiable
record, so you can prove the head *existed at a point in time* — defending
against someone who controls the machine and its keys but can't rewrite
external history. It runs **off the write path** and **fail-open** (a provider
outage never blocks a mutation). The `git-signed` provider ships; anchoring is
a pluggable extension point, so a network-backed provider can be added without
touching the write path. See
[the configuration reference](configuration#audit-anchor) to enable it.

`mnema doctor` verifies layers 1 and 2 offline every run; `mnema audit verify
--verify-anchors` additionally checks layer-3 receipts against the provider.

## Threat model

**What Mnema detects:**

| Attack | Caught by |
|---|---|
| Editing a past event | Layer 1 (chain) + Layer 2 (HMAC) |
| Editing a past event, checked by someone *without* the secret | Layer 2 content attestation, **when the `.att` files are committed** — the signed root breaks |
| Recomputing hashes to hide an edit | Layer 2 — no HMAC secret, so the recomputed chain fails |
| Deleting or reordering events | Layer 1 |
| Rolling the log back below a signed checkpoint | Layer 2 signatures |
| Downgrading the keyed chain to the unkeyed format | Version monotonicity + fingerprint-implies-v3 |
| Backdating a forged history | Layer 3 anchor (when enabled) |

**What Mnema does *not* defend against (be honest about the edges):**

- **A compromised machine that holds the private keys.** If an attacker has
  both repo write access *and* the `0600` keys under `~/.config/mnema`, they
  can produce a valid rewrite. The keys living outside the repo raises the bar
  past "any agent with file access"; it does not survive full host compromise.
  Anchoring (layer 3) is what narrows even this, by pinning the head to
  external history.
- **Truncating events written *after* the last attestation.** Removing the most
  recent, not-yet-attested tail is indistinguishable from a recoverable crash —
  both look like a chain that stops early. Content attestation bounds this to
  the window since the last `.att`, and `verify` never shows green past it;
  closing the window entirely for a public clone needs an enabled anchor (layer
  3), which pins the head to external history. This is a documented limitation,
  not a bug.
- **A dishonest coordinator.** Mnema records *who authorized* and *which agent
  executed*; it does not judge whether the human should have. It is a chain of
  custody, not a policy engine.

The honest one-line summary: the chain alone catches accident and the keyed,
signed layers catch a deliberate in-repo rewrite; defeating all of it requires
compromising the machine's out-of-repo keys, and even then an enabled anchor
leaves a trace.

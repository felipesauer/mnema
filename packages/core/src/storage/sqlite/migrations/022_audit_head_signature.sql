-- =============================================================================
-- Migration 022: audit_head_signature — machine attestation of the chain head
-- =============================================================================
-- Layer 2 (ADR-37) signs the audit chain head at a checkpoint interval with a
-- per-machine Ed25519 key, so a verifier can attest WHICH machine advanced the
-- log — not just that the hash chain is internally consistent. The keyed HMAC
-- chain proves the log was not forged without the project secret; this proves
-- a specific machine's key stood behind the head at each checkpoint.
--
-- One row (`id = 1`), holding the LATEST signed checkpoint. Verification checks
-- the most recent signature against the current head; each checkpoint overwrites
-- the row with that checkpoint's signer, so a chain advanced by several machines
-- over its life is still attested (the committed per-machine .pub files coexist,
-- and each signature records its signer fingerprint so the matching key is found).
--
-- Additive table → runs inside `Database.exec`'s implicit transaction; no
-- explicit BEGIN/COMMIT and no FK pragma needed (see migration-runner.ts).

CREATE TABLE audit_head_signature (
  -- Always 1 row. The CHECK keeps it that way, mirroring audit_state.
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  -- The chain_head_hash this signature covers (hex).
  covered_head_hash   TEXT NOT NULL,
  -- event_count at the moment of signing — lets a verifier tell whether the
  -- head has advanced past the last signed checkpoint.
  event_count_at      INTEGER NOT NULL,
  -- Resolved actor handle that owns the signing key.
  signer_actor        TEXT NOT NULL,
  -- sha256(SPKI DER) of the signer's public key — routes to the committed
  -- .mnema/keys/<actor>.<fp12>.pub for verification.
  signer_fingerprint  TEXT NOT NULL,
  -- Base64 Ed25519 signature over the covered head hash bytes.
  signature           TEXT NOT NULL,
  -- ISO8601 wall-clock of signing.
  signed_at           TEXT NOT NULL
);

-- Each migration records its own version (the runner does not).
INSERT INTO schema_migrations (version, applied_at)
VALUES (22, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

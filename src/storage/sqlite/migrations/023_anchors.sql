-- =============================================================================
-- Migration 023: anchors — temporal-anchoring state (ADR-37 layer 3)
-- =============================================================================
-- Layer 3 stamps the signed audit chain head into an external, independently
-- verifiable timestamp (a signed git commit, an OpenTimestamps .ots proof, an
-- RFC-3161 token) OFF the write path, fail-open. This table records which
-- heads are anchored, which are still pending, and the provider receipts, so
-- the scheduler can retry pending anchors, the verifier can check anchored
-- ones, and doctor can report state.
--
-- Unlike audit_head_signature (single latest row), anchors is multi-row: one
-- head may be anchored by more than one provider, and each anchor moves
-- pending -> anchored over its life. The (head_hash, provider) pair is unique
-- — re-stamping the same head with the same provider upserts (e.g. an OTS
-- upgrade completing the proof), rather than duplicating.
--
-- The receipt blob can be large (OTS proofs) — TEXT has no practical limit in
-- SQLite. NULL receipt is allowed while an anchor is still pending with no
-- proof yet.
--
-- Additive table → runs inside Database.exec's implicit transaction.

CREATE TABLE anchors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The chain_head_hash this anchor covers (hex).
  head_hash     TEXT NOT NULL,
  -- The provider that produced this anchor (none never persists a row).
  provider      TEXT NOT NULL,
  -- pending: submitted, not yet confirmable (retry/upgrade later).
  -- anchored: confirmed and independently verifiable.
  -- failed: the stamp attempt failed (fail-open — the write still stood).
  status        TEXT NOT NULL CHECK (status IN ('pending', 'anchored', 'failed')),
  -- Serialized, provider-specific proof (an .ots blob, a commit sha, a TSA
  -- token). NULL while pending with no proof yet.
  receipt       TEXT,
  -- When the anchor was first recorded.
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- When it moved to 'anchored' (NULL until confirmed).
  confirmed_at  TEXT,
  -- One anchor per (head, provider); re-stamping upserts on this pair.
  UNIQUE (head_hash, provider)
);

-- The scheduler polls for pending anchors to retry/upgrade.
CREATE INDEX idx_anchors_status ON anchors (status);

INSERT INTO schema_migrations (version, applied_at)
VALUES (23, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

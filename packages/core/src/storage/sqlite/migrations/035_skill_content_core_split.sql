-- mnema:disable-foreign-keys
-- =============================================================================
-- Migration 035: split skill body into core vs example for FTS weighting.
--
-- The `skills_fts.content` column (migration 009) indexed the FULL skill
-- body, including its `## Example` section, at a single weight. The skill
-- linter pushes every skill to carry an Example section, so example-only
-- tokens (sample paths, payloads, throwaway identifiers) matched search
-- queries at the same weight as the skill's real subject and produced
-- cross-topic false matches.
--
-- This splits the body: `content_core` (everything but the Example
-- sections) is indexed at full weight, `content_examples` at a very low
-- weight (see the bm25 weights in SearchService.searchSkills). The service
-- write path fills both columns for rows written after this migration;
-- SQLite has no regex, so this migration cannot split existing bodies in
-- pure SQL. To avoid losing searchability, existing rows are backfilled
-- with content_core = content and content_examples = '' — nothing is lost,
-- every existing skill still matches on its core column, and the finer
-- split takes effect the next time each skill is recorded/updated.
--
-- fts5 columns cannot be ALTERed, so skills_fts and its triggers are
-- dropped and recreated with the new column set. No view or index depends
-- on skills_fts; only SearchService reads it.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

BEGIN;

-- 1. New source columns on the base table (nullable; service fills them).
ALTER TABLE skills ADD COLUMN content_core TEXT;
ALTER TABLE skills ADD COLUMN content_examples TEXT;

-- 2. Backfill existing rows: keep the whole body searchable at core weight.
--    A pure-SQL regex split is impossible in SQLite, so the real split only
--    applies to rows (re)written after the upgrade.
UPDATE skills SET content_core = content, content_examples = '';

-- 3. Rebuild the FTS table with the split column set. Old triggers first
--    (they reference the old column layout), then the virtual table.
DROP TRIGGER IF EXISTS trg_skills_fts_insert;
DROP TRIGGER IF EXISTS trg_skills_fts_update;
DROP TRIGGER IF EXISTS trg_skills_fts_delete;
DROP TABLE IF EXISTS skills_fts;

CREATE VIRTUAL TABLE skills_fts USING fts5(
  skill_id UNINDEXED,
  slug UNINDEXED,
  version UNINDEXED,
  name,
  description,
  content_core,
  content_examples,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER trg_skills_fts_insert AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content_core, content_examples)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description,
          NEW.content_core, NEW.content_examples);
END;

CREATE TRIGGER trg_skills_fts_update AFTER UPDATE ON skills
WHEN OLD.name != NEW.name
  OR OLD.description != NEW.description
  OR OLD.content_core IS NOT NEW.content_core
  OR OLD.content_examples IS NOT NEW.content_examples
BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content_core, content_examples)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description,
          NEW.content_core, NEW.content_examples);
END;

CREATE TRIGGER trg_skills_fts_delete AFTER DELETE ON skills BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
END;

-- 4. Re-index every existing skill from its (backfilled) split columns, so
--    search survives the FTS rebuild without waiting for a re-record.
INSERT INTO skills_fts (skill_id, slug, version, name, description, content_core, content_examples)
SELECT id, slug, version, name, description, content_core, content_examples
  FROM skills;

INSERT INTO schema_migrations (version, applied_at)
VALUES (35, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;

-- =============================================================================
-- Migration 009: FTS5 for skills, memories and observations.
--
-- The three tables added in migration 008 are text-heavy and likely
-- to grow large enough that agents will reach for full-text queries.
-- This migration adds a single FTS table per kind, plus the standard
-- insert/update/delete triggers that keep them in lockstep with the
-- source rows.
-- =============================================================================

-- FTS for skills: name + description + content
CREATE VIRTUAL TABLE skills_fts USING fts5(
  skill_id UNINDEXED,
  slug UNINDEXED,
  version UNINDEXED,
  name,
  description,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

-- FTS for memories: title + content (slug also indexed because it
-- carries semantic meaning agents will query on directly).
CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED,
  slug,
  title,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

-- FTS for observations: just content (topics are short tags, already
-- queryable via the dedicated topic filter on `observations_list`).
CREATE VIRTUAL TABLE observations_fts USING fts5(
  observation_id UNINDEXED,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

-- =============================================================================
-- Triggers — skills
-- =============================================================================

CREATE TRIGGER trg_skills_fts_insert AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description, NEW.content);
END;

CREATE TRIGGER trg_skills_fts_update AFTER UPDATE ON skills
WHEN OLD.name != NEW.name
  OR OLD.description != NEW.description
  OR OLD.content != NEW.content
BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description, NEW.content);
END;

CREATE TRIGGER trg_skills_fts_delete AFTER DELETE ON skills BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
END;

-- =============================================================================
-- Triggers — memories
-- =============================================================================

CREATE TRIGGER trg_memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (memory_id, slug, title, content)
  VALUES (NEW.id, NEW.slug, NEW.title, NEW.content);
END;

CREATE TRIGGER trg_memories_fts_update AFTER UPDATE ON memories
WHEN OLD.title != NEW.title OR OLD.content != NEW.content
BEGIN
  DELETE FROM memories_fts WHERE memory_id = OLD.id;
  INSERT INTO memories_fts (memory_id, slug, title, content)
  VALUES (NEW.id, NEW.slug, NEW.title, NEW.content);
END;

CREATE TRIGGER trg_memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE memory_id = OLD.id;
END;

-- =============================================================================
-- Triggers — observations
-- =============================================================================

CREATE TRIGGER trg_observations_fts_insert AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts (observation_id, content)
  VALUES (NEW.id, NEW.content);
END;

-- Observations are append-only at the service layer, but the migration
-- still emits the standard update trigger so that any direct SQL fix
-- to a bad row stays consistent with FTS. Same for delete.
CREATE TRIGGER trg_observations_fts_update AFTER UPDATE ON observations
WHEN OLD.content != NEW.content
BEGIN
  DELETE FROM observations_fts WHERE observation_id = OLD.id;
  INSERT INTO observations_fts (observation_id, content) VALUES (NEW.id, NEW.content);
END;

CREATE TRIGGER trg_observations_fts_delete AFTER DELETE ON observations BEGIN
  DELETE FROM observations_fts WHERE observation_id = OLD.id;
END;

INSERT INTO schema_migrations (version, applied_at)
VALUES (9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

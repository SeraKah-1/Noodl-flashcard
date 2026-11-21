-- Additive migration: preserves existing deck/card/review/media IDs and history.
-- Unfiled existing decks remain at root (folder_id NULL).
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id),
  parent_key TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_unique_active_sibling ON folders(owner_id, parent_key, name_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS folders_owner_parent ON folders(owner_id,parent_id,deleted_at);
ALTER TABLE decks ADD COLUMN folder_id TEXT REFERENCES folders(id);
CREATE INDEX IF NOT EXISTS decks_owner_folder ON decks(owner_id,folder_id,deleted_at);

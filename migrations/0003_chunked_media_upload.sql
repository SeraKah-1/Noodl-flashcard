-- Support direct file uploads from embedded MCP app when host file transfer is unavailable.
-- Existing decks, media, reviews, and permissions remain untouched.
CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expected_bytes INTEGER NOT NULL CHECK(expected_bytes BETWEEN 24 AND 4000000),
  received_bytes INTEGER NOT NULL DEFAULT 0,
  next_index INTEGER NOT NULL DEFAULT 0,
  mime_hint TEXT NOT NULL,
  filename TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_uploads_owner_expiry ON media_uploads(owner_id,expires_at);
CREATE TABLE IF NOT EXISTS media_upload_chunks (
  upload_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  chunk_bytes INTEGER NOT NULL CHECK(chunk_bytes BETWEEN 1 AND 98304),
  PRIMARY KEY(upload_id,chunk_index),
  FOREIGN KEY(upload_id) REFERENCES media_uploads(id) ON DELETE CASCADE
);

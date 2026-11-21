CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS decks_owner ON decks(owner_id, updated_at);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES decks(id)
);
CREATE INDEX IF NOT EXISTS cards_deck ON cards(owner_id, deck_id, position);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  revealed INTEGER NOT NULL,
  clues_json TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  timed_out INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS reviews_owner_card ON reviews(owner_id, card_id, reviewed_at);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  provenance_json TEXT NOT NULL,
  visual_review_json TEXT NOT NULL,
  approval_json TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS media_owner ON media(owner_id, status, created_at);
CREATE TABLE IF NOT EXISTS operations (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id, id)
);

-- One-time owner-bound challenge; only the preview UI requests it after image decode.
CREATE TABLE IF NOT EXISTS media_review_challenges (
  media_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(media_id,owner_id)
);

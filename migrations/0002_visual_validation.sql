-- Apply after 0001.sql. Existing media/card/review data is not rewritten.
-- Legacy asset approvals are NOT card-specific visual approvals.
-- Card IDs are retained in the audit trail after a card is deleted.
CREATE TABLE IF NOT EXISTS visual_bindings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  media_sha256 TEXT NOT NULL,
  card_content_sha256 TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('front','back')),
  provenance_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate','source_checked','visual_checked','awaiting_user_approval','approved_for_card','attached','stale','rejected')),
  source_check_id TEXT,
  visual_check_id TEXT,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES decks(id),
  FOREIGN KEY(media_id) REFERENCES media(id)
);
CREATE INDEX IF NOT EXISTS visual_bindings_owner ON visual_bindings(owner_id,status,deck_id);
CREATE TABLE IF NOT EXISTS visual_checks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('source','visual')),
  media_sha256 TEXT NOT NULL,
  card_content_sha256 TEXT NOT NULL,
  report_json TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('model_claim','account_user')),
  created_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('pass','fail','unverifiable')),
  FOREIGN KEY(binding_id) REFERENCES visual_bindings(id)
);
CREATE TABLE IF NOT EXISTS visual_approvals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  media_sha256 TEXT NOT NULL,
  card_content_sha256 TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(binding_id) REFERENCES visual_bindings(id)
);
CREATE TABLE IF NOT EXISTS visual_approval_challenges (
  binding_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  card_content_sha256 TEXT NOT NULL,
  media_sha256 TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(binding_id) REFERENCES visual_bindings(id)
);

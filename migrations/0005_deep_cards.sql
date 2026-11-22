-- v0.8: keep original card JSON, review history and previously approved main-card images intact.
ALTER TABLE visual_bindings ADD COLUMN page_id TEXT;
CREATE INDEX IF NOT EXISTS visual_bindings_page ON visual_bindings(owner_id,card_id,page_id,status);

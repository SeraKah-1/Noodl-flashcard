-- v0.10: permanently remove human-approval challenges from active schema.
-- Historical audit rows are preserved (visual_checks and visual_approvals) for accountability.
-- Existing source+pixel-checked candidates can attach without waiting for a user click.
UPDATE visual_bindings
SET status='approved_for_card', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE status='awaiting_user_approval'
  AND source_check_id IS NOT NULL
  AND visual_check_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM visual_checks c WHERE c.id=visual_bindings.source_check_id AND c.owner_id=visual_bindings.owner_id AND c.phase='source' AND c.result='pass')
  AND EXISTS(SELECT 1 FROM visual_checks c WHERE c.id=visual_bindings.visual_check_id AND c.owner_id=visual_bindings.owner_id AND c.phase='visual' AND c.result='pass');
-- Incomplete historical candidates restart at the stage supported by actual reports.
UPDATE visual_bindings SET status='source_checked' WHERE status='awaiting_user_approval' AND source_check_id IS NOT NULL AND visual_check_id IS NULL;
UPDATE visual_bindings SET status='candidate' WHERE status='awaiting_user_approval' AND source_check_id IS NULL;
-- These challenge tokens are unused in v0.10. Keep historical approval/audit records.
DROP TABLE IF EXISTS media_review_challenges;
DROP TABLE IF EXISTS visual_approval_challenges;

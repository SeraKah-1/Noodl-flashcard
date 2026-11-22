# Noodl Flashcards v0.10 — Direct MCP Media (No Host Gate)

**Status:** source implementation tested locally. **Not deployed** to the connected Noodl plugin by this package.

## Two retired blockers

1. **Human approval barriers:** no media approval form, one-time approval challenge, or card-pair approval click. The deploy migration (`0006_retire_media_approval.sql`) removes stale challenge tables and advances historical bindings that already have both passed reports. The historical audit trail is deliberately kept.
2. **ChatGPT host-file transport:** the old `import_media_file` tool and `_meta["openai/fileParams"]` requirement have been **removed**. The embedded Noodl UI never calls `openai.uploadFile()` or `getFileDownloadUrl()`; it always uploads raw bytes over the MCP channel. There is no `file_id` argument to obtain, fake, or wait for.

This does **not** bypass required login, cross-account isolation, content checks, or the requirement that actual image bytes be accessible to the caller. Permission `full_access` cannot make an inaccessible PDF in ChatGPT Library magically readable by this worker.

## Canonical import paths

**Model/direct, small files (up to 256 KiB raw):**

`import_media_bytes({operationId,base64,mimeType,fileName,provenance})`

`base64` contains the *actual* PNG/JPEG/WebP file bytes, Base64 encoded without a data-URL prefix. No host file ID or external URL is used. The server validates Base64, magic bytes, dimensions, declared MIME, account ownership, and rejects operation-ID reuse with different bytes/source.

**Model or embedded UI, 256 KiB–4 MB:**

```
begin_media_upload({byteLength,mimeType,fileName,provenance})
  → {uploadId, chunkBytes:98304}
upload_media_chunk({uploadId,index:0,base64:'...'})
  → repeat for sequential 96 KiB raw chunks
finish_media_upload({uploadId})
  → {id,status:'approved',sha256,...}
```

The UI uses equivalent app-private tools `app_begin_media_upload`, `app_upload_media_chunk`, and `app_finish_media_upload`. Multipart `/api/media/upload` also works in standalone authenticated web hosting. Each image can be selected in a multi-file upload; no per-image confirmation dialog is needed.

**Remote images:** `import_media_url` still supports explicit allowlisted HTTPS sources with licensed/provenance metadata. Host allowlists, redirect bans, and private-address protections are deliberate SSRF protections, not human approvals.

## What happens *after* image bytes are stored?

`status: 'approved'` is a **historical database value that means bytes passed storage/integrity checks**. It is **not** a claim that the source or medical interpretation is correct. The UI displays `Disimpan (belum dicek per kartu)`.

The following flow is still required before the image can be attached:

1. `inspect_media_image({mediaId})` loads actual bytes from private R2 as MCP image output.
2. `create_visual_candidate({deckId,cardId,mediaId,side,pageId?})` binds the proposed image to the existing card + optional Deep Card page + current answer hash. Old `pending` assets are revalidated from R2 automatically here **or during attachment of an existing legacy binding**; old manual-review status cannot block an otherwise valid file.
3. `submit_source_check(...)` records source/page evidence.
4. `submit_visual_check(...)` requires inspection of **final stored pixels** and card-specific claim. Reports are model assertions, not independent medical certification.
5. `attach_visual_to_card({bindingId,expectedRevision,operationId})`, or `attach_verified_visuals_batch` for up to 40 mappings, attaches without manual approval. Hash/revision mismatch fails closed. The same media can be reused with separate checks for each card.

Incorrect/unverifiable images must be rejected rather than attached. Never fake source metadata, licenses, page numbers, image bytes, or visual inspection reports.

## Existing database migration

For a deployment currently on v0.8/v0.9, **back up existing D1 and R2**, then apply only the new migration:

`migrations/0006_retire_media_approval.sql`

Migrations `0001..0005` were previously applied to the same D1 database; do not recreate tables or switch databases. New installations run `0001..0006` in order. Migration `0006` drops only obsolete *challenge token* tables; it preserves decks, cards, folders, reviews, media objects, and visual-check audit records. It upgrades legacy `awaiting_user_approval` rows **only if both source and pixel checks passed**, and no bypass is permitted.

Deploy the Worker **and** `public/` assets to the **same** Cloudflare Worker project with its existing D1/R2 bindings; refresh the connected ChatGPT app tool registry. Do not copy older hosting project identifiers into a new project.

## Acceptance tests after real deployment

- `get_capabilities.version` is `0.10.0`, `requiresHostTransferredFileId:false`, `manualApprovalRequired:false`.
- `tools/list` includes `import_media_bytes`, `begin_media_upload`, `upload_media_chunk`, `finish_media_upload`, `inspect_media_image`, `attach_verified_visuals_batch`, but **not** `import_media_file` or any `openai/fileParams` requirement.
- Upload a genuine original image; `list_media` shows its SHA-256 and size, `inspect_media_image` actually displays those pixels, and reloaded cards still reference the media.
- Two distinct source/pixel checks are required for each target; deliberately wrong source pages, altered answers, unverified images, or another account's media must be rejected.
- Recount the existing 17 SKILL LAB decks and 351 cards before/after migration and verify reviews unchanged. Do not recreate them.
- Real images missing from model access cannot be imported automatically. If the original atlas is available only via the user's inaccessible ChatGPT Library record, send the rendered PNGs via the Noodl multi-file selector **once**, or make genuine readable bytes/verified URLs available.

## Local verification

`npm run check && npm test` and (with Python Playwright + Chromium) `python scripts/smoke_chunk_upload.py`, `python scripts/smoke_browser.py`, `python scripts/smoke_deep_cards.py`.

These browser tests simulate MCP app hosting. They establish code behavior, **not** actual transfer in the production ChatGPT app.

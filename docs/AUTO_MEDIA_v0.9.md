# Noodl Flashcards v0.9 — Auto Media, no human approval gate

**Status:** source implementation and local tests. **Not proof of a production deployment.**

## Two separate problems, two separate solutions

1. **Plugin permissions.** ChatGPT may be configured to `full_access` for **Noodl Flashcards only**. This changes ChatGPT permission prompts, but cannot override app-specific media validation or grant access to undisclosed source bytes.
2. **Transfer and manual review.** v0.8 required host-transferred `file_id` *and* two manual approval challenges. v0.9 no longer requires human review challenges and supports direct MCP chunk transfer if host file transport fails. Card-specific A/B source and visual reports still gate attachment.

The authenticated owner identity, source metadata, 4 MB/4096 px safety limits, source URL allowlist, SHA-256 integrity, card-level semantic hash, version-guarded writes and immutable review history remain intact.

## Accepted image ingestion routes

- `import_media_file` accepts `{file:{download_url,file_id?}, provenance, visualReview, operationId}`. `download_url` must pass the explicitly configured `ALLOWED_TRANSFER_HOSTS` allowlist. A host file ID is **optional** rather than required, but a real URL and actual bytes are mandatory.
- `import_media_url` permits *web* images from the explicitly configured `ALLOWED_IMAGE_HOSTS` allowlist. License and original page information are required; do not use Internet imagery as a purported original lecture slide.
- Direct **model-facing** `begin_media_upload`, `upload_media_chunk`, `finish_media_upload` accept actual file bytes in sequential Base64 fragments (96 KiB raw each). Useful only when the caller actually has the raw bytes; a ChatGPT attachment ID is not its contents.
- Embedded Noodl Settings retains `app_begin_media_upload`, `app_upload_media_chunk`, `app_finish_media_upload` and supports multi-file selection. If native ChatGPT file upload is unavailable, it sends actual bytes in chunks. The user may select all images in one operation; no per-image approval dialog follows.

After ingestion, image `status=approved` means **byte integrity and format accepted**, not **clinical or semantic accuracy approved**. The UI labels it "Disimpan (belum dicek per kartu)". Existing v0.8 `pending` assets can be promoted with `accept_legacy_media`, which reads back R2, recomputes SHA-256 and validates dimensions.

## Inspection and attachment workflow (model)

1. `list_decks` and `get_deck`/`get_card_content` to locate exact deck/card/page IDs. **Do not assume titles or card position uniquely identify content.**
2. `list_media` returns permanent IDs. If still absent, STOP: `full_access` does not magically transfer files. Use an actual source URL or raw-byte upload.
3. Call `inspect_media_image({mediaId})`. MCP returns the **real stored image as an image block**, plus its hash, dimensions and provenance. View the actual pixels and compare to source. If the image can't be inspected or labels are wrong, do not supply passing visual reports.
4. For each target card prepare two distinct reports:
   - `sourceReport` based on documented original source and page: `sourcePage`, concrete `observedLabels`, `supportedClaim`, detailed `evidenceNote`, `result:"pass"`.
   - `visualReport` based on the actual stored image: `inspectedView:"final_stored_image"`, `readability:"legible_at_phone_width"`, concrete `observedLabels`, `supportedClaim`, `countercheck`, `problems:[]`, `recommendation:"pass"`.
5. Call `attach_verified_visuals_batch` with up to 40 individual image/card mappings and one `operationId`. This does A → B → binding → **atomic attach per item**, without asking the user to approve each image. It returns a per-item success/failure receipt; **a failed batch may have partially succeeded**. Repeat with the same mapping to avoid duplicating already attached images.
6. Read `get_deck` and `list_media` again and confirm persisted image blocks on the intended card/page, after reload. The number of `approved` media does **not** mean the number of successful card attachments.

### Example batch contract (illustrative IDs only)

```json
{
  "operationId": "skill-lab-media-2026-batch-01",
  "items": [{
    "deckId": "<actual-deck-id>",
    "cardId": "<actual-card-id>",
    "mediaId": "<actual-media-id>",
    "side": "back",
    "pageId": "<actual-back-page-id-if-needed>",
    "sourceReport": {
      "sourcePage": 12,
      "observedLabels": ["label actually present", "other recognizable object"],
      "supportedClaim": "A substantive claim actually supported by source",
      "evidenceNote": "A concrete explanation of the page and the image region",
      "result": "pass"
    },
    "visualReport": {
      "inspectedView": "final_stored_image",
      "readability": "legible_at_phone_width",
      "observedLabels": ["label actually visible"],
      "supportedClaim": "Exact card answer/image match checked visually",
      "countercheck": "Actual check for wrong label, mirrored orientation or misleading crop",
      "problems": [],
      "recommendation": "pass"
    }
  }]
}
```

Do not copy these dummy values as verification. A model report is **audited self-report**, not independent clinical or scientific certification. No system can guarantee a visual is correct from two generated paragraphs alone.

## SKILL LAB recovery (17 decks, 351 cards, 32 illustrations)

- **Never recreate** the 17 existing decks or the 351 cards. Preserve owner, deck IDs, card IDs and review history.
- Confirm exact mapping of each of the **32 source images** to actual card/page IDs by reading decks and inspecting original images. Some images may be reused on multiple cards; each target gets its own A/B binding.
- The original atlas is a PDF, whereas ingestion accepts PNG/JPEG/WebP. Render individual source pages/images and verify the result before transfer. Selecting the PNGs in Settings once is a fallback when ChatGPT cannot access the attachment bytes directly.
- Record provenance `kind=slide` with exact original filename and page (not the atlas page if it is a derivative), or `kind=web` with verified source URL/license when applicable.
- If image bytes are absent, report zero imported and do not fabricate `mediaId`. If source-to-card mapping is uncertain, leave that item unattached; report it in the batch failures.

## Upgrade / deployment

**Apply to the same trusted Worker, D1 and R2 bindings as v0.8.** Back up D1 and R2 first. v0.9 needs **no new D1 migration**; old approval tables remain unused to avoid destructive schema changes. Deploy both Worker and `public/` assets; the service-worker cache key changed to `v0.9-auto-media`. Refresh/reconnect the ChatGPT plugin so the tool registry changes. Verify in the **connected** plugin:

- `get_capabilities.version` = `0.9.0`
- `mediaApproval` = `none_automated_integrity_and_two_model_reports`
- `inspect_media_image`, `attach_verified_visuals_batch`, `begin_media_upload`, `upload_media_chunk`, `finish_media_upload`, and `accept_legacy_media` are in `tools/list`
- Old `app_approve_media` and `app_approve_card_visual` are absent
- A test image uploads via chunks, survives page reload, is viewed as MCP image, attaches with A/B reports, and remains visible on the correct Deep Card page
- Existing decks, folders and reviews are unchanged; tests reject wrong source pages, wrong owner and direct image bypasses.

Do not advertise the production issue resolved until `list_media` and `get_deck` confirm real persistence on the connected user account. Permissions alone do not deploy a new Worker or change its tool schema.

## Tests

`npm run check && npm test` tests the JavaScript and real in-memory SQLite D1-like database. Browser smoke scripts exercise a mocked ChatGPT host and cannot prove production ingress/identity, actual deployed storage, or medical accuracy.

**Security remaining:** HTTPS host allowlists and SSRF blocking are essential; avoid allowing arbitrary remote URLs. Images should be attributed, no raw HTML or SVG ingestion, and image semantics still require model inspection. `full_access` permits writes/deletions through this plugin without repeated host confirmation, which has higher operational risk than ask-before-writes.

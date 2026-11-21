# ChatGPT MCP workflow

## Flashcard creation

Use `get_capabilities`, then `create_deck` with an `operationId`, `title`, and 1..100 cards. Each card has `front` and `back` content block arrays, `clues` at exactly 5/10/15 seconds, optional `timerSeconds` (10..120, default 20), and tags. Content blocks are `text`, `image` (approved asset ID), `math` (LaTeX string), and `embed` (allowlisted provider URL).

Example card:

```json
{
  "front":[{"type":"text","text":"What insulates an axon in the peripheral nervous system?"}],
  "back":[{"type":"text","text":"Schwann-cell myelin."}],
  "clues":[
    {"atSecond":5,"text":"It is a glial-cell product."},
    {"atSecond":10,"text":"It wraps peripheral axons."},
    {"atSecond":15,"text":"The glial cell starts with S."}
  ],
  "timerSeconds":20,
  "tags":["neuroscience"]
}
```

`create_deck` and `append_cards` refuse **all direct image blocks**. Only `attach_visual_to_card` may add new images after per-card A/B reports and human approval. For `update_card`, read the deck first to get its current `expectedRevision`. Every distinct mutation needs a new `operationId`; only retry the exact same action with the same ID.

## PDF/PPTX image flow

ChatGPT must first inspect the actual document. It must determine the page/slide and area that matter. A mere text description of a diagram is **not** the image. Extract/render to PNG/JPEG/WebP (for example with `scripts/extract_source.py` when available) and inspect the resulting real pixels again. If a label was cut off or is illegible, redo the crop. Then provide the generated image as a host-transferred file to MCP `import_media_file`.

The MCP tool uses `_meta["openai/fileParams"]: ["file"]`, with `{file_id,download_url,mime_type?,file_name?}`. The model also sends source provenance and concrete visual observations. The server validates bytes and dimensions and saves a pending image. The user opens the UI preview and checks the actual source, label legibility and relevance. It is impossible to silently convert a model's `legible:true` claim to `approved` without the UI review challenge and user attestation.

Asset-level approval is not enough. After it is `approved`, call `create_visual_candidate` for the exact card, then `submit_source_check` with observed source features, then `submit_visual_check` after opening the final stored image. The account user must approve the per-card preview, then `attach_visual_to_card` uses the current deck revision. Read back the card and audit receipt; NEVER use `update_card` to bypass this sequence.

For a PDF/slide with no reliable image transfer, explicitly tell the user to upload the extracted PNG through Settings. Do not fabricate a file ID or an image URL.

## Internet images

Only use images with reusable rights: CC0, CC-BY, CC-BY-SA, public domain, or explicit permission. Track the source URL, license and attribution. Do not treat generic image search results as proof of those rights. `import_media_url` validates license, requires the image host in the deployment's explicit HTTPS allowlist, rejects redirects, and holds the image for the same human review procedure. A user may reject it even if the model marked it relevant.

## Source review report

```json
{
  "provenance": {
    "kind": "slide",
    "origin": "lecture-07.pdf",
    "sourcePage": 8,
    "description": "Myelinated axon diagram with Ranvier nodes"
  },
  "visualReview": {
    "observation": "I inspected the real cropped image: a purple axon, surrounding myelin segments, and visible Ranvier-node labels. No clipping at edges.",
    "legible": true,
    "relevant": true
  }
}
```

`visualReview` is a **creator's claim**, not independent verification. If no image was actually observed, describe the limitation and require a manual user preview. A false observation is worse than omitting the image.

## UI and review

`open_deck` returns the deck ID and points to `ui://noodl-flashcards/workspace`. `app_snapshot` supplies the embedded UI with owned decks/reviews/media. `record_review` saves ratings 0..3 and `answerRevealed` status; a hidden-card swipe must use 0 or 3. `undo_review` tombstones a review event. SRS due scheduling is calculated from the event history; there is no fabricated accuracy score.

App-only `app_begin_media_review` creates a time-limited preview challenge. It is not a visual classifier and should only be used after the actual media has decoded in the embedded panel; `app_approve_media` requires the challenge, human checkboxes, and detailed note. The non-embedded page uses a same-origin REST challenge and approval route.

### v0.3 card-specific checks

1. `create_visual_candidate({deckId,cardId,mediaId,side:"back"})` returns `bindingId` with media+card hash. It requires globally approved media but creates no card image block.
2. `submit_source_check({bindingId,report:{sourcePage,observedLabels,supportedClaim,evidenceNote,result:"pass"}})` writes Check A. If the original PDF/slide has not been uploaded as verifiable bytes, source integrity remains `unverified_host_context`.
3. `submit_visual_check({bindingId,report:{inspectedView:"final_stored_image",observedLabels,readability:"legible_at_phone_width",supportedClaim,countercheck,problems:[],recommendation:"pass"}})` writes Check B. Do not submit this report unless the **final stored image** was actually inspected.
4. Open Settings > Pemeriksaan gambar per kartu. The user sees the image, card question/answer and both reports, then confirms all checks and types a review note. The app calls `app_begin_visual_approval` and `app_approve_card_visual` only after image decode and user interaction.
5. The app calls `attach_visual_to_card({operationId,bindingId,expectedRevision})`, reads fresh deck and displays the image. Every distinct card requires a distinct binding even when using the same PNG asset.
6. If content or media changes, old binding becomes stale and a fresh A/B/approval cycle is required.

For internet media, `provenance.licenseEvidenceUrl` now must reference an HTTPS page with the reuse license claim. The actual image can reside on a different approved CDN host from the source landing page; Noodl still requires `ALLOWED_IMAGE_HOSTS`. A license claim is not an independent legal audit.

## v0.5: ChatGPT folder placement

Call `list_folders` before placing a new deck, or create the destination with `create_folder` (`name`, optional `parentId`). Use the **returned ID** as `folderId` in `create_deck`—never invent a folder ID or treat the folder's display name as its ID. To relocate an existing deck, read `list_decks`/`get_deck` to obtain its latest revision, then call `move_deck_to_folder({operationId,deckId,expectedRevision,folderId})`. Relocation does not change card/review records. All folder operations are owner-scoped and revision guarded. Deleting a folder moves its immediate subfolders and decks into the parent folder; it does not delete them. See `docs/FOLDERS_v0.5.md`.


## v0.6: Checklist tilik OSCE (tanpa MCP tool tambahan)

The existing `create_deck` / `append_cards` tools accept `procedureStep` on **every** card in a checklist deck. Orders must start at 1 and remain contiguous, with original checklist item in `checklistItem`, accurate `sourceDocument` and optional `sourcePage`, optional `phase`, and `critical` true **only when marked critical by the actual source**. `clues` can be `[]`; UI automatically disables timer/clue for procedure decks and offers in-player technique/sequence practice. Media approval remains mandatory per card. On any missing/unclear source, ask for the actual checklist; do not make up procedure or claim observed competence. Existing flashcards are unchanged.

# Noodl v0.11 — Optional Visual Front & Back + hardened media pipeline

**Status:** implemented and tested in the local source package. The running ChatGPT Site is *not* updated by this archive. This is phase A+B only; **no Image Occlusion, Source Notes, Cloze, sibling burying, FSRS, or Anki `.apkg` import** in this release.

## Why this is backward-compatible

Every existing card remains valid with unchanged `front[]`, `back[]`, `backPages[]`, `procedureStep`, `clues`, review IDs and positions. The new `mediaRequirement` key is **optional**. When absent, the card is never blocked for lacking an image. A text-only card does not allocate an image box, trigger an image download, require a media ID, or require image approval. The default is nonblocking even if an optional picture cannot load.

Allowed explicit values:

- `none`: no visual is needed.
- `optional`: visual is supplemental and never prevents a review.
- `required_for_question`: the user cannot answer this **specific card** without the question image. At least one front-side asset must be present, storage-approved, and physically available in R2 before a rating can be saved.

`mediaRequirement` is not a global deck or app flag. A card with `required_for_question` but no front image may be saved as a **draft awaiting media**. It cannot receive a review until an actual front image is attached. The UI skips such cards in ordinary review sessions; OSCE sequences keep their original order but the incomplete step cannot receive a rating. The browser also requires the real `<img>` to decode before rating; the server independently checks owner authorization, database state and `R2.head`. A browser bypass cannot fabricate a successful review.

### Payloads

Ordinary text card (old structure, **no new field**):

```json
{
  "front": [{"type": "text", "text": "Apa fungsi insulin?"}],
  "back": [{"type": "text", "text": "Mengatur metabolisme glukosa."}],
  "clues": [
    {"atSecond": 5, "text": "Hormon"},
    {"atSecond": 10, "text": "Pankreas"},
    {"atSecond": 15, "text": "Sel beta"}
  ]
}
```

A visual-identification question awaiting a real image:

```json
{
  "front": [{"type": "text", "text": "Identifikasi temuan pada radiograf berikut."}],
  "back": [{"type": "text", "text": "Jawaban bergantung pada radiograf spesifik yang dipasang."}],
  "mediaRequirement": "required_for_question",
  "clues": [
    {"atSecond": 5, "text": "Periksa orientasi dan kualitas gambar"},
    {"atSecond": 10, "text": "Tinjau lokasi perubahan densitas"},
    {"atSecond": 15, "text": "Bandingkan struktur sekitar"}
  ]
}
```

This second card is **not ready for study** until an actual `front` image is attached by the validated media workflow. The sample answer is intentionally non-diagnostic.

## Media transfer and binding pipeline

1. Read source PDF / PPTX / image and identify an *actual* relevant crop. If the card does not need media, stop here and write a normal text card.
2. Upload actual bytes with `import_media_bytes` (≤256 KiB) or `begin_media_upload` → `upload_media_chunk` → `finish_media_upload` (larger, up to 4 MB). `provenance` uses `kind` (`file`, `slide`, `web`, `generated`, `manual`), `origin` and, for slides, `sourcePage`. Do not use host `file_id`.
3. Confirm the resulting image appears in `list_media`, with actual stored length and checksum. For visual relevance, call `inspect_media_image` and inspect the **stored pixels**, not the source filename.
4. Supply source and visual reports to the existing card-specific validators. Use `side: "front"` for a question image, `side: "back"` for the answer, and optionally `pageId` for an existing Deep Card page. The UI Settings image picker also exposes these three destinations.
5. Attach to the exact card using `attach_verified_visuals_batch` or the individual candidate → checks → attachment tools. Do not directly write image blocks through `update_card` or `patch_card_content` (blocked by server).
6. Re-read `get_deck` or `get_card_content` and check `get_card_media_status`. Verify the *front image actually decodes* in the player and is still visible after refresh.
7. Repeated operations use idempotency keys; image relevance reports and account ownership are enforced independently of write permissions. No manual approval tokens.

Example MCP read check:

```json
{"deckId":"<existing-deck-uuid>","cardId":"<existing-card-uuid>"}
```

Call `get_card_media_status` with the above. It returns `requirement`, `ready`, `requiredImageIds`, `missingImageIds` and `reason`. For plain cards `ready=true` even with zero images. Do not substitute invented IDs.

To change *only* whether an existing card needs an image, first `get_card_content`, then call `patch_card_content` with the current `expectedRevision` and:

```json
{"op":"set_media_requirement","mediaRequirement":"required_for_question"}
```

Pass `null` to remove the explicit field. This edit does **not** invalidate existing source/visual evidence when the actual clinical claims have not changed. Edits that change the question or answer still trigger the existing relevance invalidation rules.

## UI and touch navigation

- Full surface of question and answer accepts images or text, with no empty media placeholder on text-only cards.
- Click/tap a picture to open the separate zoom viewer. Zoom via +/−, mouse wheel, double click, or two fingers; drag/pan within the viewer. The flashcard's swipe and rating handlers cannot receive gestures while the modal is open.
- Image display maintains original aspect ratio (`object-fit: contain`). Never crop medical evidence to fill the frame.
- Front swipes still rate *only* when the question is actually ready. A required image that fails to load disables rating and allows **Skip** without a review event. Optional images cannot block text study.
- Deep Cards, timed cards, OSCE order, long text reader, and Undo retain their v0.10.1 behavior.

## Failure modes / safeguards

| Case | Expected behavior |
|---|---|
| Legacy text-only or OSCE | Unchanged, review works without media |
| `optional` with no image | Valid, no image box, review works |
| `required_for_question` with no front image | Save as draft, never review; ordinary session skips |
| Image in back only, required for front | Still blocked; back images do not satisfy a question |
| Image in extra Deep Card page | Card-specific validation applies; does not count as question image |
| Missing R2 object despite `approved` row | Review rejected by server; earlier reviews retained |
| Image bytes exist but browser cannot decode | UI disables rating; Skip remains available |
| Zoom with finger / pointer | Viewer owns gestures, card swipe paused |
| Changing only media requirement | Supported by targeted MCP patch, preserves image and review IDs |
| Changing visual claim / source page | Existing semantic image binding must be revalidated |
| Hidden sibling cards / occlusion | Not implemented yet, not assumed |

## Test commands

```bash
npm run check
npm test
python scripts/smoke_visual_front_v011.py
python scripts/smoke_deep_cards.py
python scripts/smoke_osce.py
```

Python Playwright/Chromium browser tests run against a local simulated environment, **not the production ChatGPT MCP connector**. Production acceptance requires version check, a real image ingress, byte readback, front attachment, `get_card_media_status.ready=true`, a real client image decode, and a persisted review. Do not say a user's decks were updated until these steps succeed against the connected deployment.

## Upgrade / deployment

Upgrade Worker and static assets on the **same trusted ChatGPT Site, D1 and R2**. No new D1 migration is required for v0.11 (`mediaRequirement` lives in existing card JSON); earlier migrations through `0006` must already have been applied. Update service-worker cache and **refresh the MCP tool registry** so `get_card_media_status` becomes visible. Do not deploy this by replacing the DB or deleting 17 decks / 351 cards.

Do not grant untrusted clients ownership headers. Worker access remains restricted to authenticated, trusted Sites proxy requests.

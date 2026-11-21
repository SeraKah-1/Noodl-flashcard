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

`create_deck` and `append_cards` refuse referenced media unless R2 metadata is in `approved` state for the same owner. For `update_card`, read the deck first to get its current `expectedRevision`. Every distinct mutation needs a new `operationId`; only retry the exact same action with the same ID.

## PDF/PPTX image flow

ChatGPT must first inspect the actual document. It must determine the page/slide and area that matter. A mere text description of a diagram is **not** the image. Extract/render to PNG/JPEG/WebP (for example with `scripts/extract_source.py` when available) and inspect the resulting real pixels again. If a label was cut off or is illegible, redo the crop. Then provide the generated image as a host-transferred file to MCP `import_media_file`.

The MCP tool uses `_meta["openai/fileParams"]: ["file"]`, with `{file_id,download_url,mime_type?,file_name?}`. The model also sends source provenance and concrete visual observations. The server validates bytes and dimensions and saves a pending image. The user opens the UI preview and checks the actual source, label legibility and relevance. It is impossible to silently convert a model's `legible:true` claim to `approved` without the UI review challenge and user attestation.

Only once the image status is `approved` should ChatGPT read a deck and call `update_card` or create a card with `{type:"image",assetId:"...",alt:"..."}` in front/back blocks. Read back the card to verify it has the intended asset ID.

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

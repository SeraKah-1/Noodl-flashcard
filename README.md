# Noodl Flashcards

**Flashcards only. ChatGPT makes content; Noodl saves and reviews it.**

A new, independent prototype inspired by the visual language of [Noodl](https://github.com/SeraKah-1/noodl) and the MCP/data boundaries of [Noodl-GPT](https://github.com/SeraKah-1/noodl-gpt). The upstream sources were **not modified**. This project intentionally does **not** carry over quiz generation, MCQ sessions, provider API keys, Brain Dump, Smart Sweep, comics, visual labs, or simulation tools.

The implementation is **dependency-free browser JavaScript and a Cloudflare Worker**, rather than a direct copy of upstream React. The goal is a lean independent implementation with real tests and a functional offline local demo. If a React source-to-source migration is required later, treat that as a separate implementation choice, not something already completed here.

## What actually works

- Four destinations: **Home, Decks, Review, Settings**; original-inspired violet, translucent, kaomoji and floating dock design.
- Flashcard text, images, math-as-readable-source fallback, and opt-in provider-allowlisted YouTube/Vimeo embeds.
- **Swipe left/right before the answer is revealed**, or after flipping. Hidden-card swipe is recorded as self-assessment, never verified correctness. Buttons and keyboard alternatives are provided.
- **20-second monotonic timer**, local progressive clue reveals at **5/10/15 seconds**, no forced failure when time expires; tab hiding and answer reveal pause the timer.
- Four post-reveal ratings, Undo, due review replay from immutable review events, local IndexedDB saving and cloud review outbox.
- Local demo deck and local image upload. Uploaded media is decoded, previewed, checked against source/labels/relevance, explicitly approved, then can be attached to an existing local card.
- Production-oriented Worker MCP: deck create/read/append/edit/delete, due reviews, review/undo, media transfer, public-source import, restricted UI tools; D1 for records, private R2 for media.
- Image import rejects SVG/HTML, wrong magic type, oversize bytes/pixels, private hosts, mismatched content type, and HTTP redirects. Remote sources require explicit approved host allowlists; website image sources additionally require a reusable license.
- **Images cannot be referenced by cloud flashcards while `pending`**. Human approval requires an actually decoded preview and a one-time owner-bound server challenge. The review record includes image SHA-256 and source provenance.
- Local helper for actual **PDF/PPTX slide-to-PNG crops** with a provenance manifest. It renders the *composed slide*, including labels/arrows, not merely embedded image files.

## Run immediately (no npm install needed)

Requires Node.js 22 or newer.

```bash
npm run dev
# Visit http://localhost:3000

npm run check
npm test
# Optional, if Python Playwright + Chromium are installed:
python scripts/smoke_browser.py
python scripts/smoke_gestures.py  # actual Chromium mouse + touch gesture regression
```

## Smooth whole-card swiping (v0.2.0)

- Drag **left or right** from any part of the card, including its middle text, approved images, and back face. A successful drag moves to the next card and records the selected review rating: **left = Lupa (0), right = Mudah (3)**. These are self-ratings, not verified correct/incorrect answers.
- The card follows the pointer and exits toward the selected direction before the next one slides in. Reversing direction mid-drag uses the **final displacement**. Short/vertical drags do not rate or flip the card. Swipe works before revealing an answer.
- **Undo** returns to the previous rated card and voids that review event. A single tap on the card flips it; tap an approved image to zoom. Native vertical scrolling remains available when content is long; embedded video controls are not hijacked.
- The player uses pointer capture to keep tracking when the finger/mouse leaves the card, but handles the browser's old-child `lostpointercapture` event correctly. Browser tests cover desktop mouse and touchscreen input, including image-center drag and the image tap/zoom exception.
- The service worker cache version was updated so previously cached app.js/styles.css aren't reused after redeploy.

See [gesture design and QA](docs/SWIPE_GESTURES.md) for details.

`npm run dev` is a **local-only browser preview**. It shows a built-in sample deck and supports review/media approval in IndexedDB. It does **not** simulate an authenticated ChatGPT Sites Worker or D1/R2 cloud. A local demo passing is not evidence of a live ChatGPT connector.

For a source file:

```bash
python -m pip install -r scripts/requirements-media.txt
python scripts/extract_source.py --input lecture.pdf --page 3 --output slide3.png
python scripts/extract_source.py --input anatomy.pptx --page 7 --output slide7.png \
  --crop 0.1 0.1 0.8 0.8
```

PPTX rendering additionally requires LibreOffice. Both commands create `*.png.review.json` with `status: pending_review` and SHA-256. **Do not mark a render scientifically correct without actually inspecting it**. Upload the resulting PNG to Noodl or give it to ChatGPT for `import_media_file`.

## Cloud / ChatGPT deployment: configuration work required

This source is **not deployed**. Do not copy the old `.openai/hosting.json`: its project ID belongs to the source project. Create an independent Sites project with fresh D1 and R2 bindings, then explicitly connect the new `/mcp` endpoint to a new ChatGPT plugin/connector. See [Deployment & security](docs/DEPLOYMENT.md).

`TRUSTED_SITES_PROXY` is **false by default**. The Worker deliberately returns 401 unless the trusted hosting layer authenticates the user and injects `oai-authenticated-user-id`. **Never** enable it on a publicly reachable generic Cloudflare Worker accepting arbitrary user-supplied identity headers. This project does not implement OAuth itself.

`ALLOWED_TRANSFER_HOSTS` and `ALLOWED_IMAGE_HOSTS` are also empty by default. Configure only hosts you actually trust and verify in the live host (not blanket internet access). Remote-image import will fail closed until configured. Specific ChatGPT file-download hosts must be observed and vetted from the connected deployment.

## Planned v1: double-check visual evidence for every card

The companion [Visual Validation MCP Specification v1](docs/VISUAL_VALIDATION_MCP_SPEC_v1.md) and its [machine-readable JSON schema](docs/VISUAL_VALIDATION_MCP_SCHEMA_v1.json) define an **additional, proposed** source-check → final-pixel visual-check → per-card user-approval sequence. They are **not implemented by this v0.2 prototype**. Today v0.2 has a real owner-bound user preview/approval gate for each asset; it does not store independent source and visual check receipts, nor bind image verification to a particular card answer/revision. Do not describe the current application as double-verified or scientifically certified. The example data is fictional and does not establish medical correctness.

## Strict image workflow (not optional)

1. ChatGPT visually examines the real material or extracted crop; saves observed labels/shapes and actual page/slide in the `visualReview` and `provenance` fields. If ChatGPT cannot see the image, it must **not** claim that it inspected it.
2. Use `import_media_file` with the ChatGPT-transferred `file_id` and temporary `download_url`, or `import_media_url` only for licensed sources on configured allowlisted HTTPS hosts.
3. Server verifies binary signature (PNG/JPEG/WebP only), dimensions, size, source metadata and owner; saves file to **private R2** as `pending`.
4. User opens full-resolution preview. The browser must successfully decode the actual image bytes before requesting a one-time review challenge. User confirms correct source, legible labels, concept relevance and writes a concrete note.
5. Server rechecks owner and challenge before switching to `approved`. Cloud deck writes refuse any image that is still pending. To attach, ChatGPT gets the approved `assetId` and uses `update_card`, or the user attaches locally through the Settings UI.
6. If the image is wrong, illegible, misleading, unsupported or unlicensed, reject it. The user can request a different crop or illustration.

**Important limitation:** Image format/dimension validation is automated. Visual/semantic correctness is not independently proven by a machine classifier. The host cannot cryptographically prove that ChatGPT or a human looked at every pixel. The actual full-size preview + an explicit account-user attestation is the verification gate; it must not be described as autonomous scientific certification.

## MCP architecture

`POST /mcp` implements MCP JSON-RPC `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read` (plus ping). It publishes `ui://noodl-flashcards/workspace` for the ChatGPT embedded UI. `import_media_file` declares `_meta["openai/fileParams"]:["file"]` with `download_url`/`file_id` data from the host.

The browser uses the connected widget's `window.openai.callTool` when available; otherwise it tries same-origin `/api` and finally local-only mode. The ChatGPT-provided file download URL is used **once** for import; only the permanent R2 asset ID is kept in the flashcard.

Tools are listed and explained in [MCP workflow](docs/MCP_WORKFLOW.md). UI `app_*` tools are not advertised to the model via visibility flags, but actual host permissions must still be confirmed in the live deployment.

## Test evidence and gaps

- Local Node tests use real SQLite through `node:sqlite` for revision guards, owner isolation, immutable review undo and the media approval workflow.
- Headless Chromium DOM/component smoke was performed using in-memory page content because this environment blocks browser navigation to localhost. It covered desktop/mobile home/player, flip, rating, Undo, full-size image decode, manual approval and attaching an image to a flashcard.
- PDF crop **and PPTX composed-slide conversion** were rendered and their output images visually inspected with local test fixtures.
- **Not verified:** a real ChatGPT MCP connection, trusted Sites identity headers, actual D1/R2 bindings, a deployed worker, host file transfer, production browser offline cache, live automatic PPTX-slide rendering inside Sites, arbitrary internet image rights, and mobile touch hardware. Production is not ready until those pass.
- The local source extraction script is not a server-side PPTX/PDF render endpoint. In ChatGPT, the model must create an actual image crop before calling `import_media_file`; receiving a PDF file in `import_media_file` will correctly reject it as not an image.
- The embedded UI uses a compatibility file/bridge API; live ChatGPT host behavior must be checked. This repo currently has no ready-to-install plugin registration bound to a newly created Sites project.

The complete scope and future PR gates are retained in [MASTER_PLAN](docs/MASTER_PLAN.md). The present implementation is an actual working **prototype**, not a claim that the full plan's deployment and production media pipeline have been completed.

## License

MIT. Retains the attribution of Noodl and M. Farrel Aditya, as present in the source repositories. See [LICENSE](LICENSE).

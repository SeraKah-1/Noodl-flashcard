# Noodl Flashcards v0.11 — Optional Visual Front & Back

**Phase A+B is implemented in source.** Front and back images can be attached via the existing authenticated MCP visual checks, while **all text-only cards remain valid without any media requirement**. Image zoom/pan, required-question-image guard, missing-file checks and `get_card_media_status` are included. No Image Occlusion, Source Notes, Cloze, FSRS, or Anki `.apkg` support has been added yet.

Full specifications, end-to-end pipeline, edge cases and safe deployment: **[Optional Visual Cards v0.11](docs/OPTIONAL_VISUAL_CARDS_v0.11.md)**. Sample payloads: **[examples/OPTIONAL_VISUAL_CARDS_v0.11.json](examples/OPTIONAL_VISUAL_CARDS_v0.11.json)**.

```bash
npm run check
npm test
python scripts/smoke_visual_front_v011.py
python scripts/smoke_deep_cards.py
```

**Production warning:** this archive does not deploy the worker or import any user images. Keep the existing D1 database and R2 bucket when upgrading, then refresh MCP tool discovery. No new database migration is required beyond existing v0.10.1 migrations.

---

# Noodl Flashcards v0.10.1 — Direct Media, No Human/Host Gate

**This release changes the image-ingestion architecture.** The old host-transferred `file_id` tool is **removed**, not kept as the preferred path: the embedded panel sends real image bytes directly through MCP chunks. ChatGPT can also call `import_media_bytes` for small images or the same chunk tools for larger ones. No one-time human approval tokens or image/card confirmation buttons remain. Server-side authentication, byte integrity and card-specific source/pixel checks stay mandatory.

See **[Direct MCP Media v0.10](docs/DIRECT_MCP_MEDIA_v0.10.md)** for the exact tools, migration, production verification, and limitations. Legacy release notes below are historical and *do not* describe the current media path.

Run: `npm run check && npm test` (Node.js 22+). Browser smoke tests: `python scripts/smoke_chunk_upload.py`, `python scripts/smoke_browser.py`, `python scripts/smoke_deep_cards.py` (Chromium + Playwright).

**Deployment status:** source and local browser simulation only. The connected production MCP/Worker still needs a deliberate deployment to these exact code bytes and the same D1/R2 storage; `full_access` permission alone does not deploy the code or grant the Worker access to invisible ChatGPT Library file bytes.

---

# Noodl Flashcards v0.9 — Auto Media + Full MCP Content Editor

**Local source release, not the connected production plugin.**

- **No human media approval screens or approval MCP tools.** Verified-format PNG/JPEG/WebP can be stored immediately; per-card attachment still requires two model-reported checks of source and final pixels.
- **Actual-image MCP inspection:** `inspect_media_image` sends owner-authenticated stored image pixels to ChatGPT as an image block with SHA-256/provenance, so ChatGPT can inspect rather than relying solely on filenames.
- **Batch attachment:** `attach_verified_visuals_batch` handles up to 40 card–image associations per operation; preserves existing 17 SKILL LAB decks / 351 cards and review IDs if deployed to the same D1/R2.
- **Host file transfer fallback:** `begin_media_upload` → `upload_media_chunk` → `finish_media_upload` for real Base64 bytes; embedded Settings still supports selecting many PNG/JPEG/WebP images in one operation. `import_media_file` no longer rejects a valid download URL solely for a missing host `file_id`.
- **No AI-provider key inside Noodl.** ChatGPT authors cards, validates image relevance, reads/patches Deep Cards via MCP.
- **Owner isolation, visual content/hash/revision checks, remote HTTPS allowlist, explicit provenance, and offline-safe review history are preserved.**
- **The old v0.8 approval screens and tool actions have been removed.** Previous image approval database tables are left unused for safe upgrades.

[Full technical workflow, examples and deployment instructions](docs/AUTO_MEDIA_v0.9.md).

```bash
npm run check
npm test
npm run dev
```

This code does not itself upload the 32 SKILL LAB images into the connected app. Deployment needs the existing trusted Cloudflare Worker/D1/R2 and refreshed ChatGPT MCP registry. Once connected, successful import and attachment must be independently confirmed using `list_media` and `get_deck`.

---

## Historical release notes (v0.1–v0.8; older manual-approval instructions below are superseded by v0.9)

# Noodl Flashcards

**Flashcards only. ChatGPT makes content; Noodl saves and reviews it.**

A new, independent prototype inspired by the visual language of [Noodl](https://github.com/SeraKah-1/noodl) and the MCP/data boundaries of [Noodl-GPT](https://github.com/SeraKah-1/noodl-gpt). The upstream sources were **not modified**. This project intentionally does **not** carry over quiz generation, MCQ sessions, provider API keys, Brain Dump, Smart Sweep, comics, visual labs, or simulation tools.

The implementation is **dependency-free browser JavaScript and a Cloudflare Worker**, rather than a direct copy of upstream React. The goal is a lean independent implementation with real tests and a functional offline local demo. If a React source-to-source migration is required later, treat that as a separate implementation choice, not something already completed here.

## v0.8 — Deep Cards + direct MCP content access

- **Multi-page answer:** one flashcard has a short `back` plus optional `backPages[]` (up to 12 extra pages) for procedure, normal/abnormal findings, differential interpretation, visual, sources, and explanations. Existing one-page cards continue unchanged.
- On a Deep Card's **back**, swipe left/right turns answer pages without rating. Rating is via the existing four buttons. On the **front**, swipe still rates the card. Vertical scrolling and the long-text reader remain accessible, even on 320px phones.
- **Direct MCP read/edit:** `get_card_content`, paginated `list_card_contents`, `search_card_contents`, and revision-guarded `patch_card_content` let ChatGPT read the exact stored contents and update just one page or field while preserving card IDs, all other pages, folders, and review history. The live player offers **Perbarui isi** when connected to refresh content after external edits.
- **Verified media per page:** `create_visual_candidate` now accepts optional `pageId`; the same source check → final-image check → human approval workflow binds the image to the correct card **and page**. New SQL migration `migrations/0005_deep_cards.sql` adds a nullable `page_id` to visual bindings. Unapproved images cannot be inserted via `patch_card_content`.
- Browser regression: desktop mouse and actual Chromium touch at 390px and 320px. New `scripts/smoke_deep_cards.py`. See [Deep Cards and MCP manual](docs/DEEP_CARDS_MCP_v0.8.md).
- **Local source only** until redeployed against the existing trusted ChatGPT Worker/D1/R2; do not assume the connected plugin already has v0.8.

## v0.7 — long text no longer becomes inaccessible

- Fixed overflowing centered card content so the first line stays reachable and the full text scrolls in both card faces.
- Added a **Baca lengkap** reading panel with its own vertical scroll, front/back tabs (no premature answer reveal), and optional `explanation.sections` for detailed reference material.
- Old cards keep their full `front` and `back` content. No truncation and no new SQL migration. Cloud media approval remains mandatory; explanation cannot sneak unapproved images into a card.
- Test `python scripts/smoke_long_text.py`; details and deployment gates in [docs/LAYERED_READING_v0.7.md](docs/LAYERED_READING_v0.7.md).
- **Local source release only; v0.7 has not been deployed to the active ChatGPT Noodl plugin.**

## What actually works

- Four destinations: **Home, Decks, Review, Settings**; original-inspired violet, translucent, kaomoji and floating dock design.
- Flashcard text, images, math-as-readable-source fallback, and opt-in provider-allowlisted YouTube/Vimeo embeds.
- **Swipe left/right before the answer is revealed**, or after flipping. Hidden-card swipe is recorded as self-assessment, never verified correctness. Buttons and keyboard alternatives are provided.
- **20-second monotonic timer**, local progressive clue reveals at **5/10/15 seconds**, no forced failure when time expires; tab hiding and answer reveal pause the timer.
- Four post-reveal ratings, Undo, due review replay from immutable review events, local IndexedDB saving and cloud review outbox.
- Local demo deck and local image upload. Uploaded media is decoded, previewed, checked against source/labels/relevance, explicitly approved, but two-check media attachment requires the connected v0.4 backend; the local browser cannot claim this verification.
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

## v0.4 repair: host-independent image transfer and readback

The original live upload blocker was `A host-transferred file_id is required`. A `file_...` from chat or an extracted sandbox image is **not automatically transferred to the plugin**. The official file-input metadata (`_meta["openai/fileParams"]`) remains the preferred route when ChatGPT supports host transfer. It cannot be faked by passing the filename or chat file ID as an ordinary string.

**New fallback for images selected directly from Noodl Settings:** the embedded UI opens the user's PNG/JPEG/WebP file and sends binary data via app-only MCP tools `app_begin_media_upload`, `app_upload_media_chunk`, and `app_finish_media_upload`. Each ordered request carries at most **96 KiB** of raw bytes encoded as Base64. D1 stages the data under the authenticated owner with a 30-minute expiry (at most eight active uploads per owner). On completion the Worker validates length, MIME/signature and dimensions, saves **private R2 media**, deletes staging rows, and returns a `pending` media ID. The file is not automatically approved or attached.

**New readback fallback:** when the embedded browser cannot show private `/api/media/<id>` images, it calls `app_get_media_chunk` for owner-checked ranged R2 bytes, reassembles the *original bytes*, checks SHA-256 against the media record, and displays the verified result. Incomplete or mismatched images remain blocked from approval. A transient data URL is not persisted in the cloud or IndexedDB account cache.

**This does NOT automatically extract a PDF received in the model chat to a host-transferred PNG.** Users can upload the six already extracted original slide PNGs in Settings (now supports selecting several images). ChatGPT-host transfer works only when the host authorizes and provides the required file object. This is a tested code-level workaround, not proof that the installed production plugin is updated.

```sh
npm run check
npm test
python scripts/smoke_chunk_upload.py  # Browser simulation of host without native file transfer
```

`migrations/0003_chunked_media_upload.sql` must be applied **after** `0001.sql` and `0002_visual_validation.sql`; for an existing v0.3 deployment, apply **only 0003** after a database backup. Restart/refresh the ChatGPT plugin tool registry and service worker. See [deployment](docs/DEPLOYMENT.md) for live release gates.

## Cloud / ChatGPT deployment: configuration work required

This source is **not deployed**. Do not copy the old `.openai/hosting.json`: its project ID belongs to the source project. Create an independent Sites project with fresh D1 and R2 bindings, then explicitly connect the new `/mcp` endpoint to a new ChatGPT plugin/connector. See [Deployment & security](docs/DEPLOYMENT.md).

`TRUSTED_SITES_PROXY` is **false by default**. The Worker deliberately returns 401 unless the trusted hosting layer authenticates the user and injects `oai-authenticated-user-id`. **Never** enable it on a publicly reachable generic Cloudflare Worker accepting arbitrary user-supplied identity headers. This project does not implement OAuth itself.

`ALLOWED_TRANSFER_HOSTS` and `ALLOWED_IMAGE_HOSTS` are also empty by default. Configure only hosts you actually trust and verify in the live host (not blanket internet access). Remote-image import will fail closed until configured. Specific ChatGPT file-download hosts must be observed and vetted from the connected deployment.

## Implemented in v0.3+ source: card-specific double-check + human approval

The companion [Visual Validation MCP Specification v1](docs/VISUAL_VALIDATION_MCP_SPEC_v1.md) and its [machine-readable JSON schema](docs/VISUAL_VALIDATION_MCP_SCHEMA_v1.json) define an **additional, proposed** source-check → final-pixel visual-check → per-card user-approval sequence. The v0.3+ source implements the ordered check receipts and card-bound approval gate. The *currently connected live plugin* may still be v0.2; a source code update is not a deployment. The server still cannot independently prove scientific correctness, only enforce audit states, hashes, and explicit account-user approval. Do not describe the current application as double-verified or scientifically certified. The example data is fictional and does not establish medical correctness.

## Strict image workflow (not optional)

1. ChatGPT visually examines the real material or extracted crop; saves observed labels/shapes and actual page/slide in the `visualReview` and `provenance` fields. If ChatGPT cannot see the image, it must **not** claim that it inspected it.
2. Use `import_media_file` with the ChatGPT-transferred `file_id` and temporary `download_url`, or `import_media_url` only for licensed sources on configured allowlisted HTTPS hosts.
3. Server verifies binary signature (PNG/JPEG/WebP only), dimensions, size, source metadata and owner; saves file to **private R2** as `pending`.
4. User opens full-resolution preview. The browser must successfully decode the actual image bytes before requesting a one-time review challenge. User confirms correct source, legible labels, concept relevance and writes a concrete note.
5. Server rechecks owner and challenge before switching to `approved`. Cloud deck writes refuse **all new image blocks**, even from an approved asset. First create a card-specific visual candidate, submit source check A and final-image check B, obtain explicit user approval, then use `attach_visual_to_card`. The local demo cannot bypass this gate.
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

## v0.3 evidence-bound media operations

The live v0.2 media importer was observed to reject a local/ChatGPT-generated file ID with `A host-transferred file_id is required`. **It did not import any image**. A file ID from an attachment or generated sandbox file is not necessarily authorized for the MCP plugin. The host must explicitly transfer the file, or the user must upload through the app.

New v0.3 MCP tools: `create_visual_candidate`, `submit_source_check`, `submit_visual_check`, `list_visual_candidates`, `get_card_visual_audit`, `app_begin_visual_approval`, `app_approve_card_visual`, `attach_visual_to_card`.

Image lifecycle: `pending` binary → real preview + account user asset approval → candidate for existing card → A source report → B final stored-image report → user approval for exact card → atomic attach. `cardContentSha256` ignores already attached image blocks so adding the approved image does not invalidate the card's question/answer content; editing front/back text **does** invalidate it. Imported slides without original source-document bytes kept on the server remain truthfully labeled `unverified_host_context`. No AI report is independent medical certification.

Test UI: `python scripts/smoke_visual_ui.py` uses a **mocked ChatGPT host** to validate the exact image preview, report display, user controls and attach callback. This is NOT a real MCP transfer or live deployment test.

---

## v0.5 — Nested folders (new)

**New:** folder tree in My decks (create, open, rename, move, delete folder), move any existing deck into a folder, global folder/deck search, and context-aware ChatGPT creation inside the selected folder. Backups include `folders`. Each account has an isolated folder tree, with a maximum of six nested levels. Deleting a folder relocates its decks and child folders to its parent without deleting any cards or review history; name collisions fail safely.

**MCP tools:** `list_folders`, `create_folder`, `rename_folder`, `move_folder`, `delete_folder`, `move_deck_to_folder`; `create_deck` accepts an optional `folderId`. Reads and snapshots include folder metadata. Existing image-approval gates are unchanged.

**Migration:** for a database already on v0.4, back up and apply only `migrations/0004_folders.sql` before deploying the updated Worker and UI. Existing decks remain at root until moved. For a new database, apply migrations `0001` through `0004` in order. See [docs/FOLDERS_v0.5.md](docs/FOLDERS_v0.5.md) for tool parameters, deletion semantics, migration checks, and test instructions.

**Verification:** `npm run check` and `npm test` (38 tests passed in local environment), plus browser interaction tests in desktop and 390px mobile view. Live ChatGPT plugin deployment and migrations on the existing private database are **not yet performed**. This ZIP does not itself activate the feature on the user's connected plugin.

## Daftar tilik OSCE, tanpa aplikasi kedua

Buat deck dengan `procedureStep` pada setiap kartu. Player otomatis mengenali tilik, mempertahankan urutan, menyediakan **Pelajari teknik** dan **Ingat urutan** di kartu yang sama, dan menonaktifkan timer/clue selama latihan prosedur. Foto alat/tindakan hanya dapat dipakai setelah pemeriksaan gambar dan persetujuan. Baca `docs/OSCE_TILIK_IMPORT.md` dan contoh **bukan panduan medis** di `examples/OSCE_TILIK_DEMO_NOT_OFFICIAL.json`. Versi ini **tidak perlu migrasi database baru**; plugin produksi tetap perlu upgrade agar opsi tilik tersedia.

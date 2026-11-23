# v0.11 deployment addendum

Upgrade Worker, `public/`, `shared/mediaPolicy.js`, and the MCP registry together. Keep current trusted Site identity proxy, D1 and R2 bindings; run no new SQL migration for this release. Verify `get_capabilities().version === "0.11.0"`, and that `get_card_media_status` exists among `tools/list`. See [the full v0.11 acceptance checklist](OPTIONAL_VISUAL_CARDS_v0.11.md).

Do not interpret local tests or tool schema changes as evidence that 32 SKILL LAB images have been uploaded to production.

---

**v0.10 IMPORTANT:** Follow [`DIRECT_MCP_MEDIA_v0.10.md`](DIRECT_MCP_MEDIA_v0.10.md), migration `0006_retire_media_approval.sql`, and v0.10 production acceptance checks. Older deployment notes below may reference obsolete host-transfer/approval mechanisms.

# CURRENT: v0.9 deployment instructions

Follow [AUTO_MEDIA_v0.9.md](AUTO_MEDIA_v0.9.md) for the current protocol. **Historical instructions below for v0.3–v0.8 contain obsolete manual approval steps; do not use them when deploying v0.9.**

---

# Deployment and release gates

The local demo is independent of a cloud account. Production depends on a **new** authenticated ChatGPT Sites project with fresh durable resources. Do not reuse source project IDs, D1 databases, R2 buckets or user data without a separately authorized migration.

## Preconditions

1. New isolated Sites app/project with a trusted host layer that authenticates the user **and strips/supplies** the identity header. This source treats `oai-authenticated-user-id` as an attestation only from that trusted platform. A generic public Cloudflare Worker does not satisfy this boundary; keep `TRUSTED_SITES_PROXY=false` there.
2. New D1 database + new R2 private bucket bindings named `DB` and `MEDIA`; apply `migrations/0001.sql`, **then** `migrations/0002_visual_validation.sql`, **then** `migrations/0003_chunked_media_upload.sql`. For an existing v0.2 database, back up first and apply **only 0002 + 0003**. For an existing v0.3 database, apply **only 0003**. If using Wrangler outside Sites, create a new project with private authentication/OAuth **before** enabling the REST/MCP routes. `wrangler.jsonc.example` is deliberately non-deployable without replacing IDs and security configuration.
3. Host must provide `ASSETS` binding so the Worker can serve website files and the `ui://noodl-flashcards/workspace` resource.
4. Configure `ALLOWED_TRANSFER_HOSTS` and `ALLOWED_IMAGE_HOSTS` as **exact or narrowly scoped** HTTPS hostnames after inspecting actual file-transfer responses and license policies. No arbitrary URL proxying. File source URLs are temporary and must never be kept in card content.
5. A new ChatGPT plugin/connector must be registered using the new `/mcp` endpoint. Source-only GitHub commits do not publish or connect a plugin. Verify tool discovery from the live host.
6. Consider applying CSP, rate limits, upload quotas and abuse protection at the trusted edge. This prototype has a 4 MB image limit, but no account-wide storage quota or billing controls.

## Standalone local test

```sh
npm run dev
npm run check
npm test
```

## Manual release gates

- Confirm an authenticated account cannot read or approve another account's image, deck, or review. Validate with two isolated test accounts.
- Confirm anonymous requests **including fake `oai-authenticated-user-id` headers** fail.
- Confirm `import_media_file` works with a real host `file_id` and a real temporary URL; verify R2 image remains accessible after URL expiry and after conversation closes.
- Confirm actual PDF and PowerPoint slides are rendered in ChatGPT or by the helper, manually check crop, label legibility, scientific relevance and source number. Test a slide with arrows/shape labels, not just embedded JPEG.
- Confirm image `pending` cannot be referenced by create/append/update card, even with an asset ID supplied by ChatGPT.
- Confirm preview challenge is issued only to its owner, expires, cannot be reused after approval, and user rejects inaccurate images.
- Confirm mobile swipe works while unflipped and doesn't trigger when interacting with an image/video.
- Confirm timer pauses on hiding browser tab; 5/10/15-second clues appear once, and 20-second timeout does not assign a rating.
- Confirm real ChatGPT panel can load `ui://noodl-flashcards/workspace`, call UI-specific tools, and receive live data correctly.
- Confirm R2/CSP image rendering in the embedded panel. If the host blocks iframe domains, show an external link fallback.
- Review GDPR/data deletion obligations, storage retention, licenses, and D1/R2 costs before a public launch.

Do not enable `TRUSTED_SITES_PROXY=true` merely to make a broken local test pass. That would turn an identity trust boundary into a trivial spoofing vulnerability.

## v0.3 migration and existing 64-card Serologi deck

**Do not create a new D1 database if the goal is to add media to an existing deck.** A previous v0.2 connection showed deck `408f1352-c28e-4516-9f17-2e69ea684778` at revision 10; the currently connected v0.3 instance (checked again on 2026-11-21) shows a DIFFERENT 64-card deck `a951f84c-79bd-4071-a2eb-2d04d7605095` at revision 6. The earlier ID returned `Deck not found` on the active connection. Do not assume both instances share a database or account namespace. Creating a new project/database can yield an empty or separate workspace. Deployment needs an authorized update of the same trusted project/DB (or a separately verified owner-scoped data migration).

1. Export/backup the owner deck, review records, media and current D1 database.
2. Stop writes or establish a compatible migration window.
3. Apply `migrations/0002_visual_validation.sql` to the **existing** D1 database. It creates only new tables and retains all current decks/cards/reviews.
4. Publish the new Worker with `worker/visualValidation.js`, new UI, and version `0.3.0`; retain trusted identity and private `MEDIA` R2 bindings.
5. Reconnect/reload the actual ChatGPT plugin tool registry. Verify `get_capabilities.version=0.3.0` and new `submit_source_check`, `submit_visual_check`, `app_approve_card_visual`, `attach_visual_to_card` tools in the *live* host before using them.
6. Check real host file transfer (`import_media_file` has `file: {download_url,file_id,...}` and `_meta["openai/fileParams"]`), or use browser upload. Set exact `ALLOWED_TRANSFER_HOSTS` after examining actual trusted host URLs. No open proxy, no untrusted auth-header passthrough.
7. Import the six relevant source slides (3,6,20,26,31,32) for the CURRENT v0.3 deck; that deck has a map-epidemiology card on slide 3. This differs from the earlier v0.2 deck, where slide 3 had no suitable card. After import, image remains `pending`, then asset preview/approval, A source report, B final stored-pixel report, and account-user card approval. Attach to correct card ID with latest deck revision. Each reused slide needs a new binding and approval.
8. Read the deck back and inspect media in real ChatGPT panel, on a phone-size view, after reload. Check no card was deleted, reordered, or replaced.

**The source package cannot deploy itself**; hosting admin permissions, a trusted Sites project, actual D1/R2 resources and plugin connection are required. A test with a mocked host does not prove the live host.

## v0.4 emergency fix for `A host-transferred file_id is required`

This error means the currently connected ChatGPT host did **not** provide a transferable file object to the plugin. Do **not** invent `file_id`, turn `/mnt/data` paths into URLs, or store temporary ChatGPT download links as media.

**Before updating the live 64-card deck:**

1. Back up the existing deployment and D1 database. Verify that deck IDs, card IDs and SRS history are preserved.
2. Run `migrations/0003_chunked_media_upload.sql` on the same existing D1 database, retaining the same private R2 bucket and trusted user identity proxy.
3. Deploy the v0.4 Worker and embedded UI to the **same** live endpoint as the existing deck. Incrementing a GitHub branch or creating a new Sites project is not enough: a new project will not have those 64 cards.
4. Refresh/reconnect the ChatGPT MCP plugin and verify `get_capabilities.version` reports `0.4.0`. Inspect the new `app_begin_media_upload`, `app_upload_media_chunk`, `app_finish_media_upload` and `app_get_media_chunk` tools.
5. In Noodl → Settings, select the six relevant extracted PNGs: slide 3, 6, 20, 26, 31 and 32 (max 4 MB/image). Native host transfer is preferred; if unavailable, the UI uploads byte chunks through the app-only MCP transport. Verify each file appears in `list_media` with status `pending` and an SHA-256 matching the original PNG.
6. Open each media preview; if the private image URL fails, ensure readback via `app_get_media_chunk` reconstructs an identical image and is visible. The browser must actually decode the image before a user can approve it.
7. For each proposed card match, submit source check A and final visual check B, obtain explicit per-card, per-content-revision user approval, then call `attach_visual_to_card`. Preserve the 64 existing question IDs. Slide 3 has a relevant epidemiology card on the CURRENT 64-card deck; confirm its actual visible map legend before attaching.
8. Reload the deck and verify permanent images, offline/online behavior and SRS history. Only then mark the media problem resolved.

**Validation boundaries:** unit tests and simulated ChatGPT UI integration are available in this source package. They do not prove the live Site's auth header injection, ChatGPT `fileParams`, R2 configuration, plugin registry refresh, or end-user consent. Do not claim successful production import until these live checks pass.

If no authorized hosting/editor path is available, share this source ZIP with the actual Sites project administrator. Plugin Creator can edit eligible plugin package metadata, but does **not** publish a replacement Cloudflare Worker or change an existing app's MCP URL by itself.

Current-deck mapping file: `serologi-tifoid-media-rescue-v0.4.json` is distributed separately from source code. It lists six source images and twelve proposed card-specific attachments. Each approval is still pending. Never use earlier deck IDs or revisions as mutable API arguments without a fresh get_deck.

## v0.5: Enable hierarchical deck folders

When upgrading the **same** authenticated Noodl Flashcards database from v0.4, preserve its D1 binding and user data. After backing up the database, apply only `migrations/0004_folders.sql` (new `folders` table and nullable `decks.folder_id` column). Publish the new Worker/UI and refresh the ChatGPT plugin tool registry. Verify `get_capabilities.version` returns `0.5.0` and `list_folders`/`move_deck_to_folder` are visible, then test creating and moving a test deck and deleting a test folder before touching Serologi Tifoid. The existing 64 flashcards do not move automatically and their rating/image state is unchanged.

For complete API behavior, permissions, race/conflict handling and deletion safety, see `docs/FOLDERS_v0.5.md`. The source archive is **not** a live deployment.


## v0.6: Sequential OSCE checklist decks (no new migration)

Back up the existing D1 database, then deploy this Worker/UI against the **same** DB and R2 binding; no SQL schema change is needed. `procedureStep` is stored as additional JSON in `cards.content_json` and does not change ordinary flashcard data or review IDs. Check both MCP `get_capabilities.version` and `initialize.serverInfo.version` return `0.6.0`; refresh the ChatGPT plugin schema registry so `create_deck` exposes `procedureStep` guidance. Create a test deck using `examples/OSCE_TILIK_DEMO_NOT_OFFICIAL.json`, verify sequential full-deck order, "Pelajari teknik"/"Ingat urutan", timer and clue disabled for procedural decks, image review gate unchanged, and existing Serologi Tifoid still has 64 cards. Do not treat source ZIP as deployed. See `docs/OSCE_TILIK_IMPORT.md`.


## v0.7 Layered Reading (no database migration)

See `docs/LAYERED_READING_v0.7.md`. Back up the existing D1/R2 account data, deploy the v0.7 Worker and UI while keeping the same storage bindings, invalidate service worker caches, and verify both MCP version endpoints return `0.7.0`. Existing cards retain IDs and text. New optional `explanation.sections` remains in the existing JSON column. Validate a 64-card deck with very long back text and the OSCE player in a real ChatGPT host before advertising a successful production release.

## v0.8 Deep Cards + MCP content reading and targeted editing

Back up the **same live D1** database and existing private R2 bucket. Apply only `migrations/0005_deep_cards.sql` when upgrading a correctly migrated v0.7 instance (0001–0004 already applied). Deploy Worker/UI with the same account identity ingress; **do not** reinitialize storage or create a new cloud project. Invalidate service worker caches and refresh the active ChatGPT MCP registry. Verify `get_capabilities.version=0.8.0` and that `get_card_content`, `list_card_contents`, `search_card_contents`, `patch_card_content`, plus `create_visual_candidate.pageId` are exposed. Check a test deck before touching private course cards. Existing media bindings default to `page_id=NULL` and retain their prior front/back attachment semantics. See `docs/DEEP_CARDS_MCP_v0.8.md`.

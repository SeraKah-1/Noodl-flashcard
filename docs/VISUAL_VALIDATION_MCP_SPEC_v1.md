# Noodl Flashcards — Visual Validation MCP Specification v1.0

**Status:** SPECIFICATION / PROPOSED, **not implemented in v0.2**  
**Date:** 21 November 2026  
**Base:** `noodl-flashcards-smooth-swipe-v0.2.zip` (local prototype), with ideas from `SeraKah-1/noodl` and `SeraKah-1/noodl-gpt`.  
**Target:** the *Visual Recall Anchor* feature: recall → swipe → original slide/crop → next card.  
**Key principle:** an AI-written review report is not proof of an independently inspected image.

## 1. What the new guarantee actually means

Every image attached as **verified visual evidence** MUST pass **two distinct, stored checks** against the *exact same bytes* and the *exact card revision*, followed by an explicit user approval in the actual viewer:

1. **Check A — Source grounding:** the claimed file/page/slide/URL is real, the full-page context matches its source manifest, the crop is traceable to that page, and the cited region supports the intended topic. Image bytes, original page and crop hashes are bound together.
2. **Check B — Visual-semantic relevance:** inspect the **final rendered pixels** after conversion/cropping; confirm that the arrow, label, relation and visual content actually support the card's answer, and that essential labels are readable. Record concrete observations and problems, not just `true` or a confidence score.
3. **Final user approval:** present the full-size image, full slide where applicable, original source, relevant region and both reports. The user explicitly approves *this candidate for this card*. Reject means no attachment.

The server can **enforce the existence, ordering, consistency, owner, hashes, timestamps and revision binding** of A/B/approval. It **cannot prove that ChatGPT really perceived the image or that a scientific claim is true**. For medically or scientifically consequential content, user/source-expert review remains mandatory. No auto-approval based solely on AI confidence.

If the image has not passed these gates, it may be listed as a **candidate**, but it MUST NOT appear in the deck as verified evidence. If a card has no verified image, show text or a clearly marked **“Visual belum terverifikasi”** state; do not invent a slide reference.

## 2. Keep facts separate from provenance claims

| Type | UI label | Required origin | Meaning |
|---|---|---|---|
| `source_slide` | **Slide asli · halaman N** | Original user document + verified rendered page | It really belongs to that source file and page. |
| `source_crop` | **Potongan slide · halaman N** | Rendered page + normalized crop rectangle | A specific crop from the original slide, not a new conceptual drawing. |
| `document_image` | **Gambar dari materi** | User document + page/position | An actual graphic within user's document. |
| `supporting_web` | **Ilustrasi internet** | Source webpage + image URL + license audit | A supporting illustration, **not the user's original slide**. |
| `generated_illustration` | **Ilustrasi AI** | Generated-file ID and creation brief | AI-made illustration; **never treated as a documentary source**. |

Source priority: original user slide → accurate crop → actual image inside user's document → verified reusable licensed web material → generated illustration (only if requested or accepted). External images must not silently replace the original when the slide itself is adequate. The same image may support one card yet be misleading for another.

## 3. State model — always fail closed

Separate the binary asset lifecycle from its **card-specific evidence binding**.

### 3.1 Binary asset

`pending` → `approved_asset` or `rejected` → `revoked` (if source/license later becomes invalid).

`approved_asset` means: stored bytes passed binary checks and human inspection of the actual image. It **does not** mean this image is approved for *every* flashcard.

### 3.2 Card-specific evidence binding

`candidate` → `source_checked` → `visual_checked` → `awaiting_user_approval` → `approved_for_card` → `attached`.

On failure: `needs_rework` (can replace crop and begin again) or `rejected` (do not use). When card answer, source document, source page, crop, media bytes, or source rights change, revoke old binding and return to `candidate`. A replacement image **never inherits** its predecessor's checks.

**Never** accept client-supplied `status`, `approved`, `passed` or `verified: true` as authority. The server calculates state from stored receipts in owner-scoped transactions. A copied report does not count as a new check. The second check cannot be submitted before the first, and both must refer to the same `media.sha256`, `cardContentSha256` and `cardRevision`.

### 3.3 Review modes

- `strict` (default): both reports + mandatory approval by account user, with the original page visible for slide crops; web images require explicit reuse rights. Intended for lecture, medical and technical cards.
- `balanced`: same server gates, but user can approve a supporting illustration after seeing source and labels; absence of source image is allowed **only with truthful supporting-illustration labeling**.
- `fast`: allow draft candidates only; **never label or attach them as verified evidence** until the same strict gates have passed. This mode must not create a verification bypass.

## 4. Concrete end-to-end workflows

### 4.1 PDF, PPTX, or slide uploaded to ChatGPT

1. User submits a PDF/PPTX or selects a previously available file. ChatGPT or a connected conversion tool inspects the *real* document, not only OCR captions.
2. Register a source document: source file SHA-256; filename; page/slide count; owner; whether the original bytes were actually transferred to our server. If only model-visible content exists, mark `sourceIntegrity: "unverified_host_context"`, never `confirmed`.
3. Render **full page/slide** to PNG, preserving arrows, shape objects, fonts and labels; generate optional `source_crop` from normalized rectangle `[x,y,width,height]` in `[0,1]`. Maintain the full-page image and its hash. PPTX needs composed-slide rendering; extracting `ppt/media/` images alone is insufficient.
4. Upload real PNG/JPEG/WebP bytes through `import_media_file`. The MCP file input uses `_meta["openai/fileParams"]`. The temporary `download_url` is consumed once, never saved as the card's permanent URL. Server stores private R2 object, SHA-256, MIME, dimensions, and provenance.
5. **Check A:** ChatGPT opens or otherwise genuinely inspects the original page and records page number, region, labels seen, relation to card claim, and a source report. The server compares page/crop hash and manifest where actually available.
6. **Check B:** ChatGPT opens the final saved candidate preview (the exact binary hash), checks that the label, arrow and relationship survived cropping and remain legible, and compares against the **actual final card answer**. Provide one concrete supporting observation and one potential failure mode, even when passed.
7. Both reports enter `awaiting_user_approval`; the user views full-resolution preview plus full slide, confirms source, legibility, relevance, and clicks **Approve for this card**.
8. `attach_visual_to_card` writes the card-specific binding atomically, guarded by owner, expected deck/card revision and evidence version. After write, `get_card_visual_audit` confirms correct asset ID, card revision and status.
9. On swipe reveal: show a cropped visual anchor, plus “Lihat slide penuh” and original slide number. No more than one extra action is required to move to next card. Swipe smoothness and Undo stay intact.

If the host does not support transferring a PDF or rendered image to MCP, use the app's manual upload route or local `scripts/extract_source.py` and show capability-specific instructions. **No imaginary file IDs or fake page numbers.**

### 4.2 Internet image as supporting evidence

1. Search for 2–3 candidates using available ChatGPT search/research capabilities, **not an assumed Noodl web-search API**. Save both the **landing webpage** and the **direct image URL**; a search thumbnail is not a source.
2. Check authoritative visual accuracy and reuse rights. Examples of usable rights: documented public domain, CC0, valid CC BY or explicit permission; check attribution and contextual limitations. **Search ranking, an image watermark or a filename do not prove a license.** If rights cannot be verified, skip the image or use a direct link without importing, subject to product/legal review.
3. Fetch only through an allowlisted HTTPS media importer with DNS/IP safety and redirect restrictions. Check actual binary signature, MIME, pixel bounds and content. Save a private copy with source URL, publisher, license link, fetched timestamp and hash.
4. Check A validates *source identity, provenance and allowed reuse*, not a slide number. Check B validates actual image content against the card answer and performs legibility review.
5. If a source slide exists, compare it with the candidate and record **why the external illustration is clearer**; keep it labeled “Ilustrasi internet”. Require user approval before binding.
6. If the website changes, image becomes unavailable, rights are withdrawn or source content is replaced, revoke evidence. A changed hash requires a new round of checks.

Automated server fetchers MUST guard against *SSRF* (server-side requests to private/internal hosts): approved hostnames plus DNS resolution/IP classification, redirect rejection or revalidation, timeouts, response caps, no cookies, no authorization forwarding, and no arbitrary ports. The v0.2 importer checks URL hostname and bytes, but its current host allowlist is **not** a full resolved-IP/DNS-rebinding defense.

### 4.3 AI-generated image

Store `kind: generated_illustration`; keep creation prompt/brief and model-provided description only as provenance claims. Check B verifies the final pixels against the answer; Check A verifies only generation provenance, **not scientific source truth**. For factual graphics (e.g. anatomy labels), compare independently against original lecture material or authoritative references. Never show as “Slide asli”.

## 5. Proposed MCP tool contract

This section is a **v1 proposal**, not a list of tools already present in the v0.2 Worker. Reuse v0.2's `import_media_file`, `import_media_url`, `list_media`, `app_begin_media_review`, `app_approve_media`, `app_reject_media`, `get_deck`, `update_card`, `get_capabilities` where possible.

| Tool | Visibility | Input essentials | Output essentials and enforcement |
|---|---|---|---|
| `register_source_document` | model/app | `file`, `filename`, `declaredPages` | `sourceDocumentId`, file hash, real/claimed provenance flag; must ingest bytes before `confirmed` |
| `import_media_file` *(extend existing)* | model/app | `operationId`, `file`, provenance, `sourceDocumentId?`, `sourcePage?`, `crop?` | `mediaId`, `sha256`, `pending`; file is actual host transfer |
| `import_media_url` *(extend existing)* | model/app | `operationId`, direct image URL, landing URL, license evidence | `mediaId`, `sha256`, `pending`; never follows unsafe URLs |
| `get_visual_candidate` *(new)* | read-only | `mediaId`, `cardId`, `deckId` | Preview/access metadata, source chain, missing requirements; only owned resources |
| `submit_source_check` *(new)* | model/app | `operationId`, `mediaId`, `deckId`, `cardId`, `cardRevision`, `cardContentSha256`, source evidence | Receipt A (not an approval); checks the manifest, page/crop where verifiable |
| `submit_visual_check` *(new)* | model/app | All binding IDs/hash, `sourceCheckId`, actual pixel observations, supported claim, contradiction review | Receipt B; requires prior successful A and matching hashes/revision |
| `compare_visual_candidates` *(optional read-only)* | model/app | candidate IDs and `cardId` | Grounded comparison; not a classifier or license certification |
| `request_visual_approval` *(new)* | read-only, opens UI | `deckId`, `cardId`, `mediaId` | UI route with final preview, original page and two receipts; only when complete |
| `app_approve_card_visual` *(new)* | **app-only UI** | card binding, short-lived challenge, explicit per-card human attestation | `approved_for_card`; owner, token, checks and hashes verified in one transaction |
| `attach_visual_to_card` *(new)* | model/app | `operationId`, card identity/revision, `approvalId`, `mediaId`, `side`, `alt` | Actual write, atomic; returns new revision; **must not trust generic asset approval** |
| `reject_visual_candidate` *(new)* | model/app, destructive | `mediaId`, `deckId`, `cardId`, reason | `rejected` / `needs_rework`; no attachment |
| `get_card_visual_audit` *(new)* | read-only | card identity | Current evidence chain, hashes, human approval and revocation status |

The app UI may continue using same-origin REST endpoints where appropriate. `app_*` visibility metadata is **not an authorization boundary**. The server must independently authenticate owner, validate origin/CSRF as applicable and guard write operations. The browser saying “image decoded” is an attestation, not remotely provable pixel inspection.

### 5.1 File input shape that follows OpenAI plugin reference

```json
{
  "name": "import_media_file",
  "description": "Upload a real image file as a pending candidate; no automatic approval.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "operationId": {"type": "string"},
      "file": {
        "type": "object",
        "properties": {
          "download_url": {"type": "string"},
          "file_id": {"type": "string"},
          "mime_type": {"type": "string"},
          "file_name": {"type": "string"}
        },
        "required": ["download_url", "file_id"],
        "additionalProperties": false
      },
      "provenance": {"type": "object"}
    },
    "required": ["operationId", "file", "provenance"],
    "additionalProperties": false
  },
  "_meta": {"openai/fileParams": ["file"]}
}
```

Only `download_url` and `file_id` are required **inside the file object**; `mime_type` and `file_name` must be declared but optional. This matches the current OpenAI reference. `window.openai.selectFiles`, `uploadFile`, and `getFileDownloadUrl` are optional widget extensions and must be capability-detected; a local browser may not expose them.

### 5.2 Example of source check (A)

```json
{
  "operationId": "source-check-op-01",
  "deckId": "deck_1", "cardId": "card_7", "cardRevision": 4,
  "cardContentSha256": "<sha256-of-exact-front-and-back>",
  "mediaId": "media_12", "mediaSha256": "<actual-uploaded-bytes-sha256>",
  "sourceDocumentId": "doc_1", "sourcePage": 12,
  "fullPageSha256": "<rendered-full-page-sha256>",
  "crop": {"x": 0.22, "y": 0.35, "width": 0.48, "height": 0.30},
  "observedLabels": ["HCl", "pepsinogen", "pepsin"],
  "supportedClaim": "HCl creates the acidic environment for pepsinogen activation.",
  "evidenceNote": "The original slide has an arrow from acidic conditions to activation.",
  "sourceIntegrity": "confirmed"
}
```

The last field **must be derived from actual server-held document/render proof**, not accepted because ChatGPT supplied the word `confirmed`. Without source file/page hashes in the server, use `unverified_host_context` and do not label as verified original slide.

### 5.3 Example of visual check (B)

```json
{
  "operationId": "visual-check-op-01",
  "sourceCheckId": "check_A_1",
  "deckId": "deck_1", "cardId": "card_7", "cardRevision": 4,
  "cardContentSha256": "<same-card-hash>",
  "mediaId": "media_12", "mediaSha256": "<same-image-hash>",
  "inspectedView": "final_stored_image",
  "observedLabels": ["HCl", "pepsinogen", "pepsin"],
  "readability": "legible_at_phone_width",
  "supportedClaim": "The arrows and labels depict acidic activation.",
  "countercheck": "No direction reversal, cropped-out legend or incompatible context detected.",
  "problems": [],
  "recommendation": "pass"
}
```

Both records are submitted **by ChatGPT as observations**, not as independent scientific proof. A and B MUST contain content-specific observations; a generic “looks good” must be rejected at validation. Reopening the same image in a later tool call creates an auditable second inspection step, **but no protocol can guarantee mental independence** of the two model checks.

## 6. Data schema and integrity invariants

Add schema version `visual-validation/v1`. See companion `VISUAL_VALIDATION_MCP_SCHEMA_v1.json` for parseable record definitions.

### `source_documents`

`id`, `owner_id`, `filename`, `mime`, `source_file_sha256`, `page_count`, `ingest_method`, `original_bytes_present`, `created_at`.

### `source_pages`

`id`, `owner_id`, `document_id`, `page_number`, `rendered_asset_id`, `rendered_sha256`, `render_method`, `render_version`, `created_at`.

### `visual_bindings`

`id`, `owner_id`, `deck_id`, `card_id`, `card_revision`, `card_content_sha256`, `media_id`, `media_sha256`, `source_document_id?`, `source_page_id?`, `crop_json?`, `purpose`, `status`, `source_check_id?`, `visual_check_id?`, `user_approval_id?`, `updated_at`.

### `visual_checks`

`id`, `owner_id`, `binding_id`, `phase` (`source`/`visual`), `media_sha256`, `card_content_sha256`, `card_revision`, `report_json`, `actor_type` (`model_claim`/`human`/`server_auto`), `created_at`, `result` (`pass`/`fail`/`unverifiable`). No field here means *verified science*.

### `visual_approvals`

`id`, `owner_id`, `binding_id`, `challenge_hash`, `approved_asset_sha256`, `approved_card_content_sha256`, `approved_revision`, `checks_json`, `review_note`, `created_at`, `revoked_at?`.

**Hard invariants:**

- No `approved_for_card` without successful A and B, a human approval matching all hashes and owner, and no unresolved contradiction.
- Source check MUST precede visual check; human approval MUST follow both. `actor_type=model_claim` cannot impersonate `account_user`.
- If media hash, card content hash, card revision, crop, original source file or license proof changes, all associated approvals are invalidated before commit.
- `attach_visual_to_card` MUST be atomic with validation; no TOCTOU gap (a change between checking and writing) and no bypass through `create_deck`, `append_cards`, `update_card`, REST, import JSON, or offline sync.
- Asset may be approved globally for binary/render quality, but relevance is bound per `(owner,card,revision,mediaHash,sourcePage/crop)`.
- A user's private source/preview must not leak through a public embed. Publishing a deck requires distinct per-asset publication permission and licensing review.
- Retry with identical `operationId` returns the same receipt. A reused ID with a **different payload** is rejected, not silently accepted.

### 6.1 Migration from v0.2

The current `migrations/0001.sql` has only `media.status = pending|approved|rejected`, `visual_review_json`, and `approval_json`; `worker/media.js` approves *media objects* rather than *card-specific evidence*. It does **not** enforce distinct A/B records or source-page hash provenance. Current `worker/index.js` `create_deck`/`update_card` only checks generic `approved` image state. **Do not label this behavior as double-verified.**

Migration proposal: add the tables above; preserve existing media rows, but treat all pre-v1 `approved` images as `legacy_asset_approved` and **not evidence-approved for a card**. Keep old cards readable with an “Unverified visual” badge until a new binding is reviewed; never silently upgrade their scientific verification level.

Use a new `migrations/0002_visual_validation.sql` and a new `worker/visualValidation.js`, `public/visual-review.js`, and test suite. Do not overwrite existing user data.

## 7. Decision rules: approve vs reject vs fallback

| Situation | Correct outcome |
|---|---|
| Source slide cropped off the only meaningful arrow | `needs_rework`; redo crop before B. |
| Slide source claimed but no original document/page bytes available | `unverifiable`; cannot call it a verified original slide. |
| Original slide matches topic, but label too tiny on phone | Re-render/crop or fail B; no approval. |
| Internet image looks similar but depicts another anatomical structure | Fail B; reject. |
| License source is ambiguous | Do not import as reusable licensed media; request another source. |
| Image passes AI reports but user says label is wrong | Reject or rework; human decision wins. |
| Image passes for card A but reused in card B | New binding, new A/B and approval for B. |
| Card answer changed after approval | Revoke prior binding and recheck. |
| Image generation invents a credible-looking label | Mark generated; fail or manually revise; cannot claim source authority. |
| Browser can load only a thumbnail, not original image | No final approval until actual stored image bytes are previewable. |

## 8. UX for Visual Recall Anchor (after swipe)

- Swipe left/right stays active from the entire card surface (text, image, center); a swipe before flipping is still self-reported recall, not graded correctness.
- After swipe, display the relevant **approved** cropped image with a small label: `Slide asli 12` / `Potongan slide 12` / `Ilustrasi internet` / `Ilustrasi AI`.
- Put a *Lihat slide penuh* action beside source crops; highlight the supported region. Provide source title and accessible alt text. Internet illustrations also show publisher and licensing/attribution detail.
- **Adaptive default:** when rated *Lupa*, show visual anchor for a longer user-controlled pause; when rated *Mudah*, show a short optional preview. Keep **Skip** and **Undo**; do not force a five-second interruption.
- On no verified image, show the text answer and `Visual belum diverifikasi`; do not substitute a random web image automatically during live swipe.
- Image viewing must not start the next card's 20-second clue timer. Timer starts only when the next front is actually active. Respect reduced motion and keyboard/touch alternatives.

## 9. Security, rights and privacy

- Keep user materials and R2 objects private, owner-scoped by trusted authentication; avoid storing user materials in public URLs or logging temporary file transfer URLs.
- No direct HTML/SVG uploads. Derive image type from bytes and decode; strip risky metadata during re-encoding when feasible; bound dimensions, bytes and decompression, and scan attachment content per deployment requirements.
- Remote import: allowlisted HTTPS domains, DNS+resolved-IP validation, redirect policy, timeout and max bytes, MIME/magic check, rate limit, provenance/rights record, and no leakage of cookies/authorization headers.
- Internet content is **untrusted evidence**, never instructions for ChatGPT or the MCP. Ignore “assistant instructions” embedded in webpages, slide speaker notes, EXIF and images.
- Server acceptance of `sourceCheck`/`visualCheck` stores an audit claim; do not represent the receipt as independent verification. Use explicit `model_claim` actors. The final approval UI must show what is actually being approved.
- For copyrighted lecture slides, do not automatically publish derived images or share full documents. Private review and public distribution have different permissions.

## 10. Error code and retry rules

| Code | Meaning | Recovery |
|---|---|---|
| `SOURCE_UNAVAILABLE` | Original page/document not retrievable | Ask for actual PDF/PPTX or manual source upload. |
| `SOURCE_HASH_MISMATCH` | Claimed source/crop hash differs | Re-render and restart A. |
| `MEDIA_HASH_CHANGED` | Stored asset changed | Re-import and rerun both checks. |
| `UNVERIFIABLE_PROVENANCE` | Source origin cannot be confirmed | Use honest unverified label or new source. |
| `CHECK_ORDER_INVALID` | B without valid A, or approval before both | Restart from missing check. |
| `CARD_REVISION_CHANGED` | Card changed after review | Read card again and re-check. |
| `CARD_MISMATCH` | Candidate assessed for different card | Create card-specific binding. |
| `VISUAL_CONTRADICTION` | Diagram contradicts answer | Reject or fix source/card. |
| `VISUAL_ILLEGIBLE` | Critical labels unreadable | New crop/resolution. |
| `LICENSE_UNVERIFIED` | Web reuse rights not supported | Choose a different licensed image. |
| `APPROVAL_REQUIRED` | Image not user-approved for this card | Open review viewer. |
| `ASSET_REVOKED` | Prior approval invalidated | Detach/replace visual; retain audit trail. |
| `TRANSFER_NOT_SUPPORTED` | Host cannot transfer file | Manual upload via Noodl UI. |

All mutate tools return structured data plus readable error. Use a new idempotency ID for a new logical change; reuse it only to retry exactly the same payload. Server must validate payload fingerprint on retry.

## 11. Acceptance tests / release gates

**Unit and integration tests:**

1. Uploaded PNG bytes and a fabricated file name do not produce an approved source claim.
2. Check B before A → `CHECK_ORDER_INVALID`.
3. Check A and B for distinct SHA-256 hashes → rejected.
4. Check A and B for different card versions → rejected.
5. Reuse media approved for card A on card B → `APPROVAL_REQUIRED`.
6. Change card answer after approval → old binding revoked; cannot attach.
7. Change crop rectangle after A → B invalid until A repeated.
8. `app_approve_card_visual` without an owner-bound, unexpired challenge → rejected.
9. Attempt `create_deck`/`append_cards`/`update_card` directly with pending or generic-approved-but-unbound media → rejected.
10. Retry same operation ID with changed payload → conflict.
11. Fake web license or wrong host → rejected; private IPv4/IPv6 and redirect attempts blocked.
12. Internet source without image pixels or with only search thumbnail → not approved.
13. User rejection overrides model A+B pass, including on high-confidence images.
14. Missing source document does not create a fabricated page number or `confirmed` status.
15. Legacy approved v0.2 media remains viewable but not falsely marked double-verified.
16. Account A cannot see, approve, attach or download Account B's private assets.
17. Media/review state survives refresh and offline resync without promoting `pending` to `approved_for_card`.
18. A public deck does not leak private slide or temporary ChatGPT download URL.

**Real browser/host tests:** actual file attach via ChatGPT → MCP (not mocked), actual full-slide render, actual final crop, A and B receipts, real approval click, source slide view, smooth swipes from center text/image, Undo, and original slide reveal on phone viewport. Repeat with no file transfer support, timeout and bad network. Browser DOM tests **do not establish** that an AI looked at image contents or that host identity and R2 work in production.

**Definition of Done:** no source visual reaches `attached` as verified without valid, owner-scoped A/B checks plus a per-card, per-revision user approval; every displayed source label is truthful; live MCP file transfer and deployed storage have actually been tested.

## 12. Phased implementation on the existing prototype

| PR | Minimal scope | Gate |
|---|---|---|
| **VV-01** | New migration, image+source+binding hashes and state machine, legacy migration label | No generic asset approval can imply card-level proof. |
| **VV-02** | `get_visual_candidate`, `submit_source_check`, `submit_visual_check`, content-specific validation | A/B ordering + hash/revision tests pass. |
| **VV-03** | Per-card approval UI, full slide/crop viewer, challenge/attestation, `attach_visual_to_card` | Direct bypass via CRUD impossible. |
| **VV-04** | PDF/PPTX source manifests and original slide reveal, real host file transfer | Page/crop hashes and actual render verified on deployment. |
| **VV-05** | Licensed web fallback and optional candidate comparison | Remote safety/licensing tests plus truthful labels. |
| **VV-06** | Smooth adaptive slide reveal, mobile usability, source audit UI and production verification | Actual swipes, timer, undo, offline and identity checked. |

The source repositories remain untouched. All commands, data fields and tables above that do not appear in v0.2 are **proposed** until code, migrations and host tests implement them.

## 13. Authoritative references / implementation files

- Current prototype: `worker/index.js`, `worker/media.js`, `worker/validation.js`, `migrations/0001.sql`, `public/app.js`, `docs/MCP_WORKFLOW.md`, `tests/media-gate.test.mjs`.
- OpenAI plugin reference on file tool inputs, widget uploads and host capability detection: https://developers.openai.com/plugins/reference (see **File APIs** and **Define file inputs**).
- ChatGPT MCP UI integration and capability detection: https://developers.openai.com/plugins/build/chatgpt-ui.
- MCP tool description and annotation principles: https://developers.openai.com/plugins/build/mcp-server.
- Original design: https://github.com/SeraKah-1/noodl.
- MCP ancestor: https://github.com/SeraKah-1/noodl-gpt.

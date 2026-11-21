# Deployment and release gates

The local demo is independent of a cloud account. Production depends on a **new** authenticated ChatGPT Sites project with fresh durable resources. Do not reuse source project IDs, D1 databases, R2 buckets or user data without a separately authorized migration.

## Preconditions

1. New isolated Sites app/project with a trusted host layer that authenticates the user **and strips/supplies** the identity header. This source treats `oai-authenticated-user-id` as an attestation only from that trusted platform. A generic public Cloudflare Worker does not satisfy this boundary; keep `TRUSTED_SITES_PROXY=false` there.
2. New D1 database + new R2 private bucket bindings named `DB` and `MEDIA`; apply `migrations/0001.sql` **then** `migrations/0002_visual_validation.sql`. For an existing v0.2 database, back up first and apply **only 0002**. If using Wrangler outside Sites, create a new project with private authentication/OAuth **before** enabling the REST/MCP routes. `wrangler.jsonc.example` is deliberately non-deployable without replacing IDs and security configuration.
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

**Do not create a new D1 database if the goal is to add media to an existing deck.** The currently connected Noodl Flashcards account has a 64-card Serologi Tifoid deck at observed revision 10. Creating a new project/database with the v0.3 code will produce an empty workspace, not update that deck. Deployment needs an authorized update of the same trusted project/DB (or a separately verified owner-scoped data migration).

1. Export/backup the owner deck, review records, media and current D1 database.
2. Stop writes or establish a compatible migration window.
3. Apply `migrations/0002_visual_validation.sql` to the **existing** D1 database. It creates only new tables and retains all current decks/cards/reviews.
4. Publish the new Worker with `worker/visualValidation.js`, new UI, and version `0.3.0`; retain trusted identity and private `MEDIA` R2 bindings.
5. Reconnect/reload the actual ChatGPT plugin tool registry. Verify `get_capabilities.version=0.3.0` and new `submit_source_check`, `submit_visual_check`, `app_approve_card_visual`, `attach_visual_to_card` tools in the *live* host before using them.
6. Check real host file transfer (`import_media_file` has `file: {download_url,file_id,...}` and `_meta["openai/fileParams"]`), or use browser upload. Set exact `ALLOWED_TRANSFER_HOSTS` after examining actual trusted host URLs. No open proxy, no untrusted auth-header passthrough.
7. Import five relevant source slides (6,20,26,31,32). Slide 3 is a separate map with no matching card in current deck. After import, image remains `pending`, then asset preview/approval, A source report, B final stored-pixel report, and account-user card approval. Attach to correct card ID with latest deck revision. Each reused slide needs a new binding and approval.
8. Read the deck back and inspect media in real ChatGPT panel, on a phone-size view, after reload. Check no card was deleted, reordered, or replaced.

**The source package cannot deploy itself**; hosting admin permissions, a trusted Sites project, actual D1/R2 resources and plugin connection are required. A test with a mocked host does not prove the live host.

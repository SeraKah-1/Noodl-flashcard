# Noodl Flashcards v0.5 — Folders

## Scope

Hierarchical, owner-scoped folders organize *decks*, not individual cards or media. A folder may contain decks and subfolders. A deck belongs to one folder or root (`folderId: null`). Depth is limited to six levels; at most 1,000 active folders per account. Existing flashcards remain at root after migration. Creating/deleting/moving folders never changes a card's content, ID, image-binding, rating, or review record.

## Database migration

**Existing v0.4 installation:** take an exact D1 backup first, stop writes for the migration window, then run **only** `migrations/0004_folders.sql`. Restart the Worker/UI and ensure the connected plugin discovers the new tool registry. Never reapply `0001.sql` or recreate the database to add this feature.

**New installation:** execute `0001.sql`, `0002_visual_validation.sql`, `0003_chunked_media_upload.sql`, `0004_folders.sql` in that order, using the same owner-scoped D1 binding throughout. Existing `decks`, `cards`, `reviews`, `media`, and `visual_bindings` are preserved. The only deck schema addition is nullable `folder_id` (defaults to root for old records). Folder records and indexes are additive.

Verify afterwards:

```sql
SELECT COUNT(*) FROM decks WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM cards;
SELECT COUNT(*) FROM reviews;
SELECT COUNT(*) FROM media;
SELECT COUNT(*) FROM folders WHERE deleted_at IS NULL;
SELECT COUNT(*) FROM decks WHERE folder_id IS NOT NULL;
```

Do not force `TRUSTED_SITES_PROXY=true` without a trusted authenticated host. A generic public Worker cannot trust caller-supplied `oai-authenticated-user-id` headers.

## MCP contract

All writes require an owner-scoped idempotency `operationId`. Existing-deck and folder mutations require the current `expectedRevision` (optimistic concurrency: stale revisions are rejected rather than silently overwriting concurrent changes).

| Tool | Input | Output |
|---|---|---|
| `list_folders` | `{}` | `{folders: [{id,parentId,name,revision,createdAt,updatedAt}]}` |
| `create_folder` | `{operationId,name,parentId?:string\|null}` | `{folderId,parentId,name,revision}` |
| `rename_folder` | `{operationId,folderId,expectedRevision,name}` | `{folderId,name,revision}` |
| `move_folder` | `{operationId,folderId,expectedRevision,parentId?:string\|null}` | `{folderId,parentId,revision}` |
| `delete_folder` | `{operationId,folderId,expectedRevision}` | `{deleted,movedDecks,movedSubfolders,parentId}` |
| `move_deck_to_folder` | `{operationId,deckId,expectedRevision,folderId?:string\|null}` | `{deckId,folderId,revision}` |
| `create_deck` | existing inputs + optional `folderId` | `{deckId,folderId,revision,...}` |
| `list_decks`, `get_deck`, `app_snapshot` | existing inputs | include `folderId`; snapshot additionally contains `folders` |

Optional folder IDs are `null` for root. To make the folder `Blok 9` and then a deck inside it, call `create_folder` first, use the returned folder ID as `folderId` in `create_deck`. ChatGPT must not invent folder IDs or use names where an ID is required.

Standalone REST routes with trusted owner identity: `GET /api/folders`, `POST /api/folders`, `POST /api/folders/rename`, `/api/folders/move`, `/api/folders/delete`, `/api/folders/move-deck`.

## Safety behavior

- **Delete a folder, not its contents:** direct child folders and decks are moved one level to the parent folder; a root folder's contents go to root. Child folder names cannot collide with existing siblings in the destination; if they do, deletion is rejected with no writes. Deletion is recorded via a soft-delete marker.
- **No cycles:** moving a folder into itself or any descendant is prohibited, as is exceeding six nested levels.
- **No duplicate active sibling names:** trimmed, case-insensitive names are unique under the same parent. `/`, `\\` and control characters are invalid.
- **Owner boundaries:** cannot create into another account's parent folder or move another account's deck.
- **Revision checks:** moving a deck increments the deck revision, preserving review history and card IDs; callers must read the latest deck revision before subsequent edits/visual attachment.
- **No media downgrade:** picture candidate checks and human approvals are untouched. Moving a deck never converts an unverified picture into a verified one.
- **Local mode:** folders persist in the browser's account-scoped IndexedDB. Local-only folders do **not** sync into the cloud automatically; connected mode reads/writes owner-scoped D1 through MCP.

## UI flows

In **Deck → My decks**:

1. Tap **＋ Folder baru**; choose its parent and name.
2. Open a folder to show its decks and subfolders. Breadcrumbs take you back to parent/root.
3. Use **↗ Pindahkan** on a deck to pick a destination folder, or `Rename / Pindah / Hapus` on a folder.
4. Tap **✧ Deck baru** from inside a connected folder: the ChatGPT handoff message contains the exact folder ID so `create_deck` can place the new deck correctly.
5. Search matches both deck names and folder names across the library.

## Verification before release

- Unit/integration: `npm test` (38 passing in local release test, including seven folder-focused tests).
- Syntax: `npm run check`.
- Browser Chromium: nested create → move demo deck → safe parent deletion, with both 1366px and 390px viewports; tested in local mode via injected browser harness.
- Production must be separately tested with live MCP plugin, trusted user identity, D1 migration, existing 64-card Serologi deck, and reload using two accounts. Check folder operations after reconnecting ChatGPT; source archive alone cannot modify an active plugin or existing D1 database.

# HTTP API and WebSocket reference

The browser UI uses this API directly. It is currently unversioned; pin a tested Wklejka image when integrating another client and review API changes before upgrading.

## Authentication and request conventions

`/healthz`, `/livez`, and `/readyz` are always unauthenticated. Every other route, including static UI assets, `/api/*`, media, QR responses, and `/ws`, follows the configured application authentication policy.

- Bearer token: `Authorization: Bearer <AUTH_TOKEN>`
- HTTP Basic: `Authorization: Basic ...` when both `AUTH_USERNAME` and `AUTH_PASSWORD` are configured
- Browser bootstrap: opening `/?token=<AUTH_TOKEN>` sets an HttpOnly, `SameSite=Strict` cookie and the UI removes the query parameter from its visible URL

When no authentication variables are configured, these routes are public. Wklejka has one deployment-wide security domain; it does not implement per-user or per-board authorization.

JSON requests use `Content-Type: application/json`. Successful mutation responses are acknowledged only after the metadata snapshot is durable. Every HTTP response includes `X-Request-Id`.

Most API failures use:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

Authentication middleware can return plain-text `401` or `429` responses. Unexpected `500` responses also include a `requestId`. Rate-limited responses include `Retry-After`.

## Health and operator endpoints

| Method and path | Response |
| --- | --- |
| `GET /healthz` | Compatibility liveness alias: `{ "ok": true }`. |
| `GET /livez` | Process liveness: `{ "ok": true }`. |
| `GET /readyz` | Durable-store/shutdown readiness; `200` or `503` with `ok`, `storage`, and `code`. |
| `GET /api/status` | Counts, quotas, storage/writer status, WebSocket clients, and link-preview cache state. |
| `GET /api/metrics` | Prometheus text exposition. No clip bodies are included. |
| `GET /api/export` | Downloadable schema-versioned metadata JSON. Media bodies are not included. |
| `POST /api/maintenance/cleanup` | Preview or execute retention/expiry/orphan cleanup. See [operations](operations.md#maintenance-cleanup). |

Status, metrics, export, and cleanup are protected only when application authentication is configured.

## Boards

A board resembles:

```json
{
  "id": "default",
  "name": "Schowek",
  "createdAt": 1760000000000,
  "expiresAt": null,
  "locked": true
}
```

`expiresAt` and `locked` are optional on stored/returned records. An unlocked board normally omits `locked` rather than returning `false`.

| Method and path | Body or behavior |
| --- | --- |
| `GET /api/boards` | Return the ordered board array. |
| `POST /api/boards` | `{ "name": "Work", "expiresIn": 86400000 }`; `expiresIn` is optional and capped at one year. |
| `PUT /api/boards/reorder` | `{ "ids": [...] }`; every current board ID must appear exactly once. |
| `PUT /api/boards/:id` | Any non-empty subset of `name` and Boolean `locked`. The default board cannot be locked. |
| `DELETE /api/boards/:id` | Delete a non-default, unlocked board and its media. |

A board lock protects clip creation/update/deletion and board deletion. It can still be unlocked or renamed through the board endpoint, and expiry/retention can remove content. Treat it as accidental-change protection, not access control.

## Listing and searching clips

`GET /api/boards/:id/clips` without a query string returns the legacy array. Supplying any supported query parameter returns a page object:

```json
{
  "items": [],
  "nextCursor": null,
  "total": 0
}
```

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `limit` | Positive page size, capped by `MAX_CLIPS_PAGE_SIZE`. |
| `cursor` | Opaque cursor returned by the previous page. |
| `q` | Case-insensitive text/file-metadata search. |
| `type` | `text`, `image`, or `file`. |

Keep the same `q`, `type`, and `limit` while following a cursor. Results are pinned-first, then newest-first, with ID as a deterministic tie-breaker. The cursor is live rather than a snapshot; restart from page one after a sorting-key change.

Current compatibility behavior: a syntactically valid but unknown board ID returns an empty list/page on this read endpoint. Mutations against an unknown board return `404`.

## Creating clips

### Text JSON request

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"text","content":"hello from the API"}' \
  https://clipboard.example.net/api/boards/default/clips
```

`POST /api/boards/:id/clips` accepts `text`, `image`, or `file`. Binary JSON uploads use a canonical non-empty `data:<mime>;base64,...` value in `content`; files may also provide `originalName`. This compatibility path expands data in memory and should not be used for large integrations.

### Recommended streaming upload

`POST /api/boards/:id/uploads` accepts the raw request body and avoids base64 copies.

Required headers:

| Header | Meaning |
| --- | --- |
| `X-Clip-Type` | `image` or `file`. |
| `Content-Type` | Actual media MIME type. Images are signature-checked and limited to PNG, JPEG, GIF, or WebP. |
| `X-Original-Name` | Required by convention for files; URL-encoded UTF-8 filename. Ignored for images. |

Example:

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H 'X-Clip-Type: file' \
  -H 'X-Original-Name: report.pdf' \
  -H 'Content-Type: application/pdf' \
  --data-binary @report.pdf \
  https://clipboard.example.net/api/boards/default/uploads
```

The response is the created clip. Uploads enforce per-clip, board/total-count, aggregate-storage, and lock limits while streaming and again before commit.

## Updating and deleting clips

| Method and path | Body or response |
| --- | --- |
| `PUT /api/boards/:boardId/clips/:clipId` | Any non-empty subset of `content`, Boolean `pinned`, `expiresAt`, or `expiresIn`. Only text content is editable. |
| `DELETE /api/boards/:boardId/clips/:clipId` | Delete one clip; returns `{ "ok": true }`. |
| `POST /api/boards/:id/clips/bulk-delete` | `{ "ids": [...] }`; unique, non-empty, capped by `MAX_BULK_DELETE`. |

`expiresAt` is a future Unix timestamp in milliseconds. `expiresIn` is a positive relative duration in milliseconds. They are mutually exclusive; set either one to `null` to clear expiry.

Bulk deletion is atomic for metadata. Unknown IDs do not fail the request:

```json
{
  "ok": true,
  "deleted": 2,
  "deletedIds": ["clip-a", "clip-b"],
  "notFoundIds": ["clip-c"],
  "reclaimedBytes": 1024
}
```

## Media, QR, and link previews

| Method and path | Behavior |
| --- | --- |
| `GET /api/images/:filename` | Inline image response with validated MIME and safe headers. |
| `GET /api/files/:filename` | Attachment download using the stored original filename. |
| `GET /api/files/:filename/preview` | Inline preview only for the allowlisted PDF/audio/video types; otherwise `415`. |
| `GET /api/share/qr?boardId=...&clipId=...&lang=en` | Local SVG QR for an existing direct clip link. `lang` is optional (`pl` or `en`). |
| `GET /api/link-preview?url=https%3A%2F%2Fexample.com` | `{ "title", "description", "image" }` for an allowed HTTP(S) target. |

QR output and media follow application authentication. Configure `PUBLIC_ORIGIN` so QR/direct links use the intended HTTPS origin.

Link previews are outbound requests from the Wklejka host. The destination can observe the deployment's source IP and requested domain. Private/non-routable targets and redirect targets are blocked, response parsing is capped at 64 KiB, redirects are capped at five, and each outbound HTTP hop has a five-second timeout. DNS resolution can add delay. Successful and failed results use separate bounded in-memory caches.

## Maintenance cleanup

`POST /api/maintenance/cleanup` accepts:

```json
{
  "dryRun": true,
  "boardId": "default"
}
```

`dryRun` defaults to `true`. `boardId` limits board/clip matching, while orphan scanning remains global. `olderThan` is a past Unix timestamp in milliseconds and affects only unpinned clips. A preview is not a transactional snapshot; rerun it immediately before executing cleanup if content may be changing.

## WebSocket channel

Connect to `/ws` with the public page origin and the same authentication cookie/header as HTTP. The server validates path, `Host`, origin, proxy-derived scheme, authentication, client count, payload size, and backpressure. It is a server-push channel: sending an application message closes the connection with policy code `1008`.

Broadcast JSON events:

| `type` | Additional fields |
| --- | --- |
| `board-added` | `board` |
| `board-updated` | `board` |
| `board-deleted` | `boardId` |
| `boards-reordered` | `ids` |
| `clip-added` | `boardId`, `clip` |
| `clip-updated` | `boardId`, `clip` |
| `clip-deleted` | `boardId`, `clipId` |

Events are notifications, not a durable log. A reconnecting client should reload boards and the current clip page through HTTP before resuming live updates.

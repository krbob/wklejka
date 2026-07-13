# Operations

## Environment reference

Integer values use base 10. Most limits must be positive; settings explicitly described as “`0` disables” accept zero. Invalid values fall back to their defaults.

### Process, authentication, and proxy

| Variable | Default | Notes |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listener inside the container. |
| `DATA_DIR` | `/app/data` in the image | Metadata and media root. Mount persistent storage here. |
| `AUTH_USERNAME` + `AUTH_PASSWORD` | unset | Enables Basic authentication when both are non-empty. |
| `AUTH_TOKEN` | unset | Enables bearer and HttpOnly-cookie token authentication. |
| `AUTH_COOKIE_SECURE` | `auto` | `true`, `false`, or `auto`; use `true` behind HTTPS. |
| `TRUST_PROXY` | disabled | Express proxy trust setting; prefer an explicit hop count/range. |
| `PUBLIC_ORIGIN` | inferred from request | Exact WebSocket browser origin. |
| `PUBLIC_ORIGINS` | unset | Comma-separated alternative to `PUBLIC_ORIGIN`. |
| `LOG_REQUESTS` | `true` | Structured JSON request/error logs; set `false` to suppress normal request logs. |
| `HSTS_MAX_AGE` | `31536000` | HSTS `max-age` seconds on requests recognized as HTTPS; `0` disables. |
| `HSTS_INCLUDE_SUBDOMAINS` | `false` | Add `includeSubDomains` to HSTS; enable only if every subdomain is permanently HTTPS. |

`WKLEJKA_TOKEN`, `WKLEJKA_USER`, and `WKLEJKA_PASSWORD` remain accepted as compatibility aliases, but new deployments should use the canonical `AUTH_*` names.

### Data, paging, and retention

| Variable | Default | Notes |
| --- | ---: | --- |
| `MAX_CLIP_BINARY_BYTES` | `104857600` | Maximum binary bytes in one file or image clip. |
| `MAX_TEXT_CLIP_BYTES` | `1048576` | Maximum UTF-8 bytes in one text clip. |
| `MAX_BOARDS` | `100` | Maximum number of boards. |
| `MAX_CLIPS_PER_BOARD` | `10000` | Maximum clips in one board. |
| `MAX_TOTAL_CLIPS` | `50000` | Maximum clips across all boards. |
| `MAX_STORAGE_BYTES` | `5368709120` | Aggregate quota for referenced image/file bodies and active uploads. |
| `MAX_BOARD_NAME_LENGTH` | `120` | Maximum board-name characters. |
| `MAX_ORIGINAL_NAME_LENGTH` | `255` | Maximum uploaded original-name characters. |
| `DEFAULT_CLIPS_PAGE_SIZE` | `50` | Default `items` count when any clip query parameter is present; capped by the maximum. |
| `MAX_CLIPS_PAGE_SIZE` | `200` | Maximum accepted `limit` for clip pagination. |
| `MAX_BULK_DELETE` | `100` | Maximum unique clip IDs in one bulk-delete mutation. |
| `CLIP_RETENTION_MS` | `0` | Age-based deletion of unpinned clips; `0` disables automatic retention. |
| `MAX_CLIP_EXPIRY_MS` | `31536000000` | Furthest allowed relative/absolute clip expiry (one year). |
| `ORPHAN_GRACE_MS` | `300000` | Minimum orphan age considered by online maintenance; `0` removes the grace. |

### Persistence, rate limits, previews, and WebSocket

| Variable | Default | Notes |
| --- | ---: | --- |
| `STORE_SAVE_DEBOUNCE_MS` | `20` | Short delay before writing a pending metadata snapshot. |
| `STORE_SAVE_MAX_WAIT_MS` | `200` | Maximum pending-batch wait; effectively never lower than the debounce. |
| `AUTH_RATE_LIMIT` | `20` | Failed authentication attempts per client per minute. |
| `API_RATE_LIMIT` | `600` | API requests per client per minute. |
| `LINK_PREVIEW_RATE_LIMIT` | `30` | Link-preview requests per client per minute. |
| `LINK_PREVIEW_CACHE_TTL_MS` | `3600000` | Successful preview cache lifetime; `0` disables positive caching. |
| `LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS` | `60000` | Failed preview cache lifetime; `0` disables negative caching. |
| `LINK_PREVIEW_CACHE_MAX_ENTRIES` | `256` | Maximum in-memory positive/negative preview entries. |
| `MAX_WS_CLIENTS` | `100` | Maximum simultaneous WebSocket clients. |
| `MAX_WS_PAYLOAD_BYTES` | `65536` | Maximum incoming WebSocket frame payload; browsers normally send no frames. |
| `MAX_WS_BACKPRESSURE_BYTES` | `1048576` | Disconnect a client whose queued outbound data exceeds this value. |
| `WS_HEARTBEAT_MS` | `30000` | Ping interval used to remove dead connections. |
| `WS_ALLOW_NO_ORIGIN` | `false` | Permit WebSocket clients without `Origin`; avoid for browser deployments. |

## Capacity and quotas

Wklejka enforces limits for boards, clips, each payload, and aggregate bytes occupied by referenced images/files. Active streaming uploads reserve quota as bytes arrive. Requests that exceed the binary storage quota fail with HTTP `507`; count limits fail with `409`.

`MAX_STORAGE_BYTES` is an application-level binary quota, not a filesystem reservation. It excludes `store.json`, recovery/corrupt copies, archive backups, and filesystem overhead. Set it below actual volume capacity and retain headroom for atomic metadata writes and operations.

For predictable operation:

- place `/app/data` on a filesystem or volume with known capacity and alert before it fills;
- set per-clip and aggregate limits below proxy, memory, and volume limits;
- use expiry/retention for transient transfers and review pinned clips periodically;
- monitor both bytes (`du -sh`) and free inodes;
- run exactly one Wklejka process against a data directory.

Metadata remains memory-resident and each committed mutation serializes one JSON snapshot. Pagination reduces API/browser work, not metadata memory or write amplification.

## Paging, search, pinning, and expiry

With no query parameters, `GET /api/boards/:id/clips` returns the legacy array. Any supported query parameter switches to a page object:

```text
GET /api/boards/default/clips?limit=50&type=text&q=needle&cursor=<opaque>
```

```json
{
  "items": [],
  "nextCursor": null,
  "total": 0
}
```

Keep the same `q`, `type`, and `limit` while following `nextCursor`. The cursor is an opaque live keyset, not a snapshot. Results are pinned-first, then newest-first. If a clip is pinned/unpinned while paging—or the client otherwise changes a sorting key—discard the cursor and restart from page one. With unchanged ordering, pages do not overlap.

`PUT /api/boards/:boardId/clips/:clipId` accepts `pinned`, `expiresAt`, and `expiresIn` alongside text `content`. `expiresAt: null` or `expiresIn: null` clears expiry. Expiry must be in the future and within `MAX_CLIP_EXPIRY_MS`.

Important retention rules:

- an explicit `expiresAt` removes the clip even when it is pinned;
- `CLIP_RETENTION_MS` removes only unpinned clips;
- maintenance `olderThan` removes only unpinned clips;
- an expired non-default board is removed with all its clips, regardless of their pin state;
- background expiry/retention runs every 60 seconds, so deletion is not exact to the millisecond.

## Durable persistence and readiness

HTTP mutations are serialized and written to an atomic metadata snapshot before the server acknowledges or broadcasts them. `STORE_SAVE_DEBOUNCE_MS` permits a short batching window and `STORE_SAVE_MAX_WAIT_MS` bounds a pending batch; request callers still await the successful write.

If persistence fails, the mutation is not published, the request returns `503`, and storage readiness remains failed until a later write succeeds. Graceful shutdown stops accepting work and flushes mutation, maintenance, and writer queues.

Use the health endpoints according to their semantics:

| Endpoint | Auth | Meaning |
| --- | --- | --- |
| `/healthz` | none | Backward-compatible process liveness. |
| `/livez` | none | Process liveness; use for restart decisions. |
| `/readyz` | none | Durable-store/shutdown readiness; use for routing traffic. Returns `503` when unavailable. |
| `/api/status` | configured app auth | Counts, limits, storage usage, writer state, WebSocket clients, and preview-cache state. |
| `/api/metrics` | configured app auth | Prometheus text metrics; contains aggregate operational values, not clip bodies. |

Liveness intentionally does not prove that the volume has capacity or that a backup is current. Authentication protects status/metrics only when authentication is configured, so do not run an unauthenticated deployment on an exposed network.

`LOG_REQUESTS=true` emits structured JSON with request ID, method, path, status, duration, and client address for API requests/errors; bodies and query strings are not logged. Metrics collection remains active when request logging is disabled.

Example authenticated checks:

```bash
curl --fail --max-time 3 https://your-host/readyz
curl --fail --max-time 3 \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  https://your-host/api/status
curl --fail --max-time 3 \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  https://your-host/api/metrics
```

## Link-preview cache

Preview URL fragments are removed before lookup. Successful results use `LINK_PREVIEW_CACHE_TTL_MS`; failed requests use the shorter negative TTL. The cache evicts least-recently-used entries beyond `LINK_PREVIEW_CACHE_MAX_ENTRIES`, and concurrent requests for the same normalized URL share one in-flight fetch.

The cache is memory-only and per process. Set either TTL to `0` to disable that category. Cache counts and in-flight work are visible in `/api/status`; Prometheus exposes hits, misses, in-flight deduplications, and entry count.

## Direct-link and QR sharing

The UI can share an existing clip as a direct link or as a locally generated SVG QR code. QR generation follows the application's authentication policy and does not send the link or clipboard content to a third-party service. Configure `PUBLIC_ORIGIN` correctly behind a reverse proxy so generated links use the intended HTTPS origin.

## Maintenance cleanup

`POST /api/maintenance/cleanup` is protected by configured application authentication. It accepts:

```json
{
  "dryRun": true,
  "boardId": "default",
  "olderThan": 1760000000000
}
```

- `dryRun` defaults to `true`; always inspect the preview before sending `false`.
- `boardId` optionally limits clip/board matching to one existing board.
- `olderThan` is an optional past Unix timestamp in milliseconds and affects only unpinned clips.

The response separates `matched` from `deleted` counts for boards, clips, and orphan files and reports `reclaimedBytes`. Online orphan cleanup ignores files newer than `ORPHAN_GRACE_MS`; startup cleanup removes all media not referenced by the loaded store and stale metadata temp files.

Example two-step operation:

```bash
curl --fail --max-time 30 \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}' \
  https://your-host/api/maintenance/cleanup

# After reviewing matched/reclaimedBytes:
curl --fail --max-time 30 \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":false}' \
  https://your-host/api/maintenance/cleanup
```

## Metadata export is not a backup

Authenticated `GET /api/export` downloads a versioned JSON document containing boards, text, and media metadata/references. It does **not** include the bytes stored under `files/` and `images/`. It is useful for inspection and migration tooling, but cannot restore a complete installation.

Treat exports as sensitive because they include text clip contents. For disaster recovery, back up the entire data directory as described below.

## Data layout

The persistent directory contains:

```text
data/
├── store.json          # current board and clip metadata
├── store.json.bak      # previous metadata snapshot used for recovery
├── files/              # uploaded files
└── images/             # uploaded images
```

Malformed metadata may be preserved as `store.json.corrupt-<timestamp>`. The `.bak` file is local crash-recovery material, not an independent backup.

## Consistent full backup

Metadata and media are separate resources. Stop the application while taking a snapshot so they represent the same point in time.

The commands below assume the Compose example from the README, whose volume has the explicit name `wklejka-data`:

```bash
mkdir -p backups
backup="wklejka-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

docker compose stop wklejka
docker run --rm \
  -v wklejka-data:/source:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 \
  tar -C /source -czf "/backup/$backup" .
docker compose start wklejka

tar -tzf "backups/$backup" >/dev/null
```

Copy the archive to separate storage and encrypt it. Define retention and periodically test restores. For a bind mount, stop the application and archive that directory with a tool that preserves names and permissions.

## Non-destructive restore

Restore into a new volume first, keeping the current one available for rollback:

```bash
archive="$PWD/backups/wklejka-YYYYMMDDTHHMMSSZ.tar.gz"
restore_volume="wklejka-data-restored"

tar -tzf "$archive" >/dev/null
docker compose down
docker volume create "$restore_volume"
docker run --rm \
  -v "$restore_volume:/target" \
  -v "$(dirname "$archive"):/backup:ro" \
  alpine:3.22 \
  sh -eu -c '
    test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)"
    tar -C /target -xzf "/backup/$1"
    chown -R 1000:1000 /target
  ' -- "$(basename "$archive")"
```

Change the Compose volume `name` from `wklejka-data` to `wklejka-data-restored`, start the service, inspect logs, and verify boards, text, images, and downloads. Keep the old volume until validation is complete. To roll back, stop the service and restore the old volume name.

## Routine checks

- `docker compose ps` and `docker compose logs --since=1h wklejka`
- `/livez` for process health and `/readyz` for serving readiness
- authenticated `/api/status` and `/api/metrics`
- persistent-volume bytes/inodes and backup age
- a reviewed maintenance dry-run before destructive cleanup
- authentication failures, rate limits, image updates, and security advisories

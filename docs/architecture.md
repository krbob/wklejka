# Architecture

## Components

Wklejka deliberately uses a small, single-process architecture:

| Component | Responsibility |
| --- | --- |
| `server.js` | HTTP/API routing, authentication, validation, streaming media, retention/maintenance, link previews, metrics, and WebSocket fan-out. |
| `lib/durable-store.js` | Delayed atomic metadata writer, waiter coordination, readiness state, and recovery-copy rotation. |
| `lib/store.js` | Default-store creation and defensive normalization of metadata loaded from disk. |
| `lib/security.js` | Private and non-routable IP detection used by link-preview SSRF controls. |
| `lib/proxy.js` | Trusted-proxy parsing and consistent client-address selection. |
| `public/` | Dependency-free browser UI, highlighting, styles, manifest, and service worker. |
| `/app/data` | JSON metadata plus uploaded file/image bodies. |

There is no frontend build step or framework. Express serves static assets and JSON endpoints, while `ws` provides the server-push channel at `/ws`.

## Mutation and synchronization flow

1. A trusted reverse proxy terminates TLS and forwards HTTP/WebSocket traffic.
2. The server applies the configured authentication policy, per-client rate limits, and payload validation.
3. A mutation is serialized behind earlier mutations and applied to a cloned metadata draft. Streaming media first lands in a private temporary file.
4. The durable writer writes the draft to a temporary metadata file, syncs it, copies the previous `store.json` to `store.json.bak`, and atomically renames the new snapshot.
5. Only after that write succeeds does the server publish the draft in memory, acknowledge the HTTP request, and broadcast the event. A failed write returns `503` without exposing the draft; `/readyz` remains unavailable until a later successful write.

`STORE_SAVE_DEBOUNCE_MS` controls the short writer delay and `STORE_SAVE_MAX_WAIT_MS` bounds how long a pending snapshot waits. The mutation queue awaits every durable snapshot, so separate API mutations are not currently coalesced. Graceful shutdown stops new work, closes HTTP and WebSocket connections, finishes maintenance, and flushes the mutation/writer queues.

Binary clients use the raw streaming upload route, avoiding base64 copies in browser and server memory. Download routes derive safe response headers from stored metadata. Potentially active file types are attachments unless explicitly allowlisted for inline preview.

## Clip queries and live keyset pagination

`GET /api/boards/:id/clips` without a query string retains the legacy response: one JSON array. Supplying any supported query parameter returns:

```json
{
  "items": [],
  "nextCursor": "opaque-or-null",
  "total": 0
}
```

The supported parameters are `limit`, `cursor`, `q`, and `type` (`text`, `image`, or `file`). Search is case-insensitive across text and file metadata. Results are ordered by pinned state first, then creation time descending, then ID as a deterministic tie-breaker.

The cursor is an opaque live keyset, not a database snapshot. Clients must reuse the same filters and page size while following it. New/deleted clips or a pin/unpin operation can change boundaries during traversal; after a sorting-key change, the UI restarts pagination from the first page. The keyset prevents offset drift and duplicate results while the ordering remains unchanged.

Pagination limits response and rendering cost, but the process still loads all metadata and sorts/filters the selected board in memory.

## Lifecycle, retention, and maintenance

Clips may be pinned and may have an absolute `expiresAt` (or a relative `expiresIn` at update time). An explicit expiry removes a clip even if it is pinned. `CLIP_RETENTION_MS` and maintenance `olderThan` remove only unpinned clips. Board expiry continues to remove the entire non-default board.

The background expiry pass runs every 60 seconds. Operators can call `POST /api/maintenance/cleanup`; it defaults to `dryRun: true` and reports matched/deleted boards, clips, orphan files, and reclaimable bytes. Orphan candidates are protected by `ORPHAN_GRACE_MS` during online maintenance, while startup performs a complete orphan/temp cleanup after loading the authoritative store.

Bulk deletion is limited by `MAX_BULK_DELETE`, honors board locks, persists one atomic metadata mutation, and then removes committed media files.

## Local QR sharing

The UI can turn an existing clip's direct link into an SVG QR code. The server verifies that the board and clip exist, builds the link from the configured or validated public request origin, and generates the QR locally. No clip link or content is sent to an external QR service. The sharing route follows the application's authentication policy.

## Link-preview boundary and cache

Remote link-preview targets are untrusted. DNS resolution and every redirect reject local, private, documentation, and non-HTTP destinations. Response parsing is capped at 64 KiB, redirects at five, and each HTTP hop at five seconds; DNS resolution can add delay. Preview-image URLs receive the same network-target validation. Destination sites can observe the deployment's source IP and requested domain.

Successful previews use an in-memory bounded LRU-style cache. Failures use a shorter negative TTL, and concurrent requests for the same normalized URL share one in-flight fetch. The cache is per process and is lost on restart; it is observability/performance state, not persistent data.

## Operational interfaces

- `/healthz` and `/livez` are unauthenticated process-liveness aliases.
- `/readyz` is unauthenticated storage/shutdown readiness and returns `503` when the durable writer is unavailable.
- `/api/status` is protected by configured application authentication and reports counts, storage/limits, writer state, and link-preview cache state.
- `/api/metrics` is protected by the same authentication and returns Prometheus text metrics without clip contents.
- `/api/export` follows configured application authentication and returns a metadata JSON attachment. It includes text and media references, but not media bodies; it is not a full backup.

## Trust boundaries

- The browser is untrusted input. API bodies, queries/cursors, path identifiers, filenames, WebSocket paths, hosts, and origins require validation.
- The reverse proxy is trusted only when `TRUST_PROXY` explicitly says so. Forwarding headers from any other peer must be ignored.
- The persistent volume contains sensitive data and is trusted for availability, not correctness. Startup normalization restores a missing default board and rejects malformed records defensively.
- Every admitted client shares one security domain. Boards provide organization and accidental-change protection, not authorization.

## Persistence, export, and recovery

Metadata is an in-memory object backed by `store.json`; uploaded bodies are ordinary files. If an existing `store.json` is unreadable or invalid and `store.json.bak` is valid, startup preserves the corrupt file and recovers the previous snapshot. A missing primary store starts a new default store rather than automatically promoting the backup. Because metadata and media remain separate resources, an operational backup must stop the process or snapshot the whole volume atomically.

The metadata export endpoint is useful for inspection and migration tooling, but restoring it alone cannot restore files or images. See [operations.md](operations.md) for full-volume backup and non-destructive restore.

## Scaling boundaries

The current architecture is optimized for a household or small trusted team:

- one process owns in-memory metadata, rate-limit counters, timers, preview cache, metrics, and WebSocket clients;
- pagination reduces response size, but the full metadata store remains memory-resident and each query sorts/filters a board;
- each committed metadata mutation serializes a full JSON snapshot;
- local files and JSON do not coordinate replicas.

Do not run multiple replicas against the same volume. Scaling beyond one instance requires a transactional shared metadata store, object storage, shared rate-limit/session/cache state, and pub/sub for WebSocket events.

## Quality gates

`npm run check` combines ESLint, JavaScript type checks, Node tests, integration tests against isolated server processes, and scoped coverage thresholds. CI additionally lints the Dockerfile, builds and smoke-tests the hardened container. Vulnerability databases and image scanners are not pull-request or publication gates. Publication builds the actual `linux/amd64` and `linux/arm64` images and then creates the canonical multi-platform `sha-*` and `latest` manifests.

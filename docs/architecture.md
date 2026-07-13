# Architecture

## Components

Wklejka deliberately uses a small, single-process architecture:

| Component | Responsibility |
| --- | --- |
| `server.js` | HTTP/API routing, authentication, validation, media handling, link-preview fetching, persistence coordination, and WebSocket fan-out. |
| `lib/store.js` | Default-store creation and defensive normalization of metadata loaded from disk. |
| `lib/security.js` | Private and non-routable IP detection used by link-preview SSRF controls. |
| `lib/proxy.js` | Trusted-proxy parsing and consistent client-address selection. |
| `public/` | Dependency-free browser UI, highlighting, styles, manifest, and service worker. |
| `/app/data` | JSON metadata plus uploaded file/image bodies. |

There is no build step or frontend framework. Express serves static assets and JSON endpoints, while `ws` provides a server-push channel at `/ws`.

## Request and synchronization flow

1. The reverse proxy terminates TLS and forwards HTTP/WebSocket traffic.
2. The server authenticates the request, applies per-client rate limits, and validates the payload.
3. A mutation updates in-memory metadata and media under `DATA_DIR`.
4. The metadata writer uses a temporary file, filesystem sync, and atomic rename; the previous snapshot is retained as `store.json.bak`.
5. The server broadcasts the resulting event to connected clients. Browsers reconcile it with the active board and can resynchronize from the REST API after reconnecting.

Binary clients use the raw streaming upload route so a file does not need to be represented as base64 in browser and server memory. Download routes derive safe response headers from stored metadata. Potentially active file types are attachments unless explicitly allowlisted for inline preview.

## Trust boundaries

- The browser is untrusted input. API bodies, path identifiers, filenames, WebSocket paths, hosts, and origins require validation.
- The reverse proxy is trusted only when `TRUST_PROXY` explicitly says so. Forwarding headers from any other peer must be ignored.
- Remote link-preview targets are untrusted. Resolution and every redirect must reject local, private, documentation, and non-HTTP destinations; response size and time are bounded.
- The persistent volume contains sensitive data and is trusted for availability, not correctness. Startup normalization and recovery handle malformed metadata defensively.
- Authenticated users share one security domain. Boards isolate organization and accidental deletion, not authorization.

## Persistence and recovery

Metadata is an in-memory object backed by `store.json`; uploaded bodies are ordinary files. A clean shutdown flushes pending metadata, and startup can recover from the previous snapshot. Orphan media is removed at startup.

Because metadata and media are separate resources, an operational backup must stop the process or snapshot the entire volume atomically. See [operations.md](operations.md).

## Scaling boundaries

The current architecture is optimized for a household or small trusted team:

- one process owns in-memory state, rate-limit counters, timers, and WebSocket clients;
- the full metadata store and board clip lists are loaded and returned without cursor pagination;
- each metadata snapshot serializes the store;
- local files and JSON do not provide coordination between replicas.

Do not run multiple replicas against the same volume. Scaling beyond one instance requires a transactional shared metadata store, object storage, shared rate-limit/session state, and a pub/sub transport for WebSocket events. Large histories additionally require retention, pagination, and lazy media loading.

## Quality gates

`npm run check` combines:

- ESLint across server, browser, helpers, scripts, and tests;
- TypeScript `checkJs` for typed helper/test boundaries;
- Node's test runner with line, branch, and function coverage thresholds.

CI also builds and smoke-tests the container, checks the Dockerfile, scans the final image for high/critical known vulnerabilities, and publishes only after the test job succeeds.

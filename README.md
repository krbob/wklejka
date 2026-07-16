# Wklejka

[![CI](https://img.shields.io/github/actions/workflow/status/krbob/wklejka/ci.yml?branch=main&label=CI)](https://github.com/krbob/wklejka/actions/workflows/ci.yml)
[![Container](https://img.shields.io/badge/container-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/krbob/wklejka/pkgs/container/wklejka)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f855a)](LICENSE)

Wklejka is a self-hosted shared clipboard for moving text, images, and files between your browser, phone, and computer in real time. It needs no native client or cloud service: one small Node.js process serves the browser/PWA, stores data on your disk, and synchronizes connected devices over WebSocket.

<img src="screenshot.png" alt="Wklejka interface with boards, a composer, search and type filters, and pinned shared clips">

## Highlights

### Everyday use

- Paste text or images, drag and drop files, and stream uploads up to 100 MB by default.
- Organize clips into boards with search, type filters, cursor pagination, rename, reorder, expiry, and protection from accidental changes.
- Pin important clips, set per-clip expiry, select and delete in bulk, and keep every open browser synchronized.
- Copy, edit, download, or preview content; share a direct link or a locally generated QR code without sending clipboard data to a QR service.
- Install the responsive PWA, use light or dark mode, and switch automatically between the Polish and English interface.

### Built for self-hosting

- Single-process architecture with ordinary JSON metadata and file storage—no external database or cloud account.
- Optional deployment-wide Basic or token authentication, request limits, strict input validation, origin-checked WebSockets, and SSRF-resistant link previews.
- Durable metadata snapshots, recovery copy, retention, maintenance dry-runs, orphan cleanup, and full-volume backup guidance.
- Auth-aware status, Prometheus metrics, metadata export, liveness/readiness endpoints, and structured request logs.
- Hardened multi-platform container images for `linux/amd64` and `linux/arm64`, scanned before publication.

## Quick start on localhost

The following starts a hardened local evaluation instance and keeps its data in the `wklejka-data` Docker volume:

```bash
docker volume create wklejka-data
docker run --rm --name wklejka \
  --init \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 100 \
  --stop-timeout 10 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m,mode=1777 \
  -p 127.0.0.1:3000:3000 \
  -v wklejka-data:/app/data \
  ghcr.io/krbob/wklejka:latest
```

Open <http://localhost:3000>. Stop the foreground container with `Ctrl+C`; the named volume remains available for the next run. For a bind mount such as `./data:/app/data`, make the directory writable by UID/GID `1000` used by the image.

This command deliberately binds only to loopback and is for local use. The floating `latest` tag is convenient for evaluation but is not immutable.

## Secure access from other devices

Clipboard contents are often sensitive. For phone, tablet, LAN, VPN, or Internet access, deploy one instance behind HTTPS, enable authentication, keep the raw application port private, and pin a tested `sha-*` tag or manifest digest.

Use the tracked [production Compose file](compose.prod.yaml) with [.env.example](.env.example), then follow the [secure deployment guide](docs/deployment.md) for proxy and TLS configuration. Browsers restrict clipboard access, notifications, and service workers on insecure non-localhost origins.

Wklejka is intended for a trusted household or small team, not mutually untrusted tenants. It has no user-account database: Basic or token authentication protects the whole deployment with a shared credential. Board locks prevent accidental mutations; they are not an authorization boundary.

## Essential configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `AUTH_TOKEN` | unset | Enable bearer and HttpOnly-cookie token authentication. |
| `AUTH_USERNAME`, `AUTH_PASSWORD` | unset | Enable HTTP Basic authentication when both are set. |
| `AUTH_COOKIE_SECURE` | `auto` | Set `true` behind HTTPS. |
| `PUBLIC_ORIGIN` | inferred | Canonical HTTPS origin for WebSocket validation and shared links. |
| `TRUST_PROXY` | disabled | Trusted reverse-proxy hop count or range; commonly `1`. |
| `MAX_CLIP_BINARY_BYTES` | `104857600` | Maximum bytes in one image or file. |
| `MAX_STORAGE_BYTES` | `5368709120` | Aggregate quota for referenced binary content. |
| `CLIP_RETENTION_MS` | `0` | Age-based removal of unpinned clips; `0` disables it. |

See [operations](docs/operations.md) for the complete environment reference, capacity planning, maintenance, and data layout. Configuration changes require a process restart or container recreation.

## Data, backups, and upgrades

Metadata lives in `store.json`; uploaded images and files are stored separately under the data directory. `/api/export` is useful for inspection and migration tooling but does **not** contain media bodies and is not a complete backup.

- [Consistent full-volume backup and non-destructive restore](docs/operations.md#consistent-full-backup)
- [Upgrade, verification, and rollback procedure](docs/upgrading.md)

## Documentation

- [Secure HTTPS/WSS deployment and authentication](docs/deployment.md)
- [Configuration, quotas, backup, restore, and maintenance](docs/operations.md)
- [HTTP API and WebSocket reference](docs/api.md)
- [Architecture, trust boundaries, and scaling limits](docs/architecture.md)
- [Security policy and private vulnerability reporting](SECURITY.md)

## Development

Node.js 24 and npm 11 are the tested development baseline.

```bash
nvm use
npm ci
npm run check
DATA_DIR="$(mktemp -d)" npm start
```

`npm run check` runs ESLint, JavaScript type checks, tests, and scoped coverage thresholds for the core libraries and syntax highlighter. The native development server listens on all interfaces; do not run it without authentication on an untrusted network. The container quick start above keeps local evaluation bound to `127.0.0.1`.

The UI follows `navigator.languages`; override it with `?lang=pl` or `?lang=en`.

## License

[MIT](LICENSE)

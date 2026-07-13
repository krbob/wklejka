# Operations

## Environment reference

All byte values and rate limits are positive base-10 integers. Invalid or non-positive values fall back to their defaults.

| Variable | Default | Notes |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP listener inside the container. |
| `DATA_DIR` | `/app/data` in the image | Metadata and media root. Mount persistent storage here. |
| `MAX_CLIP_BINARY_BYTES` | `104857600` | Maximum binary bytes in one file or image clip. |
| `MAX_TEXT_CLIP_BYTES` | `1048576` | Maximum UTF-8 bytes in one text clip. |
| `MAX_BOARDS` | `100` | Maximum number of boards. |
| `MAX_CLIPS_PER_BOARD` | `10000` | Maximum clips in one board. |
| `MAX_TOTAL_CLIPS` | `50000` | Maximum clips across all boards. |
| `MAX_STORAGE_BYTES` | `5368709120` | Aggregate quota for referenced image/file bodies and active uploads. |
| `MAX_BOARD_NAME_LENGTH` | `120` | Maximum board-name characters. |
| `MAX_ORIGINAL_NAME_LENGTH` | `255` | Maximum uploaded original-name characters. |
| `AUTH_USERNAME` + `AUTH_PASSWORD` | unset | Enables Basic authentication when both are non-empty. |
| `AUTH_TOKEN` | unset | Enables bearer and HttpOnly-cookie token authentication. |
| `AUTH_COOKIE_SECURE` | `auto` | `true`, `false`, or `auto`; use `true` behind HTTPS. |
| `AUTH_RATE_LIMIT` | `20` | Failed authentication attempts per client per minute. |
| `API_RATE_LIMIT` | `600` | API requests per client per minute. |
| `LINK_PREVIEW_RATE_LIMIT` | `30` | Link-preview requests per client per minute. |
| `TRUST_PROXY` | disabled | Express proxy trust setting; prefer an explicit hop count. |
| `PUBLIC_ORIGIN` | inferred from request | Exact WebSocket browser origin. |
| `PUBLIC_ORIGINS` | unset | Comma-separated alternative to `PUBLIC_ORIGIN`. |
| `MAX_WS_CLIENTS` | `100` | Maximum simultaneous WebSocket clients. |
| `MAX_WS_PAYLOAD_BYTES` | `65536` | Maximum incoming WebSocket frame payload. Clients normally send no frames. |
| `MAX_WS_BACKPRESSURE_BYTES` | `1048576` | Disconnect a client whose queued outbound data exceeds this value. |
| `WS_HEARTBEAT_MS` | `30000` | Ping interval used to remove dead connections. |
| `WS_ALLOW_NO_ORIGIN` | `false` | Permit non-browser WebSocket clients without `Origin`; avoid when possible. |

`WKLEJKA_TOKEN`, `WKLEJKA_USER`, and `WKLEJKA_PASSWORD` remain accepted as compatibility aliases, but new deployments should use the canonical `AUTH_*` names.

## Capacity and quotas

Wklejka enforces limits for boards, clips, each payload, and the aggregate bytes occupied by referenced images/files. Active streaming uploads reserve quota as bytes arrive. Requests that exceed the binary storage quota fail with HTTP `507`; count limits fail with `409`.

`MAX_STORAGE_BYTES` is an application-level binary quota, not a filesystem reservation. It does not include `store.json`, recovery/corrupt copies, archive backups, or filesystem overhead. Set it below the actual volume capacity and retain enough headroom for atomic metadata writes and operations.

For predictable operation:

- place `/app/data` on a filesystem or volume with a known capacity and alert before it fills;
- set the per-clip and aggregate limits below the available memory, proxy limits, and volume capacity;
- use expiring boards for transient transfers and delete obsolete clips;
- monitor `du -sh` for the data directory and free inodes as well as bytes;
- allow headroom for `store.json`, its recovery copy, temporary writes, and backup creation.

Metadata is held in memory and serialized as one JSON document. Very large clip collections increase startup, write, and API response costs. Run only one Wklejka instance against a data directory.

## Data layout

The persistent directory contains:

```text
data/
├── store.json          # current board and clip metadata
├── store.json.bak      # previous metadata snapshot used for recovery
├── files/              # uploaded files
└── images/             # uploaded images
```

Malformed metadata may be preserved as `store.json.corrupt-<timestamp>`. The `.bak` file is local crash-recovery material, not a substitute for an independent backup.

## Consistent backup

The metadata document and media files are not one transactional database. Stop the application while taking a snapshot so they represent the same point in time.

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

Copy the archive to separate storage. Encrypt it because it contains clipboard contents and uploaded files. Define retention and periodically test restores.

For a bind mount, stop the application and archive that directory with a tool that preserves names and permissions.

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

Change the Compose volume `name` from `wklejka-data` to `wklejka-data-restored`, start the service, inspect the logs, and verify boards, text, images, and downloads. Keep the old volume until validation is complete. To roll back, stop the service and restore the old volume name.

## Routine checks

- `docker compose ps` and `docker compose logs --since=1h wklejka`
- `curl --fail --max-time 3 https://your-host/healthz`
- persistent-volume usage, inode usage, and backup age
- authentication failures and rate-limit responses at the reverse proxy
- availability of a tested image update and security advisories

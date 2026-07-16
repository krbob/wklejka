# Upgrading and rollback

Wklejka publishes `linux/amd64` and `linux/arm64` images after the complete CI test, container smoke-test, and platform-image scan succeed. Every successful `main` build produces a multi-platform `sha-<full-git-sha>` tag and moves the floating `latest` tag.

Use a commit-scoped tag or manifest digest for a reproducible deployment. Do not perform a rolling upgrade or run old and new versions against the same data volume: Wklejka supports one process per data directory.

## Before upgrading

1. Choose a commit whose GitHub Actions run is green and review the commits since the currently deployed version.
2. Record the active image reference and resolved image ID:

   ```bash
   docker inspect wklejka-wklejka-1 \
     --format 'configured={{.Config.Image}} resolved={{.Image}}'
   ```

   Adjust the container name if the Compose project uses a different name.
3. Create and verify a [consistent full-volume backup](operations.md#consistent-full-backup). `/api/export` is not sufficient because it omits image and file bodies.
4. Record the current `WKLEJKA_IMAGE` and `WKLEJKA_DATA_VOLUME` values from `.env` so both can be restored.

## Upgrade with the production Compose profile

Set `WKLEJKA_IMAGE` in `.env` to the chosen full tag or digest, for example:

```dotenv
WKLEJKA_IMAGE=ghcr.io/krbob/wklejka:sha-<full-git-sha>
```

Validate, pull, and recreate only the application service:

```bash
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml pull wklejka
docker compose -f compose.prod.yaml up -d --no-deps wklejka
```

Wait for durable-store readiness and inspect startup logs:

```bash
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 \
    http://127.0.0.1:3000/readyz >/dev/null; then
    break
  fi
  if [ "$attempt" = 30 ]; then
    docker compose -f compose.prod.yaml logs --tail=200 wklejka
    exit 1
  fi
  sleep 1
done

docker compose -f compose.prod.yaml logs --since=5m wklejka
```

Change the local port in the readiness URL if `WKLEJKA_HOST_PORT` is not `3000`.

## Post-upgrade verification

Verify through the public HTTPS origin, not only the loopback port:

1. `/livez` and `/readyz` return `200`.
2. An unauthenticated `/api/boards` request is rejected and an authenticated request succeeds.
3. Existing boards, text, images, and file downloads are present.
4. A small text mutation and file upload persist after a container restart.
5. Two browsers receive a new clip over `wss://` without reloading.
6. Direct links and local QR sharing use the expected public HTTPS origin.
7. `/api/status` reports storage ready and the expected limits.

Keep the pre-upgrade backup until these checks and a normal operating period complete.

## Rollback

If the new container fails before it writes data, restoring the previous `WKLEJKA_IMAGE` and recreating the service may be sufficient. Once a newer version has accepted mutations, do not assume that an older version can safely consume the resulting metadata. Backward compatibility of the on-disk store is not guaranteed.

The safe rollback is therefore the previous image **and** a restored pre-upgrade volume:

1. Follow [non-destructive restore](operations.md#non-destructive-restore) to prepare a new volume from the backup while the current volume remains intact.
2. Set the previous `WKLEJKA_IMAGE` and the restored `WKLEJKA_DATA_VOLUME` in `.env`.
3. Recreate the service:

   ```bash
   docker compose -f compose.prod.yaml config --quiet
   docker compose -f compose.prod.yaml up -d --force-recreate wklejka
   ```

4. Repeat the readiness, authentication, data, upload/download, WebSocket, and QR checks above.

Keep both volumes until the rollback is verified. Changes accepted after the pre-upgrade backup are not present in the restored volume; reconcile them manually only after preserving both copies.

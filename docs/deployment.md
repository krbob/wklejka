# Secure deployment

## Recommended topology

Run one Wklejka instance behind a trusted reverse proxy:

```text
browser -- HTTPS/WSS --> reverse proxy -- HTTP/WS --> wklejka:3000
                                            |
                                      persistent volume
```

TLS is required for normal browser clipboard, notification, and service-worker functionality on every host except `localhost`. The WebSocket endpoint is `/ws`. Caddy forwards WebSocket upgrades automatically; nginx requires the explicit HTTP/1.1 and upgrade headers shown below.

Do not expose port 3000 publicly when a proxy is in front of it. Bind it to loopback on a host installation or expose it only on a private container network.

## Authentication

Choose at least one deployment-wide authentication mode. Wklejka does not have per-user accounts or board-level authorization.

### HTTP Basic authentication

Set both variables to enable it:

```dotenv
AUTH_USERNAME=wklejka
AUTH_PASSWORD=<a-long-random-password>
```

Setting only one leaves Basic authentication disabled. Basic credentials accompany requests, so use this mode only over HTTPS.

### Token authentication

Set a high-entropy token:

```dotenv
AUTH_TOKEN=<at-least-32-random-bytes>
AUTH_COOKIE_SECURE=true
```

Opening `https://your-host/?token=<token>` once exchanges the token for an HttpOnly, `SameSite=Strict` session cookie. The UI removes the query from the visible URL, but the initial request can still appear in browser history, proxy logs, monitoring, or copied links. Redact query strings or disable access logging for this bootstrap route.

Generate secrets locally, for example with `openssl rand -hex 32`. Store `.env` with mode `0600`, do not commit it, and rotate a shared credential when someone should lose access. There is no logout endpoint; clearing site data removes the browser cookie, while rotating `AUTH_TOKEN` invalidates all existing token cookies.

## Reverse-proxy trust and public origin

For a single proxy hop, use:

```dotenv
TRUST_PROXY=1
PUBLIC_ORIGIN=https://clipboard.example.net
AUTH_COOKIE_SECURE=true
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=false
```

`PUBLIC_ORIGIN` must be one exact HTTP(S) origin—scheme, hostname, and optional non-default port, without credentials, query, or path. It validates browser WebSockets and becomes the canonical base for direct links and QR sharing. Use `PUBLIC_ORIGINS` with a comma-separated list only when several origins are genuinely required; shared links then use the validated request origin because no single canonical origin exists. Malformed entries are ignored, so verify the resulting WebSocket and QR behavior after every change.

`TRUST_PROXY=1` means the direct peer is trusted to supply forwarding headers. Use it only when clients cannot bypass that proxy. For another topology, set an explicit hop count or trusted address/range. Never use `TRUST_PROXY=true` on an Internet-reachable application port.

Requests without an `Origin` header are rejected from WebSocket by default. `WS_ALLOW_NO_ORIGIN=true` is intended only for a controlled non-browser client and weakens cross-site protection.

HSTS is emitted only when Wklejka recognizes the request as HTTPS, which requires correct proxy trust and `X-Forwarded-Proto`. Set `HSTS_MAX_AGE=0` while initially validating TLS if necessary. Do not enable `HSTS_INCLUDE_SUBDOMAINS` unless every current and future subdomain is HTTPS-capable.

## Production Compose profile

The repository contains a canonical [production Compose file](../compose.prod.yaml) and [.env template](../.env.example). The profile requires token authentication, binds the raw service to loopback, persists `/app/data`, and applies the same runtime hardening exercised by CI.

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Edit `.env` and replace:

- `WKLEJKA_IMAGE` with a tested full `sha-<git-sha>` tag or manifest digest;
- `AUTH_TOKEN` with the generated secret;
- `PUBLIC_ORIGIN` with the public HTTPS origin;
- `WKLEJKA_HOST_PORT` or capacity settings when needed.

Then validate and start:

```bash
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

The image runs as UID/GID `1000`. `read_only` protects the image filesystem while the named `/app/data` volume remains writable. The `/tmp` tmpfs is non-executable and ephemeral. The public multi-platform tag supports `linux/amd64` and `linux/arm64`.

For a registry-enforced immutable deployment, prefer `ghcr.io/krbob/wklejka@sha256:...` over a tag. `latest` changes after every successful `main` publication and is intended only for convenient evaluation.

## Caddy example

Keep Wklejka bound to `127.0.0.1:3000`, use the proxy/origin variables above, and configure:

```caddyfile
clipboard.example.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews a public certificate when DNS points at the host. For a private name, use an internal CA only if its root certificate is installed and trusted on every client; an untrusted certificate does not create a browser secure context.

## nginx example

The `map` belongs in the nginx `http` context. The `server` block shows the forwarding settings relevant to Wklejka; add your normal TLS certificate configuration.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name clipboard.example.net;

    # Covers the default 100 MB streaming upload. Raise this with
    # MAX_CLIP_BINARY_BYTES; legacy JSON/base64 clients need ~37% more.
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Preserve streaming uploads and long-lived WebSockets.
        proxy_request_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Tune proxy/body/idle timeouts and infrastructure limits together with `MAX_CLIP_BINARY_BYTES`. A proxy can reject a request before application quotas are evaluated.

## Network and container hardening

- Permit inbound HTTPS only from the intended LAN, VPN, or Internet ranges. Keep the raw application port private.
- Use the image's built-in non-root user, drop capabilities, prevent privilege escalation, and keep only `/app/data` plus a small `/tmp` tmpfs writable.
- Apply CPU, memory, process, and persistent-volume limits appropriate to the upload limit and number of active users.
- Keep `WS_ALLOW_NO_ORIGIN=false`, use practical request limits, and set `MAX_WS_CLIENTS` for the deployment size.
- Use unauthenticated `/livez` for process liveness and `/readyz` for routing readiness. Readiness reflects writer/shutdown state, not free disk capacity or backup freshness.
- Status, metrics, export, and maintenance follow the shared auth policy; they are public when authentication is disabled.
- Link-preview requests leave the Wklejka host, so destination sites can observe its source IP and requested domain. Disable or restrict use at the network layer if that does not fit the threat model.
- Keep the host, proxy, and container runtime patched. Review Renovate changes and image scan results before deployment.

## Verification checklist

After deployment:

1. Confirm the browser reports a valid trusted certificate and secure context.
2. Confirm `/livez` and `/readyz` return `200`.
3. Verify unauthenticated `/api/boards`, `/api/status`, `/api/metrics`, and `/api/export` requests are rejected.
4. Open two authenticated browsers and verify real-time synchronization over `wss://`.
5. Verify a WebSocket connection with an unrelated `Origin` is rejected.
6. Upload/download a small file and verify it appears in authenticated status/metrics.
7. Verify a direct link and QR code use `PUBLIC_ORIGIN` and open the intended clip.
8. Preview maintenance cleanup; do not execute destructive cleanup as a connectivity test.
9. Perform a full-volume backup and test its non-destructive restore. Metadata export alone is insufficient.

Use the [upgrade and rollback runbook](upgrading.md) for image changes.

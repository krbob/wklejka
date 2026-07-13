# Secure deployment

## Recommended topology

Run Wklejka as a single instance behind a trusted reverse proxy:

```text
browser -- HTTPS/WSS --> reverse proxy -- HTTP/WS --> wklejka:3000
                                            |
                                      persistent volume
```

TLS is required for normal browser clipboard and service-worker functionality on every host except `localhost`. The WebSocket endpoint is `/ws`; common reverse proxies, including Caddy and nginx, forward its upgrade automatically.

Do not expose port 3000 publicly when a proxy is in front of it. Restrict it to loopback on a host installation or only `expose` it on a private container network.

## Authentication

Choose at least one application authentication mode:

### HTTP Basic authentication

Set both variables to enable it:

```dotenv
AUTH_USERNAME=wklejka
AUTH_PASSWORD=<a-long-random-password>
```

Basic credentials accompany requests, so this mode must only be used over HTTPS.

### Token authentication

Set a high-entropy token:

```dotenv
AUTH_TOKEN=<at-least-32-random-bytes>
AUTH_COOKIE_SECURE=true
```

Opening `https://your-host/?token=<token>` once exchanges the token for an HttpOnly, `SameSite=Strict` cookie. The UI removes the query from browser history, but the initial URL can still appear in reverse-proxy access logs. Redact query strings or disable access logging for this route, and never send the URL through an untrusted service.

Generate secrets locally, for example with `openssl rand -base64 32`. Store the environment file with restrictive permissions (`chmod 600`) and do not commit it.

## Reverse-proxy settings

For a single proxy hop, configure:

```dotenv
TRUST_PROXY=1
PUBLIC_ORIGIN=https://clipboard.example.net
AUTH_COOKIE_SECURE=true
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=false
```

`PUBLIC_ORIGIN` must be an exact origin: scheme, hostname, and optional non-default port, without a path. Use `PUBLIC_ORIGINS` with a comma-separated list only when several origins are genuinely required. The allowlist protects the WebSocket from cross-site connections.

`TRUST_PROXY=1` means the direct peer is trusted to supply forwarding headers. Use it only when clients cannot bypass that proxy. For a different topology, set an explicit hop count or trusted address/range. Never use `TRUST_PROXY=true` on an Internet-reachable application port.

Requests without an `Origin` header are rejected from WebSocket by default. `WS_ALLOW_NO_ORIGIN=true` is intended only for a controlled non-browser client and weakens cross-site protection.

HSTS is emitted only when Wklejka recognizes the request as HTTPS, which requires correct proxy trust and `X-Forwarded-Proto`. Set `HSTS_MAX_AGE=0` while initially validating TLS if necessary. Do not enable `HSTS_INCLUDE_SUBDOMAINS` unless every current and future subdomain is HTTPS-capable.

## Hardened Compose example

The following example assumes Caddy runs on the same host and reaches the application through loopback. Replace `sha-REPLACE_ME` with the tested `sha-<full-git-sha>` tag produced by CI and put a random token in a mode-`0600` `.env` file. For registry-enforced immutability, deploy the corresponding multi-platform manifest digest (`ghcr.io/krbob/wklejka@sha256:...`) instead of any tag.

```bash
umask 077
printf 'AUTH_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
```

```yaml
services:
  wklejka:
    image: ghcr.io/krbob/wklejka:sha-REPLACE_ME
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      AUTH_TOKEN: ${AUTH_TOKEN:?Set AUTH_TOKEN in .env}
      AUTH_COOKIE_SECURE: "true"
      TRUST_PROXY: "1"
      PUBLIC_ORIGIN: "https://clipboard.example.net"
      MAX_STORAGE_BYTES: "5368709120"
      LOG_REQUESTS: "true"
      HSTS_MAX_AGE: "31536000"
      HSTS_INCLUDE_SUBDOMAINS: "false"
    volumes:
      - wklejka-data:/app/data
    init: true
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=16m,mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 100
    stop_grace_period: 10s
    restart: unless-stopped

volumes:
  wklejka-data:
    name: wklejka-data
```

The image already runs as an unprivileged user. `read_only` protects the image filesystem while the named `/app/data` volume remains writable. The tmpfs is available for libraries that expect `/tmp`; it is non-executable and not persistent. Tune storage, memory, CPU, and proxy upload timeouts for your chosen upload limit.

## Caddy example

Keep the application bound to `127.0.0.1:3000`, set the variables above, and use:

```caddyfile
clipboard.example.net {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews a public certificate when DNS points at the host. For a private name, use an internal CA only if its root certificate is installed and trusted on every client; an untrusted certificate does not create a browser secure context.

An equivalent nginx location must forward `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Upgrade`, and `Connection`, and should apply request and idle timeouts that accommodate the configured upload size and long-lived WebSocket.

## Network and container hardening

- Permit inbound HTTPS only from the intended LAN, VPN, or Internet ranges. Keep the raw application port private.
- Prefer a full commit-scoped `sha-*` tag after testing it, or pin the manifest digest when strict immutability is required. `latest` changes over time.
- Run as the image's built-in non-root user, drop capabilities, prevent privilege escalation, and keep only `/app/data` plus a small `/tmp` tmpfs writable.
- Apply CPU, memory, process, and persistent-volume limits appropriate to `MAX_CLIP_BINARY_BYTES` and the number of active users.
- Keep `WS_ALLOW_NO_ORIGIN=false`, use the smallest practical rate limits, and set `MAX_WS_CLIENTS`.
- Use unauthenticated `/livez` for process liveness and `/readyz` for traffic readiness. `/healthz` remains a compatibility liveness alias. Readiness reflects durable-writer/shutdown state, not free disk capacity or backup freshness.
- Keep `/api/status`, `/api/metrics`, `/api/export`, and maintenance behind authentication; they follow the application's auth policy and become public if auth is disabled.
- Keep the host, reverse proxy, and container runtime patched. Review Renovate pull requests before deployment.

## Verification checklist

After deployment:

1. Confirm the browser reports a valid trusted certificate and a secure context.
2. Confirm `/livez` returns `200`, then confirm `/readyz` returns `200` with storage ready.
3. Verify an unauthenticated `/api/boards`, `/api/status`, and `/api/metrics` request is rejected.
4. Open two authenticated browsers and verify real-time synchronization over `wss://`.
5. Verify a connection with an unrelated `Origin` is rejected.
6. Upload/download a small file and verify it appears in authenticated status/metrics.
7. Preview a maintenance dry-run; do not run destructive cleanup as a connectivity test.
8. Perform a full-volume backup and test its non-destructive restore. A metadata export alone is insufficient.

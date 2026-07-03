# wklejka

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/krbob/wklejka/ci.yml)

Lightweight, browser-based shared clipboard. Paste text, images or files on one computer and instantly pick them up on another. Real-time sync via WebSocket, no sign-up required.

![screenshot](screenshot.png)

## Getting started

1. Make sure Docker is installed.
2. Create a `docker-compose.yml` file:

```yaml
services:
  wklejka:
    image: ghcr.io/krbob/wklejka:latest
    ports:
      - "3000:3000"
    volumes:
      - wklejka-data:/app/data
    restart: unless-stopped

volumes:
  wklejka-data:
```

3. Start the service: `docker compose up -d`.
4. Open `http://localhost:3000` in a browser (from another machine: `http://<IP>:3000`).

Alternatively, run the container directly:

```bash
docker run --rm -p 3000:3000 -v wklejka-data:/app/data ghcr.io/krbob/wklejka:latest
```

If you prefer a bind mount such as `./data:/app/data`, make sure the directory is writable by UID 1000 (`node` inside the container).

## Features

- **Text, images & files** – paste (Ctrl+V), drag and drop, or use the file picker. Any file type up to 100 MB by default. Inline preview for PDFs, videos, and audio.
- **Real-time sync** – WebSocket instantly propagates changes to every open browser.
- **Tabs** – separate virtual documents (e.g. "Work", "Home") with optional auto-expiry (1 h, 24 h, 7 d, 30 d). Drag to reorder, double-click to rename.
- **Tab locking** – lock a tab to prevent accidental deletion of the tab or its clips. Unlocking requires typing the tab name (like deleting a GitHub repo).
- **Copy / Download / Delete** – on every entry. Delete requires inline confirmation.
- **Search, edit & direct links** – filter clips in the current tab, edit text clips, and copy a direct link to any clip.
- **Syntax highlighting** – code-like text clips get lightweight inline highlighting.
- **Upload progress** – large files show read/upload progress instead of a plain spinner.
- **Link previews** – URLs in text clips automatically show a preview card with title, description, and image.
- **Dark mode** – auto-detects system preference, manual toggle in header. Persisted across sessions.
- **Persistent storage** – data lives in `/app/data` (a Docker volume by default) and survives container restarts.
- **Startup orphan cleanup** – unreferenced files in `data/files` and `data/images` are removed when the app starts.
- **Multilingual** – UI automatically switches between Polish and English based on browser language.

## Configuration

- `MAX_CLIP_BINARY_BYTES` – max binary upload size, default `104857600` (100 MB).
- `MAX_TEXT_CLIP_BYTES` – max text clip size, default `1048576` (1 MB).
- `AUTH_USERNAME` and `AUTH_PASSWORD` – enable HTTP Basic Auth.
- `AUTH_TOKEN` – enable token auth. Open `/?token=<token>` once to set an HttpOnly cookie.
- `AUTH_RATE_LIMIT` – max failed authentication attempts per minute per client, default `20`.
- `API_RATE_LIMIT` – max API requests per minute per client, default `600`.
- `LINK_PREVIEW_RATE_LIMIT` – max link preview requests per minute per client, default `30`.

## UI language

Language is detected automatically from the browser language list (`navigator.languages`, falling back to `navigator.language`). You can override it with a URL parameter:

- `http://localhost:3000?lang=pl` – Polish
- `http://localhost:3000?lang=en` – English

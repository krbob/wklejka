const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const {
  clientAddress,
  compileTrustProxy,
  parseTrustProxy,
} = require('./lib/proxy');
const { isPrivateAddress } = require('./lib/security');
const { createDefaultStore, normalizeStore } = require('./lib/store');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const FILES_DIR = path.join(DATA_DIR, 'files');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const STORE_BACKUP_FILE = path.join(DATA_DIR, 'store.json.bak');
const SAFE_IMAGE_MIME_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);
const IMAGE_EXT_TO_MIME = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
]);
const INLINE_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'audio/aac',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/ogg',
  'video/quicktime',
  'video/webm',
]);
const INLINE_FILE_EXT_TO_MIME = new Map([
  ['pdf', 'application/pdf'],
  ['aac', 'audio/aac'],
  ['flac', 'audio/flac'],
  ['m4a', 'audio/mp4'],
  ['mp3', 'audio/mpeg'],
  ['ogg', 'audio/ogg'],
  ['wav', 'audio/wav'],
  ['mov', 'video/quicktime'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
]);
const MAX_LINK_PREVIEW_REDIRECTS = 5;
const MAX_LINK_PREVIEW_BYTES = 64 * 1024;
const DEFAULT_MAX_TEXT_CLIP_BYTES = 1024 * 1024;
const MAX_TEXT_CLIP_BYTES = readPositiveInt(process.env.MAX_TEXT_CLIP_BYTES, DEFAULT_MAX_TEXT_CLIP_BYTES);
const DEFAULT_MAX_CLIP_BINARY_BYTES = 100 * 1024 * 1024;
const MAX_CLIP_BINARY_BYTES = (() => {
  const parsed = Number.parseInt(process.env.MAX_CLIP_BINARY_BYTES || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CLIP_BINARY_BYTES;
})();
// Base64 expands binary payloads by roughly 33%; keep some extra headroom for the data URL prefix and JSON.
const JSON_BODY_LIMIT_BYTES = Math.ceil(MAX_CLIP_BINARY_BYTES * 1.37) + 1024 * 1024;
const AUTH_TOKEN = process.env.AUTH_TOKEN || process.env.WKLEJKA_TOKEN || '';
const AUTH_USERNAME = process.env.AUTH_USERNAME || process.env.WKLEJKA_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.WKLEJKA_PASSWORD || '';
const AUTH_ENABLED = Boolean(AUTH_TOKEN || (AUTH_USERNAME && AUTH_PASSWORD));
const AUTH_COOKIE = 'wklejka_token';
const AUTH_COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || 'auto').trim().toLowerCase();
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);
const TRUST_PROXY_FN = compileTrustProxy(TRUST_PROXY);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT = readPositiveInt(process.env.AUTH_RATE_LIMIT, 20);
const API_RATE_LIMIT = readPositiveInt(process.env.API_RATE_LIMIT, 600);
const LINK_PREVIEW_RATE_LIMIT = readPositiveInt(process.env.LINK_PREVIEW_RATE_LIMIT, 30);

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findClipByFilename(filename) {
  for (const clips of Object.values(store.clips)) {
    const clip = clips.find(item => item.filename === filename);
    if (clip) return clip;
  }
  return null;
}

function downloadBasename(name, fallback = 'file') {
  const normalized = String(name || fallback).replace(/\\/g, '/');
  const base = path.basename(normalized).replace(/[\0\r\n]/g, '_');
  return base || fallback;
}

function safeAsciiDownloadName(name, fallback = 'file') {
  const ascii = downloadBasename(name, fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return ascii || fallback;
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
}

function contentDisposition(disposition, filename) {
  const name = downloadBasename(filename);
  const fallback = safeAsciiDownloadName(name);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(name)}`;
}

function setDownloadHeaders(res, { contentType, disposition, filename }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDisposition(disposition, filename));
  if (contentType) res.type(contentType);
}

function guessImageMimeType(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return IMAGE_EXT_TO_MIME.get(ext) || null;
}

function guessInlineFileMimeType(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return INLINE_FILE_EXT_TO_MIME.get(ext) || null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIdx = -1;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unitIdx]}`;
}

function createFileTooLargeError() {
  const error = new Error(`File too large (max ${formatBytes(MAX_CLIP_BINARY_BYTES)})`);
  error.status = 413;
  return error;
}

function createTextTooLargeError() {
  const error = new Error(`Text too large (max ${formatBytes(MAX_TEXT_CLIP_BYTES)})`);
  error.status = 413;
  return error;
}

function assertWithinUploadLimit(buffer) {
  if (buffer.length > MAX_CLIP_BINARY_BYTES) throw createFileTooLargeError();
}

function assertWithinTextLimit(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_CLIP_BYTES) throw createTextTooLargeError();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return cookies;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

function basicCredentials(header) {
  const match = String(header || '').match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function authResult(req) {
  if (!AUTH_ENABLED) return { ok: true };

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (AUTH_TOKEN) {
    const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
    if (safeEqual(bearer, AUTH_TOKEN)) return { ok: true };

    const cookies = parseCookies(req.headers.cookie);
    if (safeEqual(cookies[AUTH_COOKIE], AUTH_TOKEN)) return { ok: true };

    const token = requestUrl.searchParams.get('token') || '';
    if (safeEqual(token, AUTH_TOKEN)) return { ok: true, setTokenCookie: true };
  }

  if (AUTH_USERNAME && AUTH_PASSWORD) {
    const credentials = basicCredentials(req.headers.authorization);
    if (
      credentials
      && safeEqual(credentials.username, AUTH_USERNAME)
      && safeEqual(credentials.password, AUTH_PASSWORD)
    ) {
      return { ok: true };
    }
  }

  return { ok: false };
}

function boolEnv(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'auto') return fallback;
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  return fallback;
}

function shouldUseSecureCookie(req) {
  return boolEnv(AUTH_COOKIE_SECURE, !!req.secure);
}

function authCookieHeader(req) {
  const attributes = [
    `${AUTH_COOKIE}=${encodeURIComponent(AUTH_TOKEN)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (shouldUseSecureCookie(req)) attributes.push('Secure');
  return attributes.join('; ');
}

function createFailureLimiter({ limit, windowMs, name }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  function check(keyPart) {
    const now = Date.now();
    const key = `${keyPart}:${name}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }

    entry.count += 1;
    if (entry.count <= limit) return { ok: true };

    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  function reset(keyPart) {
    hits.delete(`${keyPart}:${name}`);
  }

  return { check, reset };
}

const authFailureLimiter = createFailureLimiter({
  limit: AUTH_RATE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
  name: 'auth',
});

function authMiddleware(req, res, next) {
  const address = clientAddress(req, TRUST_PROXY_FN);
  const result = authResult(req);
  if (result.ok) {
    authFailureLimiter.reset(address);
    if (result.setTokenCookie) {
      res.setHeader('Set-Cookie', authCookieHeader(req));
    }
    return next();
  }

  const limitResult = authFailureLimiter.check(address);
  if (!limitResult.ok) {
    res.setHeader('Retry-After', String(limitResult.retryAfter));
    return res.status(429).send('Too many authentication attempts');
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Wklejka"');
  return res.status(401).send('Authentication required');
}

function createRateLimiter({ limit, windowMs, name }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const address = clientAddress(req, TRUST_PROXY_FN);
    const key = `${address}:${name}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count <= limit) return next();

    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  };
}

async function resolveSafePreviewTarget(url) {
  const hostname = url.hostname.toLowerCase();

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('URL points to a local address');
  }
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error('URL points to a private address');
  }
  if (net.isIP(hostname)) {
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('URL resolves to a private address');
  }

  return resolved;
}

async function fetchPreviewResponse(urlString, redirectsLeft = MAX_LINK_PREVIEW_REDIRECTS) {
  const url = new URL(urlString);
  const addresses = await resolveSafePreviewTarget(url);
  const selectedAddress = addresses[0];
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    let received = 0;

    const finish = (response) => {
      if (settled) return;
      settled = true;
      resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = client.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Wklejka/1.0 (link-preview)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address: selectedAddress.address, family: selectedAddress.family }]);
          return;
        }
        callback(null, selectedAddress.address, selectedAddress.family);
      },
    }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          fail(new Error('Too many redirects'));
          return;
        }
        fetchPreviewResponse(new URL(location, url).href, redirectsLeft - 1).then(resolve, reject);
        settled = true;
        return;
      }

      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('text/html')) {
        response.resume();
        finish(response);
        return;
      }

      response.on('data', (chunk) => {
        if (settled) return;
        const remaining = MAX_LINK_PREVIEW_BYTES - received;
        if (remaining > 0) {
          chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
          received += Math.min(chunk.length, remaining);
        }
        if (received >= MAX_LINK_PREVIEW_BYTES) {
          finish(response);
          response.destroy();
        }
      });
      response.on('end', () => finish(response));
      response.on('error', fail);
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error('Preview request timed out'));
    });
    req.on('error', fail);
    req.end();
  });
}

// --- Store ---

let store = { boards: [], clips: {} };
let saveTimeout = null;
let storeDirty = false;

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupCorruptStore() {
  if (!fs.existsSync(STORE_FILE)) return null;

  const backupFile = path.join(DATA_DIR, `store.json.corrupt-${timestampForFilename()}`);
  try {
    fs.renameSync(STORE_FILE, backupFile);
    return backupFile;
  } catch (error) {
    console.error('Failed to preserve corrupt store:', error.message);
    return null;
  }
}

function readStoreFile(file) {
  return normalizeStore(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function fsyncDirectory(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is best-effort and can fail on some filesystems.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function writeFileAtomic(file, data) {
  const tmpFile = path.join(DATA_DIR, `.store-${process.pid}-${Date.now()}.tmp`);
  let fd;

  try {
    fd = fs.openSync(tmpFile, 'w', 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (fs.existsSync(file)) {
      fs.copyFileSync(file, STORE_BACKUP_FILE);
    }
    fs.renameSync(tmpFile, file);
    fsyncDirectory(DATA_DIR);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tmpFile); } catch {}
    throw error;
  }
}

function loadStore() {
  if (fs.existsSync(STORE_FILE)) {
    try {
      store = readStoreFile(STORE_FILE);
    } catch (e) {
      console.error('Failed to load store:', e.message);
      const corruptBackup = backupCorruptStore();
      if (corruptBackup) {
        console.error(`Corrupt store preserved as ${corruptBackup}`);
      }

      if (fs.existsSync(STORE_BACKUP_FILE)) {
        try {
          store = readStoreFile(STORE_BACKUP_FILE);
          console.error(`Recovered store from ${STORE_BACKUP_FILE}`);
          storeDirty = true;
          saveStoreNow(true);
        } catch (backupError) {
          console.error('Failed to load store backup:', backupError.message);
        }
      }
    }
  }

  if (!store.boards || !store.boards.length) {
    store = createDefaultStore();
    storeDirty = true;
    saveStoreNow(true);
  }
}

function saveStoreNow(force = false) {
  clearTimeout(saveTimeout);
  saveTimeout = null;

  if (!force && !storeDirty) return;

  try {
    writeFileAtomic(STORE_FILE, JSON.stringify(store, null, 2));
    storeDirty = false;
  } catch (e) {
    storeDirty = true;
    throw e;
  }
}

function saveStore() {
  storeDirty = true;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      saveStoreNow();
    } catch (e) {
      console.error('Failed to save store:', e.message);
    }
  }, 200);
}

function flushStore() {
  if (!storeDirty) return;
  try {
    saveStoreNow();
  } catch (e) {
    console.error('Failed to flush store:', e.message);
  }
}

loadStore();

// --- Express ---

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use(authMiddleware);
app.use('/api/link-preview', createRateLimiter({
  limit: LINK_PREVIEW_RATE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
  name: 'link-preview',
}));
app.use('/api', createRateLimiter({
  limit: API_RATE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
  name: 'api',
}));
app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));
app.use(express.static(path.join(__dirname, 'public')));

// Boards
app.get('/api/boards', (_req, res) => {
  res.json(store.boards);
});

app.post('/api/boards', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const board = { id: generateId(), name, createdAt: Date.now(), expiresAt: null };
  if (req.body.expiresIn && Number(req.body.expiresIn) > 0) {
    board.expiresAt = Date.now() + Number(req.body.expiresIn);
  }
  store.boards.push(board);
  store.clips[board.id] = [];
  saveStore();
  broadcast({ type: 'board-added', board });
  res.json(board);
});

app.put('/api/boards/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const currentIds = store.boards.map(board => board.id);
  if (ids.length !== currentIds.length) {
    return res.status(400).json({ error: 'ids must include every board exactly once' });
  }
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    return res.status(400).json({ error: 'ids must be unique' });
  }
  const knownIds = new Set(currentIds);
  if (ids.some(id => !knownIds.has(id))) {
    return res.status(400).json({ error: 'ids contain an unknown board' });
  }
  const boardById = new Map(store.boards.map(board => [board.id, board]));
  store.boards = ids.map(id => boardById.get(id));
  saveStore();
  broadcast({ type: 'boards-reordered', ids: store.boards.map(b => b.id) });
  res.json({ ok: true });
});

app.put('/api/boards/:id', (req, res) => {
  const board = store.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  if (req.body.name !== undefined) {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    board.name = name;
  }
  if (req.body.locked !== undefined) {
    board.locked = !!req.body.locked;
  }
  saveStore();
  broadcast({ type: 'board-updated', board });
  res.json(board);
});

function removeBoardData(id) {
  store.boards = store.boards.filter(b => b.id !== id);
  (store.clips[id] || []).forEach(clip => {
    if (clip.type === 'image' && clip.filename) {
      try { fs.unlinkSync(path.join(IMAGES_DIR, clip.filename)); } catch {}
    }
    if (clip.type === 'file' && clip.filename) {
      try { fs.unlinkSync(path.join(FILES_DIR, clip.filename)); } catch {}
    }
  });
  delete store.clips[id];
}

app.delete('/api/boards/:id', (req, res) => {
  const { id } = req.params;
  if (id === 'default') return res.status(400).json({ error: 'Cannot delete default board' });
  const board = store.boards.find(b => b.id === id);
  if (board && board.locked) return res.status(403).json({ error: 'Board is locked' });
  if (!store.boards.find(b => b.id === id)) return res.status(404).json({ error: 'Board not found' });
  removeBoardData(id);
  saveStore();
  broadcast({ type: 'board-deleted', boardId: id });
  res.json({ ok: true });
});

// Clips
app.get('/api/boards/:id/clips', (req, res) => {
  res.json(store.clips[req.params.id] || []);
});

app.post('/api/boards/:id/clips', (req, res) => {
  const { id } = req.params;
  if (!store.clips[id]) return res.status(404).json({ error: 'Board not found' });

  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: 'type and content required' });
  if (!['text', 'image', 'file'].includes(type)) return res.status(400).json({ error: 'Unsupported clip type' });

  const clip = { id: generateId(), type, createdAt: Date.now() };

  if (type === 'image') {
    const match = content.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid image data' });
    const mimeType = match[1].toLowerCase();
    const ext = SAFE_IMAGE_MIME_TYPES.get(mimeType);
    if (!ext) return res.status(400).json({ error: 'Unsupported image type' });
    const buffer = Buffer.from(match[2], 'base64');
    assertWithinUploadLimit(buffer);
    const filename = `${clip.id}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
    clip.filename = filename;
    clip.mimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    clip.imageUrl = `/api/images/${filename}`;
  } else if (type === 'file') {
    const match = content.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid file data' });
    const buffer = Buffer.from(match[2], 'base64');
    assertWithinUploadLimit(buffer);
    const originalName = req.body.originalName || 'file';
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${clip.id}_${safeName}`;
    fs.writeFileSync(path.join(FILES_DIR, filename), buffer);
    clip.filename = filename;
    clip.originalName = originalName;
    clip.size = buffer.length;
    clip.mimeType = match[1].toLowerCase();
    clip.fileUrl = `/api/files/${filename}`;
    clip.previewUrl = `/api/files/${filename}/preview`;
  } else if (type === 'text') {
    const text = String(content);
    assertWithinTextLimit(text);
    clip.content = text;
  }

  store.clips[id].unshift(clip);
  saveStore();
  broadcast({ type: 'clip-added', boardId: id, clip });
  res.json(clip);
});

app.put('/api/boards/:boardId/clips/:clipId', (req, res) => {
  const { boardId, clipId } = req.params;
  const boardClips = store.clips[boardId];
  if (!boardClips) return res.status(404).json({ error: 'Board not found' });
  const lockedBoard = store.boards.find(b => b.id === boardId);
  if (lockedBoard && lockedBoard.locked) return res.status(403).json({ error: 'Board is locked' });

  const clip = boardClips.find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (clip.type !== 'text') return res.status(400).json({ error: 'Only text clips can be edited' });

  const content = String(req.body.content ?? '');
  if (!content.trim()) return res.status(400).json({ error: 'Content required' });
  assertWithinTextLimit(content);

  clip.content = content;
  clip.updatedAt = Date.now();
  saveStore();
  broadcast({ type: 'clip-updated', boardId, clip });
  res.json(clip);
});

app.delete('/api/boards/:boardId/clips/:clipId', (req, res) => {
  const { boardId, clipId } = req.params;
  if (!store.clips[boardId]) return res.status(404).json({ error: 'Board not found' });
  const lockedBoard = store.boards.find(b => b.id === boardId);
  if (lockedBoard && lockedBoard.locked) return res.status(403).json({ error: 'Board is locked' });
  const clip = store.clips[boardId].find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (clip.type === 'image' && clip.filename) {
    try { fs.unlinkSync(path.join(IMAGES_DIR, clip.filename)); } catch {}
  }
  if (clip.type === 'file' && clip.filename) {
    try { fs.unlinkSync(path.join(FILES_DIR, clip.filename)); } catch {}
  }
  store.clips[boardId] = store.clips[boardId].filter(c => c.id !== clipId);
  saveStore();
  broadcast({ type: 'clip-deleted', boardId, clipId });
  res.json({ ok: true });
});

// Serve images
app.get('/api/images/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  const clip = findClipByFilename(filename);
  const mimeType = clip?.mimeType || guessImageMimeType(filename);
  if (!mimeType) return res.status(404).end();
  setDownloadHeaders(res, { contentType: mimeType, disposition: 'inline', filename });
  res.sendFile(filepath);
});

// Serve files
app.get('/api/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(FILES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  const clip = findClipByFilename(filename);
  setDownloadHeaders(res, {
    contentType: clip?.mimeType || 'application/octet-stream',
    disposition: 'attachment',
    filename: clip?.originalName || filename,
  });
  res.sendFile(filepath);
});

app.get('/api/files/:filename/preview', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(FILES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  const clip = findClipByFilename(filename);
  const mimeType = clip?.mimeType || guessInlineFileMimeType(filename);
  if (!mimeType || !INLINE_FILE_MIME_TYPES.has(mimeType)) {
    return res.status(415).json({ error: 'Preview not available' });
  }
  setDownloadHeaders(res, {
    contentType: mimeType,
    disposition: 'inline',
    filename: clip?.originalName || filename,
  });
  res.sendFile(filepath);
});

// Link preview
app.get('/api/link-preview', async (req, res) => {
  const url = req.query.url;
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  try {
    const response = await fetchPreviewResponse(url);
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      return res.json({ title: '', description: '', image: '' });
    }
    const html = response.text.substring(0, 50000);

    const getMeta = (property) => {
      const r1 = new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i');
      const m1 = html.match(r1);
      if (m1) return m1[1];
      const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i');
      return html.match(r2)?.[1] || '';
    };
    const getMetaName = (name) => {
      const r1 = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
      const m1 = html.match(r1);
      if (m1) return m1[1];
      const r2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
      return html.match(r2)?.[1] || '';
    };
    const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const title = decode(getMeta('og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '');
    const description = decode(getMeta('og:description') || getMetaName('description'));
    let image = getMeta('og:image');
    if (image && !image.startsWith('http')) {
      try { image = new URL(image, url).href; } catch {}
    }

    res.json({
      title: title.substring(0, 200),
      description: description.substring(0, 500),
      image: image || '',
    });
  } catch (error) {
    if (/private address|local address|Too many redirects/i.test(error.message)) {
      return res.status(400).json({ error: 'URL not allowed' });
    }
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

// Error handler – silence expected client errors (aborted uploads, bad JSON, too large)
app.use((err, _req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: createFileTooLargeError().message });
  }
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  next(err);
});

// --- HTTP + WebSocket ---

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  const address = clientAddress(req, TRUST_PROXY_FN);
  if (!authResult(req).ok) {
    const limitResult = authFailureLimiter.check(address);
    if (!limitResult.ok) {
      socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${limitResult.retryAfter}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Wklejka"\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  authFailureLimiter.reset(address);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// --- Expiry cleanup (every 60s) ---

setInterval(() => {
  const now = Date.now();
  const expired = store.boards.filter(b => b.expiresAt && now > b.expiresAt);
  if (!expired.length) return;
  expired.forEach(b => {
    console.log(`Board expired: ${b.name} (${b.id})`);
    removeBoardData(b.id);
    broadcast({ type: 'board-deleted', boardId: b.id });
  });
  saveStore();
}, 60000);

// --- Orphan file cleanup on startup ---

function cleanOrphanFiles() {
  const referencedFiles = new Set();
  for (const clips of Object.values(store.clips)) {
    for (const clip of clips) {
      if (clip.filename) referencedFiles.add(clip.filename);
    }
  }

  let removed = 0;
  for (const [dir, label] of [[IMAGES_DIR, 'image'], [FILES_DIR, 'file']]) {
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!referencedFiles.has(f)) {
        try {
          fs.unlinkSync(path.join(dir, f));
          removed++;
          console.log(`Orphan ${label} removed: ${f}`);
        } catch {}
      }
    }
  }
  if (removed) console.log(`Orphan cleanup: removed ${removed} file(s)`);
}

cleanOrphanFiles();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wklejka running at http://0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, flushing store before shutdown`);
  flushStore();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('beforeExit', flushStore);

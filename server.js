const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
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
const MAX_BOARDS = readPositiveInt(process.env.MAX_BOARDS, 100);
const MAX_CLIPS_PER_BOARD = readPositiveInt(process.env.MAX_CLIPS_PER_BOARD, 10_000);
const MAX_TOTAL_CLIPS = readPositiveInt(process.env.MAX_TOTAL_CLIPS, 50_000);
const MAX_STORAGE_BYTES = readPositiveInt(process.env.MAX_STORAGE_BYTES, 5 * 1024 * 1024 * 1024);
const MAX_BOARD_NAME_LENGTH = readPositiveInt(process.env.MAX_BOARD_NAME_LENGTH, 120);
const MAX_ORIGINAL_NAME_LENGTH = readPositiveInt(process.env.MAX_ORIGINAL_NAME_LENGTH, 255);
const MAX_WS_CLIENTS = readPositiveInt(process.env.MAX_WS_CLIENTS, 100);
const MAX_WS_PAYLOAD_BYTES = readPositiveInt(process.env.MAX_WS_PAYLOAD_BYTES, 64 * 1024);
const MAX_WS_BACKPRESSURE_BYTES = readPositiveInt(process.env.MAX_WS_BACKPRESSURE_BYTES, 1024 * 1024);
const WS_HEARTBEAT_MS = readPositiveInt(process.env.WS_HEARTBEAT_MS, 30 * 1000);
const WS_ALLOW_NO_ORIGIN = boolEnv(process.env.WS_ALLOW_NO_ORIGIN, false);
const CONFIGURED_PUBLIC_ORIGINS = parsePublicOrigins(
  process.env.PUBLIC_ORIGIN || process.env.PUBLIC_ORIGINS || '',
);

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function httpError(status, message, code = 'BAD_REQUEST') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function assertBodyObject(body, allowedKeys) {
  if (!isPlainObject(body)) throw httpError(400, 'JSON object required');
  const unknown = Object.keys(body).find(key => !allowedKeys.includes(key));
  if (unknown) throw httpError(400, `Unknown field: ${unknown}`);
  return body;
}

function requiredString(value, name, maxLength, { trim = false } = {}) {
  if (typeof value !== 'string') throw httpError(400, `${name} must be a string`);
  const normalized = trim ? value.trim() : value;
  if (!normalized) throw httpError(400, `${name} required`);
  if (normalized.length > maxLength) throw httpError(400, `${name} is too long`);
  if (/[\0]/.test(normalized)) throw httpError(400, `${name} contains invalid characters`);
  return normalized;
}

function assertSafeId(value, name = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw httpError(400, `Invalid ${name}`);
  }
  return value;
}

function parsePublicOrigins(value) {
  const origins = new Set();
  for (const part of String(value || '').split(',')) {
    const candidate = part.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') continue;
      if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) continue;
      origins.add(parsed.origin);
    } catch {}
  }
  return origins;
}

function safeRequestUrl(req) {
  try {
    return new URL(String(req.url || '/'), 'http://localhost');
  } catch {
    return null;
  }
}

function safeHostHeader(value) {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\0-\x20\x7f]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.host;
  } catch {
    return null;
  }
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

function totalClipCount(candidateStore = store) {
  return Object.values(candidateStore.clips).reduce((total, clips) => total + clips.length, 0);
}

function assertCanAddBoard() {
  if (store.boards.length >= MAX_BOARDS) {
    throw httpError(409, `Board limit reached (max ${MAX_BOARDS})`, 'BOARD_LIMIT_REACHED');
  }
}

function assertCanAddClip(boardId, additionalBytes = 0) {
  const boardClips = store.clips[boardId];
  if (!boardClips) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
  const board = store.boards.find(candidate => candidate.id === boardId);
  if (board?.locked) throw httpError(403, 'Board is locked', 'BOARD_LOCKED');
  if (boardClips.length >= MAX_CLIPS_PER_BOARD) {
    throw httpError(409, `Clip limit reached for this board (max ${MAX_CLIPS_PER_BOARD})`, 'CLIP_LIMIT_REACHED');
  }
  if (totalClipCount() >= MAX_TOTAL_CLIPS) {
    throw httpError(409, `Total clip limit reached (max ${MAX_TOTAL_CLIPS})`, 'TOTAL_CLIP_LIMIT_REACHED');
  }
  if (storedBinaryBytes + activeUploadBytes + additionalBytes > MAX_STORAGE_BYTES) {
    throw httpError(507, `Storage quota exceeded (max ${formatBytes(MAX_STORAGE_BYTES)})`, 'STORAGE_QUOTA_EXCEEDED');
  }
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

  const requestUrl = safeRequestUrl(req);
  if (!requestUrl) return { ok: false };

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
let storedBinaryBytes = 0;
let activeUploadBytes = 0;

function clipStoragePath(clip) {
  if (!clip?.filename) return null;
  if (clip.type === 'image') return path.join(IMAGES_DIR, clip.filename);
  if (clip.type === 'file') return path.join(FILES_DIR, clip.filename);
  return null;
}

function clipDiskSize(clip) {
  const filepath = clipStoragePath(clip);
  if (!filepath) return 0;
  try {
    return fs.statSync(filepath).size;
  } catch {
    return Number.isSafeInteger(clip.size) && clip.size > 0 ? clip.size : 0;
  }
}

function calculateStoredBinaryBytes(candidateStore = store) {
  let total = 0;
  for (const clips of Object.values(candidateStore.clips)) {
    for (const clip of clips) total += clipDiskSize(clip);
  }
  return total;
}

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
storedBinaryBytes = calculateStoredBinaryBytes();

// --- Express ---

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (req.path === '/healthz' || req.path === '/livez' || req.path === '/readyz' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
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

function requestContentLength(req) {
  const value = req.headers['content-length'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw httpError(400, 'Invalid Content-Length', 'INVALID_CONTENT_LENGTH');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw httpError(400, 'Invalid Content-Length', 'INVALID_CONTENT_LENGTH');
  }
  return parsed;
}

function uploadMimeType(req) {
  const value = req.headers['content-type'];
  if (value !== undefined && typeof value !== 'string') {
    throw httpError(400, 'Invalid Content-Type', 'INVALID_CONTENT_TYPE');
  }
  const mimeType = String(value || 'application/octet-stream').split(';', 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+\-]{1,63}\/[a-z0-9!#$&^_.+\-]{1,63}$/.test(mimeType)) {
    throw httpError(400, 'Invalid Content-Type', 'INVALID_CONTENT_TYPE');
  }
  return mimeType;
}

function uploadOriginalName(req) {
  const value = req.headers['x-original-name'];
  if (value === undefined) return 'file';
  if (typeof value !== 'string' || value.length > MAX_ORIGINAL_NAME_LENGTH * 4) {
    throw httpError(400, 'Invalid X-Original-Name', 'INVALID_ORIGINAL_NAME');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw httpError(400, 'Invalid X-Original-Name encoding', 'INVALID_ORIGINAL_NAME');
  }
  return downloadBasename(requiredString(decoded, 'X-Original-Name', MAX_ORIGINAL_NAME_LENGTH));
}

function imageSignatureMatches(mimeType, prefix) {
  if (mimeType === 'image/png') {
    return prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    return prefix.length >= 6 && ['GIF87a', 'GIF89a'].includes(prefix.subarray(0, 6).toString('ascii'));
  }
  if (mimeType === 'image/webp') {
    return prefix.length >= 12
      && prefix.subarray(0, 4).toString('ascii') === 'RIFF'
      && prefix.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

async function receiveUpload(req, tempFile) {
  let received = 0;
  let prefix = Buffer.alloc(0);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploadBytes = Math.max(0, activeUploadBytes - received);
  };

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (received + chunk.length > MAX_CLIP_BINARY_BYTES) throw createFileTooLargeError();
        if (storedBinaryBytes + activeUploadBytes + chunk.length > MAX_STORAGE_BYTES) {
          throw httpError(
            507,
            `Storage quota exceeded (max ${formatBytes(MAX_STORAGE_BYTES)})`,
            'STORAGE_QUOTA_EXCEEDED',
          );
        }
        received += chunk.length;
        activeUploadBytes += chunk.length;
        if (prefix.length < 16) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
        }
        callback(null, chunk);
      } catch (error) {
        callback(error);
      }
    },
  });

  try {
    await pipeline(req, meter, fs.createWriteStream(tempFile, { flags: 'wx', mode: 0o600 }));
    return { size: received, prefix, release };
  } catch (error) {
    release();
    if (req.aborted) throw httpError(400, 'Upload aborted', 'UPLOAD_ABORTED');
    throw error;
  }
}

// Streaming binary upload. This route must remain before express.json so the
// request stream is never buffered or converted to base64 by middleware.
app.post('/api/boards/:id/uploads', async (req, res) => {
  const boardId = assertSafeId(req.params.id, 'board id');
  const clipType = req.headers['x-clip-type'];
  if (clipType !== 'image' && clipType !== 'file') {
    throw httpError(400, 'X-Clip-Type must be image or file', 'INVALID_CLIP_TYPE');
  }

  const mimeType = uploadMimeType(req);
  const ext = clipType === 'image' ? SAFE_IMAGE_MIME_TYPES.get(mimeType) : null;
  if (clipType === 'image' && !ext) {
    throw httpError(400, 'Unsupported image type', 'UNSUPPORTED_IMAGE_TYPE');
  }
  const originalName = clipType === 'file' ? uploadOriginalName(req) : null;
  const contentLength = requestContentLength(req);
  if (contentLength === 0) throw httpError(400, 'Upload body required', 'EMPTY_UPLOAD');
  if (contentLength !== null && contentLength > MAX_CLIP_BINARY_BYTES) throw createFileTooLargeError();
  assertCanAddClip(boardId, contentLength || 0);

  const clip = { id: generateId(), type: clipType, createdAt: Date.now() };
  const safeName = clipType === 'file'
    ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file'
    : null;
  const filename = clipType === 'image' ? `${clip.id}.${ext}` : `${clip.id}_${safeName}`;
  const targetDir = clipType === 'image' ? IMAGES_DIR : FILES_DIR;
  const finalFile = path.join(targetDir, filename);
  let tempFile = path.join(targetDir, `.upload-${process.pid}-${clip.id}.tmp`);
  let reservation;
  let committed = false;

  try {
    reservation = await receiveUpload(req, tempFile);
    if (reservation.size === 0) throw httpError(400, 'Upload body required', 'EMPTY_UPLOAD');
    if (clipType === 'image' && !imageSignatureMatches(mimeType, reservation.prefix)) {
      throw httpError(400, 'Image content does not match Content-Type', 'INVALID_IMAGE_DATA');
    }

    // Recheck mutable quotas and lock state after a potentially long upload.
    assertCanAddClip(boardId);
    await fs.promises.rename(tempFile, finalFile);
    tempFile = null;

    clip.filename = filename;
    clip.size = reservation.size;
    clip.mimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    if (clipType === 'image') {
      clip.imageUrl = `/api/images/${filename}`;
    } else {
      clip.originalName = originalName;
      clip.fileUrl = `/api/files/${filename}`;
      clip.previewUrl = `/api/files/${filename}/preview`;
    }

    store.clips[boardId].unshift(clip);
    storedBinaryBytes += reservation.size;
    saveStore();
    committed = true;
    broadcast({ type: 'clip-added', boardId, clip });
    res.json(clip);
  } catch (error) {
    if (tempFile) await fs.promises.unlink(tempFile).catch(() => {});
    if (!committed) await fs.promises.unlink(finalFile).catch(() => {});
    throw error;
  } finally {
    reservation?.release();
  }
});

app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));
app.use(express.static(path.join(__dirname, 'public')));

// Boards
app.get('/api/boards', (_req, res) => {
  res.json(store.boards);
});

app.post('/api/boards', (req, res) => {
  const body = assertBodyObject(req.body, ['name', 'expiresIn']);
  const name = requiredString(body.name, 'Name', MAX_BOARD_NAME_LENGTH, { trim: true });
  assertCanAddBoard();
  const board = { id: generateId(), name, createdAt: Date.now(), expiresAt: null };
  if (body.expiresIn !== undefined && body.expiresIn !== null && body.expiresIn !== '') {
    const expiresIn = Number(body.expiresIn);
    if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > 365 * 24 * 60 * 60 * 1000) {
      throw httpError(400, 'expiresIn must be a positive integer no greater than one year');
    }
    board.expiresAt = Date.now() + expiresIn;
  }
  store.boards.push(board);
  store.clips[board.id] = [];
  saveStore();
  broadcast({ type: 'board-added', board });
  res.json(board);
});

app.put('/api/boards/reorder', (req, res) => {
  const { ids } = assertBodyObject(req.body, ['ids']);
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  ids.forEach(id => assertSafeId(id, 'board id'));
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
  const id = assertSafeId(req.params.id, 'board id');
  const body = assertBodyObject(req.body, ['name', 'locked']);
  if (!Object.keys(body).length) throw httpError(400, 'At least one field is required');
  const board = store.boards.find(b => b.id === id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  if (body.name !== undefined) {
    board.name = requiredString(body.name, 'Name', MAX_BOARD_NAME_LENGTH, { trim: true });
  }
  if (body.locked !== undefined) {
    if (typeof body.locked !== 'boolean') throw httpError(400, 'locked must be a boolean');
    board.locked = body.locked;
  }
  saveStore();
  broadcast({ type: 'board-updated', board });
  res.json(board);
});

function removeBoardData(id) {
  store.boards = store.boards.filter(b => b.id !== id);
  (store.clips[id] || []).forEach(clip => {
    storedBinaryBytes = Math.max(0, storedBinaryBytes - clipDiskSize(clip));
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
  const id = assertSafeId(req.params.id, 'board id');
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
  const id = assertSafeId(req.params.id, 'board id');
  res.json(store.clips[id] || []);
});

app.post('/api/boards/:id/clips', (req, res) => {
  const id = assertSafeId(req.params.id, 'board id');
  assertCanAddClip(id);

  const body = assertBodyObject(req.body, ['type', 'content', 'originalName']);
  const { type, content } = body;
  if (typeof type !== 'string' || typeof content !== 'string' || !content) {
    return res.status(400).json({ error: 'type and content required' });
  }
  if (!['text', 'image', 'file'].includes(type)) return res.status(400).json({ error: 'Unsupported clip type' });

  const clip = { id: generateId(), type, createdAt: Date.now() };

  if (type === 'image') {
    const match = content.match(/^data:([a-zA-Z0-9!#$&^_.+\-]{1,127})(?:;[^,]*)?;base64,([a-zA-Z0-9+/]+={0,2})$/);
    if (!match) return res.status(400).json({ error: 'Invalid image data' });
    const mimeType = match[1].toLowerCase();
    const ext = SAFE_IMAGE_MIME_TYPES.get(mimeType);
    if (!ext) return res.status(400).json({ error: 'Unsupported image type' });
    const buffer = Buffer.from(match[2], 'base64');
    assertWithinUploadLimit(buffer);
    assertCanAddClip(id, buffer.length);
    const filename = `${clip.id}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
    clip.filename = filename;
    clip.size = buffer.length;
    clip.mimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    clip.imageUrl = `/api/images/${filename}`;
    storedBinaryBytes += buffer.length;
  } else if (type === 'file') {
    const match = content.match(/^data:([a-zA-Z0-9!#$&^_.+\-]{1,127})(?:;[^,]*)?;base64,([a-zA-Z0-9+/]+={0,2})$/);
    if (!match) return res.status(400).json({ error: 'Invalid file data' });
    const buffer = Buffer.from(match[2], 'base64');
    assertWithinUploadLimit(buffer);
    assertCanAddClip(id, buffer.length);
    const originalName = body.originalName === undefined
      ? 'file'
      : requiredString(body.originalName, 'originalName', MAX_ORIGINAL_NAME_LENGTH);
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${clip.id}_${safeName}`;
    fs.writeFileSync(path.join(FILES_DIR, filename), buffer);
    clip.filename = filename;
    clip.originalName = originalName;
    clip.size = buffer.length;
    clip.mimeType = match[1].toLowerCase();
    clip.fileUrl = `/api/files/${filename}`;
    clip.previewUrl = `/api/files/${filename}/preview`;
    storedBinaryBytes += buffer.length;
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
  const boardId = assertSafeId(req.params.boardId, 'board id');
  const clipId = assertSafeId(req.params.clipId, 'clip id');
  const body = assertBodyObject(req.body, ['content']);
  const boardClips = store.clips[boardId];
  if (!boardClips) return res.status(404).json({ error: 'Board not found' });
  const lockedBoard = store.boards.find(b => b.id === boardId);
  if (lockedBoard && lockedBoard.locked) return res.status(403).json({ error: 'Board is locked' });

  const clip = boardClips.find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (clip.type !== 'text') return res.status(400).json({ error: 'Only text clips can be edited' });

  if (typeof body.content !== 'string') throw httpError(400, 'content must be a string');
  const content = body.content;
  if (!content.trim()) return res.status(400).json({ error: 'Content required' });
  assertWithinTextLimit(content);

  clip.content = content;
  clip.updatedAt = Date.now();
  saveStore();
  broadcast({ type: 'clip-updated', boardId, clip });
  res.json(clip);
});

app.delete('/api/boards/:boardId/clips/:clipId', (req, res) => {
  const boardId = assertSafeId(req.params.boardId, 'board id');
  const clipId = assertSafeId(req.params.clipId, 'clip id');
  if (!store.clips[boardId]) return res.status(404).json({ error: 'Board not found' });
  const lockedBoard = store.boards.find(b => b.id === boardId);
  if (lockedBoard && lockedBoard.locked) return res.status(403).json({ error: 'Board is locked' });
  const clip = store.clips[boardId].find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  storedBinaryBytes = Math.max(0, storedBinaryBytes - clipDiskSize(clip));
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
  if (typeof url !== 'string' || url.length > 2048 || !(url.startsWith('http://') || url.startsWith('https://'))) {
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
app.use((err, req, res, _next) => {
  if (res.headersSent) {
    req.socket.destroy();
    return;
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: createFileTooLargeError().message });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON', code: 'INVALID_JSON' });
  }
  if (err.expose && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message, code: err.code || 'REQUEST_FAILED' });
  }
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message, code: err.code || 'BAD_REQUEST' });
  }
  const requestId = req.requestId || crypto.randomUUID();
  console.error(JSON.stringify({
    level: 'error',
    event: 'request_error',
    requestId,
    method: req.method,
    path: req.path,
    message: err?.message || 'Unknown error',
  }));
  return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', requestId });
});

// --- HTTP + WebSocket ---

const server = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
  perMessageDeflate: false,
});
const clients = new Set();

function rejectUpgrade(socket, status, reason, extraHeaders = '') {
  if (!socket.writable) return socket.destroy();
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n`
    + extraHeaders
    + 'Connection: close\r\n'
    + 'Content-Length: 0\r\n\r\n',
  );
}

function websocketOriginAllowed(req) {
  const originHeader = req.headers.origin;
  if (originHeader === undefined) return WS_ALLOW_NO_ORIGIN;
  if (typeof originHeader !== 'string' || originHeader.length > 512) return false;

  let origin;
  try {
    const parsed = new URL(originHeader);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') return false;
    origin = parsed.origin;
  } catch {
    return false;
  }

  if (CONFIGURED_PUBLIC_ORIGINS.size) return CONFIGURED_PUBLIC_ORIGINS.has(origin);

  const host = safeHostHeader(req.headers.host);
  if (!host) return false;
  const forwardedProto = TRUST_PROXY !== false && typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
    : '';
  const protocol = forwardedProto === 'https' || req.socket.encrypted ? 'https' : 'http';
  return origin === `${protocol}://${host}`;
}

server.on('upgrade', (req, socket, head) => {
  try {
    const requestUrl = safeRequestUrl(req);
    if (!requestUrl) return rejectUpgrade(socket, 400, 'Bad Request');
    if (requestUrl.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    if (!safeHostHeader(req.headers.host)) return rejectUpgrade(socket, 400, 'Bad Request');
    if (!websocketOriginAllowed(req)) return rejectUpgrade(socket, 403, 'Forbidden');
    if (clients.size >= MAX_WS_CLIENTS) {
      return rejectUpgrade(socket, 503, 'Service Unavailable', 'Retry-After: 5\r\n');
    }

    const address = clientAddress(req, TRUST_PROXY_FN);
    if (!authResult(req).ok) {
      const limitResult = authFailureLimiter.check(address);
      if (!limitResult.ok) {
        return rejectUpgrade(
          socket,
          429,
          'Too Many Requests',
          `Retry-After: ${limitResult.retryAfter}\r\n`,
        );
      }
      return rejectUpgrade(
        socket,
        401,
        'Unauthorized',
        'WWW-Authenticate: Basic realm="Wklejka"\r\n',
      );
    }

    authFailureLimiter.reset(address);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn',
      event: 'websocket_upgrade_rejected',
      message: error?.message || 'Unknown error',
    }));
    rejectUpgrade(socket, 400, 'Bad Request');
  }
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  clients.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', () => {
    // The channel is server-push only. Ignore client frames deliberately.
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => {
    clients.delete(ws);
    ws.terminate();
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > MAX_WS_BACKPRESSURE_BYTES) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    ws.send(msg, (error) => {
      if (!error) return;
      clients.delete(ws);
      ws.terminate();
    });
  }
}

const websocketHeartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) {
      clients.delete(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, WS_HEARTBEAT_MS);
websocketHeartbeat.unref();

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

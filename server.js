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
const qrcode = require('qrcode-generator');
const {
  clientAddress,
  compileTrustProxy,
  parseTrustProxy,
} = require('./lib/proxy');
const { isPrivateAddress } = require('./lib/security');
const { createDefaultStore, normalizeStore } = require('./lib/store');
const { DurableStoreWriter } = require('./lib/durable-store');

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
const BINARY_DATA_URL_PATTERN = /^data:([a-zA-Z0-9!#$&^_.+-]{1,63}\/[a-zA-Z0-9!#$&^_.+-]{1,63})(?:;[^,\r\n]*)?;base64,([a-zA-Z0-9+/]*={0,2})$/;
const MAX_LINK_PREVIEW_REDIRECTS = 5;
const MAX_LINK_PREVIEW_BYTES = 64 * 1024;
const LINK_PREVIEW_REQUEST_TIMEOUT_MS = 5_000;
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
const LINK_PREVIEW_CACHE_TTL_MS = readNonNegativeInt(process.env.LINK_PREVIEW_CACHE_TTL_MS, 60 * 60 * 1000);
const LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS = readNonNegativeInt(
  process.env.LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS,
  60 * 1000,
);
const LINK_PREVIEW_CACHE_MAX_ENTRIES = readPositiveInt(process.env.LINK_PREVIEW_CACHE_MAX_ENTRIES, 256);
const MAX_BOARDS = readPositiveInt(process.env.MAX_BOARDS, 100);
const MAX_CLIPS_PER_BOARD = readPositiveInt(process.env.MAX_CLIPS_PER_BOARD, 10_000);
const MAX_TOTAL_CLIPS = readPositiveInt(process.env.MAX_TOTAL_CLIPS, 50_000);
const MAX_CLIPS_PAGE_SIZE = readPositiveInt(process.env.MAX_CLIPS_PAGE_SIZE, 200);
const DEFAULT_CLIPS_PAGE_SIZE = Math.min(readPositiveInt(process.env.DEFAULT_CLIPS_PAGE_SIZE, 50), MAX_CLIPS_PAGE_SIZE);
const MAX_BULK_DELETE = readPositiveInt(process.env.MAX_BULK_DELETE, 100);
const MAX_STORAGE_BYTES = readPositiveInt(process.env.MAX_STORAGE_BYTES, 5 * 1024 * 1024 * 1024);
const CLIP_RETENTION_MS = readNonNegativeInt(process.env.CLIP_RETENTION_MS, 0);
const MAX_CLIP_EXPIRY_MS = readPositiveInt(process.env.MAX_CLIP_EXPIRY_MS, 365 * 24 * 60 * 60 * 1000);
const ORPHAN_GRACE_MS = readNonNegativeInt(process.env.ORPHAN_GRACE_MS, 5 * 60 * 1000);
const STORE_SAVE_DEBOUNCE_MS = readPositiveInt(process.env.STORE_SAVE_DEBOUNCE_MS, 20);
const STORE_SAVE_MAX_WAIT_MS = readPositiveInt(process.env.STORE_SAVE_MAX_WAIT_MS, 200);
const LOG_REQUESTS = boolEnv(process.env.LOG_REQUESTS, true);
const HSTS_MAX_AGE = readNonNegativeInt(process.env.HSTS_MAX_AGE, 365 * 24 * 60 * 60);
const HSTS_INCLUDE_SUBDOMAINS = boolEnv(process.env.HSTS_INCLUDE_SUBDOMAINS, false);
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
const runtimeMetrics = {
  httpRequests: new Map(),
  httpRequestDurationSeconds: 0,
  linkPreviewCacheHits: 0,
  linkPreviewCacheMisses: 0,
  linkPreviewInflightDeduplications: 0,
  storeWriteFailures: 0,
  maintenanceRuns: 0,
};

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
    } catch {
      // Ignore malformed allowlist entries and keep the valid origins.
    }
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

function publicRequestOrigin(req) {
  if (CONFIGURED_PUBLIC_ORIGINS.size === 1) {
    return CONFIGURED_PUBLIC_ORIGINS.values().next().value;
  }

  const host = safeHostHeader(req.headers.host);
  const protocol = String(req.protocol || '').toLowerCase();
  if (!host || !['http', 'https'].includes(protocol)) {
    throw httpError(400, 'Invalid request origin', 'INVALID_REQUEST_ORIGIN');
  }
  const origin = `${protocol}://${host}`;
  if (CONFIGURED_PUBLIC_ORIGINS.size && !CONFIGURED_PUBLIC_ORIGINS.has(origin)) {
    throw httpError(400, 'Request origin is not allowed', 'INVALID_REQUEST_ORIGIN');
  }
  return origin;
}

function clipShareUrl(req, boardId, clipId, lang) {
  const url = new URL('/', publicRequestOrigin(req));
  if (lang) url.searchParams.set('lang', lang);
  url.hash = `clip=${encodeURIComponent(boardId)}:${encodeURIComponent(clipId)}`;
  return url.href;
}

function createQrSvg(value) {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
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

function allowSameOriginFilePreview(res) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const policy = String(res.getHeader('Content-Security-Policy') || '');
  if (policy) {
    res.setHeader(
      'Content-Security-Policy',
      policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    );
  }
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

function decodeBinaryDataUrl(content, message, code) {
  const match = content.match(BINARY_DATA_URL_PATTERN);
  const payload = match?.[2] || '';
  if (!match || match[0] !== content || !payload || payload.length % 4 !== 0) {
    throw httpError(400, message, code);
  }
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length || buffer.toString('base64') !== payload) {
    throw httpError(400, message, code);
  }
  return { mimeType: match[1].toLowerCase(), buffer };
}

function totalClipCount(candidateStore = store) {
  return Object.values(candidateStore.clips).reduce((total, clips) => total + clips.length, 0);
}

function assertCanAddBoard(candidateStore = store) {
  if (candidateStore.boards.length >= MAX_BOARDS) {
    throw httpError(409, `Board limit reached (max ${MAX_BOARDS})`, 'BOARD_LIMIT_REACHED');
  }
}

function assertCanAddClip(candidateStore, boardId, additionalBytes = 0, storageBytes = storedBinaryBytes) {
  const boardClips = candidateStore.clips[boardId];
  if (!boardClips) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
  if (boardClips.length >= MAX_CLIPS_PER_BOARD) {
    throw httpError(409, `Clip limit reached for this board (max ${MAX_CLIPS_PER_BOARD})`, 'CLIP_LIMIT_REACHED');
  }
  if (totalClipCount(candidateStore) >= MAX_TOTAL_CLIPS) {
    throw httpError(409, `Total clip limit reached (max ${MAX_TOTAL_CLIPS})`, 'TOTAL_CLIP_LIMIT_REACHED');
  }
  if (storageBytes + activeUploadBytes + additionalBytes > MAX_STORAGE_BYTES) {
    throw httpError(507, `Storage quota exceeded (max ${formatBytes(MAX_STORAGE_BYTES)})`, 'STORAGE_QUOTA_EXCEEDED');
  }
}

function compareClips(left, right) {
  const pinnedDifference = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
  if (pinnedDifference) return pinnedDifference;
  const timeDifference = Number(right.createdAt || 0) - Number(left.createdAt || 0);
  if (timeDifference) return timeDifference;
  return String(right.id).localeCompare(String(left.id));
}

function encodeClipCursor(clip) {
  return Buffer.from(JSON.stringify({
    v: 1,
    p: Boolean(clip.pinned),
    t: Number(clip.createdAt || 0),
    i: clip.id,
  })).toString('base64url');
}

function decodeClipCursor(value) {
  if (typeof value !== 'string' || !value || value.length > 512) {
    throw httpError(400, 'Invalid cursor', 'INVALID_CURSOR');
  }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !isPlainObject(cursor)
      || cursor.v !== 1
      || typeof cursor.p !== 'boolean'
      || !Number.isSafeInteger(cursor.t)
      || cursor.t < 0
    ) {
      throw new Error('Invalid cursor payload');
    }
    assertSafeId(cursor.i, 'cursor clip id');
    return { id: cursor.i, pinned: cursor.p, createdAt: cursor.t };
  } catch (error) {
    if (error.status === 400) throw error;
    throw httpError(400, 'Invalid cursor', 'INVALID_CURSOR');
  }
}

function clipsQuery(query) {
  const allowed = new Set(['limit', 'cursor', 'q', 'type']);
  const keys = Object.keys(query);
  const unknown = keys.find(key => !allowed.has(key));
  if (unknown) throw httpError(400, `Unknown query parameter: ${unknown}`);
  if (!keys.length) return null;

  let limit = DEFAULT_CLIPS_PAGE_SIZE;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d*$/.test(query.limit)) {
      throw httpError(400, 'limit must be a positive integer', 'INVALID_LIMIT');
    }
    limit = Number(query.limit);
    if (limit > MAX_CLIPS_PAGE_SIZE) {
      throw httpError(400, `limit cannot exceed ${MAX_CLIPS_PAGE_SIZE}`, 'INVALID_LIMIT');
    }
  }

  let search = '';
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 200) {
      throw httpError(400, 'q must be a string no longer than 200 characters', 'INVALID_SEARCH');
    }
    search = query.q.trim().toLowerCase();
  }

  let type = null;
  if (query.type !== undefined) {
    if (typeof query.type !== 'string' || !['text', 'image', 'file'].includes(query.type)) {
      throw httpError(400, 'type must be text, image or file', 'INVALID_CLIP_TYPE');
    }
    type = query.type;
  }

  return {
    limit,
    search,
    type,
    cursor: query.cursor === undefined ? null : decodeClipCursor(query.cursor),
  };
}

function clipMatchesSearch(clip, search) {
  if (!search) return true;
  return [clip.content, clip.originalName, clip.mimeType, clip.filename]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(search));
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
        url: url.href,
      });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = client.request(url, {
      method: 'GET',
      signal: AbortSignal.timeout(LINK_PREVIEW_REQUEST_TIMEOUT_MS),
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

    req.setTimeout(LINK_PREVIEW_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Preview request timed out'));
    });
    req.on('error', fail);
    req.end();
  });
}

// --- Store ---

let store = { boards: [], clips: {} };
let storeDirty = false;
let storedBinaryBytes = 0;
let activeUploadBytes = 0;
let shuttingDown = false;
let mutationQueue = Promise.resolve();
let lastWriterReady = true;
const pendingBinaryPaths = new Set();

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
      try { fs.closeSync(fd); } catch {
        // Preserve the original fsync/write failure.
      }
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
      try { fs.closeSync(fd); } catch {
        // Preserve the original atomic-write failure.
      }
    }
    try { fs.unlinkSync(tmpFile); } catch {
      // Best-effort cleanup after the original failure.
    }
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
  if (!force && !storeDirty) return;

  try {
    writeFileAtomic(STORE_FILE, JSON.stringify(store, null, 2));
    storeDirty = false;
  } catch (e) {
    storeDirty = true;
    throw e;
  }
}

loadStore();
storedBinaryBytes = calculateStoredBinaryBytes();

const storeWriter = new DurableStoreWriter({
  file: STORE_FILE,
  backupFile: STORE_BACKUP_FILE,
  debounceMs: STORE_SAVE_DEBOUNCE_MS,
  maxWaitMs: STORE_SAVE_MAX_WAIT_MS,
  onStateChange(status) {
    if (status.ready === lastWriterReady) return;
    lastWriterReady = status.ready;
    console.log(JSON.stringify({
      level: status.ready ? 'info' : 'error',
      event: 'store_readiness_changed',
      ready: status.ready,
      error: status.lastError?.code || null,
    }));
  },
});

function commitStoreMutation(mutator) {
  const operation = mutationQueue.then(async () => {
    if (shuttingDown) {
      throw httpError(503, 'Server is shutting down', 'SHUTTING_DOWN');
    }
    const draft = structuredClone(store);
    const context = { storedBinaryBytes };
    const result = await mutator(draft, context);
    try {
      await storeWriter.enqueue(draft);
    } catch (error) {
      runtimeMetrics.storeWriteFailures += 1;
      console.error(JSON.stringify({
        level: 'error',
        event: 'store_write_failed',
        code: error.code || 'STORE_WRITE_FAILED',
        message: error.message,
      }));
      const unavailable = httpError(503, 'Storage temporarily unavailable', 'STORAGE_UNAVAILABLE');
      unavailable.cause = error;
      throw unavailable;
    }
    store = draft;
    storedBinaryBytes = Math.max(0, context.storedBinaryBytes);
    return result;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

async function flushStore() {
  await mutationQueue;
  await storeWriter.flush();
}

// --- Express ---

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const incomingRequestId = req.headers['x-request-id'];
  req.requestId = typeof incomingRequestId === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(incomingRequestId)
    ? incomingRequestId
    : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; '));
  if (req.secure && HSTS_MAX_AGE > 0) {
    res.setHeader(
      'Strict-Transport-Security',
      `max-age=${HSTS_MAX_AGE}${HSTS_INCLUDE_SUBDOMAINS ? '; includeSubDomains' : ''}`,
    );
  }
  if (req.path === '/healthz' || req.path === '/livez' || req.path === '/readyz' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const metricMethod = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(req.method)
      ? req.method
      : 'OTHER';
    const metricStatus = res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : 0;
    const metricKey = `${metricMethod}:${metricStatus}`;
    runtimeMetrics.httpRequests.set(metricKey, (runtimeMetrics.httpRequests.get(metricKey) || 0) + 1);
    runtimeMetrics.httpRequestDurationSeconds += durationSeconds;
    if (LOG_REQUESTS && (req.path.startsWith('/api/') || res.statusCode >= 400)) {
      console.log(JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        event: 'http_request',
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: durationSeconds * 1000,
        client: clientAddress(req, TRUST_PROXY_FN),
      }));
    }
  });
  next();
});
app.get(['/healthz', '/livez'], (_req, res) => res.json({ ok: true }));
app.get('/readyz', (_req, res) => {
  const writerStatus = storeWriter.status();
  const ready = writerStatus.ready && !shuttingDown;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    storage: writerStatus.ready ? 'ready' : 'unavailable',
    code: shuttingDown ? 'SHUTTING_DOWN' : writerStatus.lastError?.code || null,
  });
});
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
  if (!/^[a-z0-9!#$&^_.+-]{1,63}\/[a-z0-9!#$&^_.+-]{1,63}$/.test(mimeType)) {
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
    if (error.status === 413 || error.code === 'STORAGE_QUOTA_EXCEEDED') throw error;
    if (
      req.aborted
      && ['ABORT_ERR', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)
    ) {
      throw httpError(400, 'Upload aborted', 'UPLOAD_ABORTED');
    }
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
  assertCanAddClip(store, boardId, contentLength || 0);

  const clip = { id: generateId(), type: clipType, createdAt: Date.now() };
  const safeName = clipType === 'file'
    ? originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file'
    : null;
  const filename = clipType === 'image' ? `${clip.id}.${ext}` : `${clip.id}_${safeName}`;
  const targetDir = clipType === 'image' ? IMAGES_DIR : FILES_DIR;
  const finalFile = path.join(targetDir, filename);
  const tempFilePath = path.join(targetDir, `.upload-${process.pid}-${clip.id}.tmp`);
  let tempFile = tempFilePath;
  let reservation;
  let committed = false;
  pendingBinaryPaths.add(tempFilePath);
  pendingBinaryPaths.add(finalFile);

  try {
    reservation = await receiveUpload(req, tempFile);
    if (reservation.size === 0) throw httpError(400, 'Upload body required', 'EMPTY_UPLOAD');
    if (clipType === 'image' && !imageSignatureMatches(mimeType, reservation.prefix)) {
      throw httpError(400, 'Image content does not match Content-Type', 'INVALID_IMAGE_DATA');
    }

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

    await commitStoreMutation((draft, context) => {
      // Recheck mutable quotas after a potentially long upload.
      // The current stream is already included in activeUploadBytes.
      assertCanAddClip(draft, boardId, 0, context.storedBinaryBytes);
      draft.clips[boardId].unshift(clip);
      context.storedBinaryBytes += reservation.size;
    });
    committed = true;
    broadcast({ type: 'clip-added', boardId, clip });
    res.json(clip);
  } catch (error) {
    if (tempFile) await fs.promises.unlink(tempFile).catch(() => {});
    if (!committed) await fs.promises.unlink(finalFile).catch(() => {});
    throw error;
  } finally {
    reservation?.release();
    pendingBinaryPaths.delete(tempFilePath);
    pendingBinaryPaths.delete(finalFile);
  }
});

app.use(express.json({ limit: JSON_BODY_LIMIT_BYTES }));
app.use(express.static(path.join(__dirname, 'public')));

// Boards
app.get('/api/boards', (_req, res) => {
  res.json(store.boards);
});

app.get('/api/status', (_req, res) => {
  const writerStatus = storeWriter.status();
  res.json({
    ok: writerStatus.ready && !shuttingDown,
    uptimeSeconds: Math.floor(process.uptime()),
    boards: store.boards.length,
    clips: totalClipCount(),
    websocketClients: clients?.size || 0,
    storage: {
      usedBytes: storedBinaryBytes,
      activeUploadBytes,
      maxBytes: MAX_STORAGE_BYTES,
      persistence: writerStatus,
    },
    linkPreviewCache: {
      entries: linkPreviewCache?.size || 0,
      inFlight: linkPreviewInflight?.size || 0,
      maxEntries: LINK_PREVIEW_CACHE_MAX_ENTRIES,
      ttlMs: LINK_PREVIEW_CACHE_TTL_MS,
      negativeTtlMs: LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS,
    },
    limits: {
      maxBoards: MAX_BOARDS,
      maxClipsPerBoard: MAX_CLIPS_PER_BOARD,
      maxTotalClips: MAX_TOTAL_CLIPS,
      maxBinaryBytes: MAX_CLIP_BINARY_BYTES,
      maxTextBytes: MAX_TEXT_CLIP_BYTES,
      maxPageSize: MAX_CLIPS_PAGE_SIZE,
      maxBulkDelete: MAX_BULK_DELETE,
      clipRetentionMs: CLIP_RETENTION_MS,
      maxClipExpiryMs: MAX_CLIP_EXPIRY_MS,
    },
  });
});

function prometheusLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

app.get('/api/metrics', (_req, res) => {
  const writerStatus = storeWriter.status();
  const requestCount = [...runtimeMetrics.httpRequests.values()].reduce((total, count) => total + count, 0);
  const lines = [
    '# HELP wklejka_up Whether the process is running.',
    '# TYPE wklejka_up gauge',
    'wklejka_up 1',
    '# HELP wklejka_store_ready Whether metadata persistence is ready.',
    '# TYPE wklejka_store_ready gauge',
    `wklejka_store_ready ${writerStatus.ready && !shuttingDown ? 1 : 0}`,
    '# TYPE wklejka_boards gauge',
    `wklejka_boards ${store.boards.length}`,
    '# TYPE wklejka_clips gauge',
    `wklejka_clips ${totalClipCount()}`,
    '# TYPE wklejka_websocket_clients gauge',
    `wklejka_websocket_clients ${clients?.size || 0}`,
    '# TYPE wklejka_storage_bytes gauge',
    `wklejka_storage_bytes ${storedBinaryBytes}`,
    '# TYPE wklejka_storage_limit_bytes gauge',
    `wklejka_storage_limit_bytes ${MAX_STORAGE_BYTES}`,
    '# TYPE wklejka_active_upload_bytes gauge',
    `wklejka_active_upload_bytes ${activeUploadBytes}`,
    '# TYPE wklejka_process_resident_memory_bytes gauge',
    `wklejka_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    '# TYPE wklejka_http_request_duration_seconds summary',
    `wklejka_http_request_duration_seconds_sum ${runtimeMetrics.httpRequestDurationSeconds}`,
    `wklejka_http_request_duration_seconds_count ${requestCount}`,
    '# TYPE wklejka_store_write_failures_total counter',
    `wklejka_store_write_failures_total ${runtimeMetrics.storeWriteFailures}`,
    '# TYPE wklejka_maintenance_runs_total counter',
    `wklejka_maintenance_runs_total ${runtimeMetrics.maintenanceRuns}`,
    '# TYPE wklejka_link_preview_cache_hits_total counter',
    `wklejka_link_preview_cache_hits_total ${runtimeMetrics.linkPreviewCacheHits}`,
    '# TYPE wklejka_link_preview_cache_misses_total counter',
    `wklejka_link_preview_cache_misses_total ${runtimeMetrics.linkPreviewCacheMisses}`,
    '# TYPE wklejka_link_preview_inflight_deduplications_total counter',
    `wklejka_link_preview_inflight_deduplications_total ${runtimeMetrics.linkPreviewInflightDeduplications}`,
    '# TYPE wklejka_link_preview_cache_entries gauge',
    `wklejka_link_preview_cache_entries ${linkPreviewCache?.size || 0}`,
  ];
  for (const [key, count] of [...runtimeMetrics.httpRequests.entries()].sort()) {
    const [method, status] = key.split(':');
    lines.push(`wklejka_http_requests_total{method="${prometheusLabel(method)}",status="${prometheusLabel(status)}"} ${count}`);
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(`${lines.join('\n')}\n`);
});

app.get('/api/export', (_req, res) => {
  const filename = `wklejka-metadata-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
  res.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    boards: store.boards,
    clips: store.clips,
  });
});

app.get('/api/share/qr', (req, res) => {
  const allowedQuery = new Set(['boardId', 'clipId', 'lang']);
  const unknown = Object.keys(req.query).find(key => !allowedQuery.has(key));
  if (unknown) throw httpError(400, `Unknown query parameter: ${unknown}`);

  const boardId = assertSafeId(req.query.boardId, 'board id');
  const clipId = assertSafeId(req.query.clipId, 'clip id');
  const lang = req.query.lang;
  if (lang !== undefined && (typeof lang !== 'string' || !['pl', 'en'].includes(lang))) {
    throw httpError(400, 'lang must be pl or en', 'INVALID_LANGUAGE');
  }

  const boardClips = store.clips[boardId];
  if (!boardClips) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
  if (!boardClips.some(clip => clip.id === clipId)) {
    throw httpError(404, 'Clip not found', 'CLIP_NOT_FOUND');
  }

  const svg = createQrSvg(clipShareUrl(req, boardId, clipId, lang));
  res.setHeader('Cache-Control', 'no-store');
  res.type('image/svg+xml').send(svg);
});

app.post('/api/maintenance/cleanup', async (req, res) => {
  runtimeMetrics.maintenanceRuns += 1;
  const body = req.body === undefined
    ? {}
    : assertBodyObject(req.body, ['dryRun', 'boardId', 'olderThan']);
  const dryRun = body.dryRun === undefined ? true : body.dryRun;
  if (typeof dryRun !== 'boolean') throw httpError(400, 'dryRun must be a boolean');
  const boardId = body.boardId === undefined ? null : assertSafeId(body.boardId, 'board id');
  if (boardId && !store.clips[boardId]) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
  const olderThan = body.olderThan === undefined ? null : body.olderThan;
  if (
    olderThan !== null
    && (!Number.isSafeInteger(olderThan) || olderThan <= 0 || olderThan > Date.now())
  ) {
    throw httpError(400, 'olderThan must be a past Unix timestamp in milliseconds');
  }

  const cleanup = await cleanupExpiredContent({ dryRun, boardId, olderThan });
  const orphans = cleanOrphanFiles({ includeRecent: false, dryRun });
  const matched = {
    boards: cleanup.expiredBoards.length,
    clips: cleanup.clipEvents.length,
    orphans: orphans.candidates,
  };
  res.json({
    ok: true,
    dryRun,
    matched,
    deleted: dryRun ? { boards: 0, clips: 0, orphans: 0 } : {
      boards: matched.boards,
      clips: matched.clips,
      orphans: orphans.removed,
    },
    reclaimedBytes: dryRun
      ? cleanup.reclaimedBytes + orphans.candidateBytes
      : cleanup.reclaimedBytes + orphans.reclaimedBytes,
  });
});

app.post('/api/boards', async (req, res) => {
  const body = assertBodyObject(req.body, ['name', 'expiresIn']);
  const name = requiredString(body.name, 'Name', MAX_BOARD_NAME_LENGTH, { trim: true });
  const board = { id: generateId(), name, createdAt: Date.now(), expiresAt: null };
  if (body.expiresIn !== undefined && body.expiresIn !== null && body.expiresIn !== '') {
    const expiresIn = Number(body.expiresIn);
    if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > 365 * 24 * 60 * 60 * 1000) {
      throw httpError(400, 'expiresIn must be a positive integer no greater than one year');
    }
    board.expiresAt = Date.now() + expiresIn;
  }
  await commitStoreMutation((draft) => {
    assertCanAddBoard(draft);
    draft.boards.push(board);
    draft.clips[board.id] = [];
  });
  broadcast({ type: 'board-added', board });
  res.json(board);
});

app.put('/api/boards/reorder', async (req, res) => {
  const { ids } = assertBodyObject(req.body, ['ids']);
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  ids.forEach(id => assertSafeId(id, 'board id'));
  await commitStoreMutation((draft) => {
    const currentIds = draft.boards.map(board => board.id);
    if (ids.length !== currentIds.length) {
      throw httpError(400, 'ids must include every board exactly once');
    }
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) throw httpError(400, 'ids must be unique');
    const knownIds = new Set(currentIds);
    if (ids.some(id => !knownIds.has(id))) throw httpError(400, 'ids contain an unknown board');
    const boardById = new Map(draft.boards.map(board => [board.id, board]));
    draft.boards = ids.map(id => boardById.get(id));
  });
  broadcast({ type: 'boards-reordered', ids });
  res.json({ ok: true });
});

app.put('/api/boards/:id', async (req, res) => {
  const id = assertSafeId(req.params.id, 'board id');
  const body = assertBodyObject(req.body, ['name', 'locked']);
  if (!Object.keys(body).length) throw httpError(400, 'At least one field is required');
  const board = await commitStoreMutation((draft) => {
    const candidate = draft.boards.find(item => item.id === id);
    if (!candidate) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    if (body.name !== undefined) {
      candidate.name = requiredString(body.name, 'Name', MAX_BOARD_NAME_LENGTH, { trim: true });
    }
    if (body.locked !== undefined) {
      if (typeof body.locked !== 'boolean') throw httpError(400, 'locked must be a boolean');
      if (id === 'default' && body.locked) {
        throw httpError(400, 'Default board cannot be locked', 'DEFAULT_BOARD_CANNOT_BE_LOCKED');
      }
      if (body.locked) candidate.locked = true;
      else delete candidate.locked;
    }
    return candidate;
  });
  broadcast({ type: 'board-updated', board });
  res.json(board);
});

function boardFileData(candidateStore, id) {
  return (candidateStore.clips[id] || [])
    .map(clip => ({ filepath: clipStoragePath(clip), size: clipDiskSize(clip) }))
    .filter(item => item.filepath);
}

async function unlinkCommittedFiles(files) {
  await Promise.all(files.map(async ({ filepath }) => {
    try {
      await fs.promises.unlink(filepath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(JSON.stringify({
          level: 'warn',
          event: 'orphan_cleanup_deferred',
          file: path.basename(filepath),
          message: error.message,
        }));
      }
    }
  }));
}

app.delete('/api/boards/:id', async (req, res) => {
  const id = assertSafeId(req.params.id, 'board id');
  if (id === 'default') return res.status(400).json({ error: 'Cannot delete default board' });
  const files = await commitStoreMutation((draft, context) => {
    const board = draft.boards.find(candidate => candidate.id === id);
    if (!board) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    if (board.locked) throw httpError(403, 'Board is locked', 'BOARD_LOCKED');
    const removedFiles = boardFileData(draft, id);
    draft.boards = draft.boards.filter(candidate => candidate.id !== id);
    delete draft.clips[id];
    context.storedBinaryBytes -= removedFiles.reduce((total, item) => total + item.size, 0);
    return removedFiles;
  });
  broadcast({ type: 'board-deleted', boardId: id });
  await unlinkCommittedFiles(files);
  res.json({ ok: true });
});

// Clips
app.get('/api/boards/:id/clips', (req, res) => {
  const id = assertSafeId(req.params.id, 'board id');
  const query = clipsQuery(req.query);
  let clips = [...(store.clips[id] || [])].sort(compareClips);
  if (!query) return res.json(clips);

  if (query.type) clips = clips.filter(clip => clip.type === query.type);
  if (query.search) clips = clips.filter(clip => clipMatchesSearch(clip, query.search));
  const total = clips.length;
  if (query.cursor) clips = clips.filter(clip => compareClips(clip, query.cursor) > 0);
  const items = clips.slice(0, query.limit);
  const nextCursor = clips.length > items.length && items.length
    ? encodeClipCursor(items[items.length - 1])
    : null;
  return res.json({ items, nextCursor, total });
});

app.post('/api/boards/:id/clips', async (req, res) => {
  const id = assertSafeId(req.params.id, 'board id');
  assertCanAddClip(store, id);

  const body = assertBodyObject(req.body, ['type', 'content', 'originalName']);
  const { type, content } = body;
  if (typeof type !== 'string' || typeof content !== 'string' || !content) {
    return res.status(400).json({ error: 'type and content required' });
  }
  if (!['text', 'image', 'file'].includes(type)) return res.status(400).json({ error: 'Unsupported clip type' });

  const clip = { id: generateId(), type, createdAt: Date.now() };
  let binaryFile = null;
  let binarySize = 0;

  try {
    if (type === 'image') {
      const { mimeType, buffer } = decodeBinaryDataUrl(
        content,
        'Invalid image data',
        'INVALID_IMAGE_DATA',
      );
      const ext = SAFE_IMAGE_MIME_TYPES.get(mimeType);
      if (!ext) throw httpError(400, 'Unsupported image type', 'UNSUPPORTED_IMAGE_TYPE');
      assertWithinUploadLimit(buffer);
      if (!imageSignatureMatches(mimeType, buffer.subarray(0, 16))) {
        throw httpError(400, 'Image content does not match MIME type', 'INVALID_IMAGE_DATA');
      }
      assertCanAddClip(store, id, buffer.length);
      const filename = `${clip.id}.${ext}`;
      binaryFile = path.join(IMAGES_DIR, filename);
      pendingBinaryPaths.add(binaryFile);
      await fs.promises.writeFile(binaryFile, buffer, { flag: 'wx', mode: 0o600 });
      binarySize = buffer.length;
      clip.filename = filename;
      clip.size = buffer.length;
      clip.mimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
      clip.imageUrl = `/api/images/${filename}`;
    } else if (type === 'file') {
      const { mimeType, buffer } = decodeBinaryDataUrl(
        content,
        'Invalid file data',
        'INVALID_FILE_DATA',
      );
      assertWithinUploadLimit(buffer);
      assertCanAddClip(store, id, buffer.length);
      const originalName = body.originalName === undefined
        ? 'file'
        : downloadBasename(requiredString(body.originalName, 'originalName', MAX_ORIGINAL_NAME_LENGTH));
      const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
      const filename = `${clip.id}_${safeName}`;
      binaryFile = path.join(FILES_DIR, filename);
      pendingBinaryPaths.add(binaryFile);
      await fs.promises.writeFile(binaryFile, buffer, { flag: 'wx', mode: 0o600 });
      binarySize = buffer.length;
      clip.filename = filename;
      clip.originalName = originalName;
      clip.size = buffer.length;
      clip.mimeType = mimeType;
      clip.fileUrl = `/api/files/${filename}`;
      clip.previewUrl = `/api/files/${filename}/preview`;
    } else {
      assertWithinTextLimit(content);
      clip.content = content;
    }

    await commitStoreMutation((draft, context) => {
      assertCanAddClip(draft, id, binarySize, context.storedBinaryBytes);
      draft.clips[id].unshift(clip);
      context.storedBinaryBytes += binarySize;
    });
  } catch (error) {
    if (binaryFile) await fs.promises.unlink(binaryFile).catch(() => {});
    throw error;
  } finally {
    if (binaryFile) pendingBinaryPaths.delete(binaryFile);
  }

  broadcast({ type: 'clip-added', boardId: id, clip });
  res.json(clip);
});

function removeClipsFromDraft(draft, context, boardId, ids) {
  const idSet = new Set(ids);
  const boardClips = draft.clips[boardId] || [];
  const removed = boardClips.filter(clip => idSet.has(clip.id));
  const removedIds = new Set(removed.map(clip => clip.id));
  const files = removed
    .map(clip => ({ filepath: clipStoragePath(clip), size: clipDiskSize(clip) }))
    .filter(item => item.filepath);
  const reclaimedBytes = files.reduce((total, item) => total + item.size, 0);
  draft.clips[boardId] = boardClips.filter(clip => !removedIds.has(clip.id));
  context.storedBinaryBytes -= reclaimedBytes;
  return {
    deletedIds: removed.map(clip => clip.id),
    notFoundIds: ids.filter(id => !removedIds.has(id)),
    reclaimedBytes,
    files,
  };
}

app.post('/api/boards/:id/clips/bulk-delete', async (req, res) => {
  const boardId = assertSafeId(req.params.id, 'board id');
  const { ids } = assertBodyObject(req.body, ['ids']);
  if (!Array.isArray(ids) || !ids.length) throw httpError(400, 'ids must be a non-empty array');
  if (ids.length > MAX_BULK_DELETE) {
    throw httpError(400, `ids cannot contain more than ${MAX_BULK_DELETE} entries`);
  }
  ids.forEach(id => assertSafeId(id, 'clip id'));
  if (new Set(ids).size !== ids.length) throw httpError(400, 'ids must be unique');

  const result = await commitStoreMutation((draft, context) => {
    if (!draft.clips[boardId]) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    const board = draft.boards.find(candidate => candidate.id === boardId);
    if (board?.locked) throw httpError(403, 'Board is locked', 'BOARD_LOCKED');
    return removeClipsFromDraft(draft, context, boardId, ids);
  });
  for (const clipId of result.deletedIds) {
    broadcast({ type: 'clip-deleted', boardId, clipId });
  }
  await unlinkCommittedFiles(result.files);
  res.json({
    ok: true,
    deleted: result.deletedIds.length,
    deletedIds: result.deletedIds,
    notFoundIds: result.notFoundIds,
    reclaimedBytes: result.reclaimedBytes,
  });
});

app.put('/api/boards/:boardId/clips/:clipId', async (req, res) => {
  const boardId = assertSafeId(req.params.boardId, 'board id');
  const clipId = assertSafeId(req.params.clipId, 'clip id');
  const body = assertBodyObject(req.body, ['content', 'pinned', 'expiresAt', 'expiresIn']);
  if (!Object.keys(body).length) throw httpError(400, 'At least one field is required');
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') throw httpError(400, 'content must be a string');
    if (!body.content.trim()) throw httpError(400, 'Content required');
    assertWithinTextLimit(body.content);
  }
  if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
    throw httpError(400, 'pinned must be a boolean');
  }
  if (body.expiresAt !== undefined && body.expiresIn !== undefined) {
    throw httpError(400, 'expiresAt and expiresIn are mutually exclusive');
  }

  const now = Date.now();
  let nextExpiresAt;
  let expiryProvided = false;
  if (body.expiresAt !== undefined) {
    expiryProvided = true;
    if (body.expiresAt === null) {
      nextExpiresAt = null;
    } else if (
      !Number.isSafeInteger(body.expiresAt)
      || body.expiresAt <= now
      || body.expiresAt > now + MAX_CLIP_EXPIRY_MS
    ) {
      throw httpError(400, `expiresAt must be within the next ${MAX_CLIP_EXPIRY_MS} ms`);
    } else {
      nextExpiresAt = body.expiresAt;
    }
  } else if (body.expiresIn !== undefined) {
    expiryProvided = true;
    if (body.expiresIn === null) {
      nextExpiresAt = null;
    } else if (
      !Number.isSafeInteger(body.expiresIn)
      || body.expiresIn <= 0
      || body.expiresIn > MAX_CLIP_EXPIRY_MS
    ) {
      throw httpError(400, `expiresIn must be a positive integer no greater than ${MAX_CLIP_EXPIRY_MS}`);
    } else {
      nextExpiresAt = now + body.expiresIn;
    }
  }

  const clip = await commitStoreMutation((draft) => {
    const boardClips = draft.clips[boardId];
    if (!boardClips) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    const lockedBoard = draft.boards.find(board => board.id === boardId);
    if (lockedBoard?.locked) throw httpError(403, 'Board is locked', 'BOARD_LOCKED');
    const candidate = boardClips.find(item => item.id === clipId);
    if (!candidate) throw httpError(404, 'Clip not found', 'CLIP_NOT_FOUND');
    if (body.content !== undefined) {
      if (candidate.type !== 'text') throw httpError(400, 'Only text clips can be edited');
      candidate.content = body.content;
    }
    if (body.pinned !== undefined) {
      if (body.pinned) candidate.pinned = true;
      else delete candidate.pinned;
    }
    if (expiryProvided) {
      if (nextExpiresAt === null) delete candidate.expiresAt;
      else candidate.expiresAt = nextExpiresAt;
    }
    candidate.updatedAt = Date.now();
    return candidate;
  });
  broadcast({ type: 'clip-updated', boardId, clip });
  res.json(clip);
});

app.delete('/api/boards/:boardId/clips/:clipId', async (req, res) => {
  const boardId = assertSafeId(req.params.boardId, 'board id');
  const clipId = assertSafeId(req.params.clipId, 'clip id');
  const files = await commitStoreMutation((draft, context) => {
    const boardClips = draft.clips[boardId];
    if (!boardClips) throw httpError(404, 'Board not found', 'BOARD_NOT_FOUND');
    const lockedBoard = draft.boards.find(board => board.id === boardId);
    if (lockedBoard?.locked) throw httpError(403, 'Board is locked', 'BOARD_LOCKED');
    const clip = boardClips.find(candidate => candidate.id === clipId);
    if (!clip) throw httpError(404, 'Clip not found', 'CLIP_NOT_FOUND');
    const filepath = clipStoragePath(clip);
    const removedFiles = filepath ? [{ filepath, size: clipDiskSize(clip) }] : [];
    draft.clips[boardId] = boardClips.filter(candidate => candidate.id !== clipId);
    context.storedBinaryBytes -= removedFiles.reduce((total, item) => total + item.size, 0);
    return removedFiles;
  });
  broadcast({ type: 'clip-deleted', boardId, clipId });
  await unlinkCommittedFiles(files);
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
  // Only this allowlisted media response may be embedded, and only by Wklejka itself.
  allowSameOriginFilePreview(res);
  res.sendFile(filepath);
});

// Link preview
const linkPreviewCache = new Map();
const linkPreviewInflight = new Map();

function normalizePreviewPageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw httpError(400, 'Invalid URL', 'INVALID_URL');
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Unsupported URL');
    }
    url.hash = '';
    return url;
  } catch {
    throw httpError(400, 'Invalid URL', 'INVALID_URL');
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function linkPreviewCacheGet(key) {
  const entry = linkPreviewCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    linkPreviewCache.delete(key);
    return null;
  }
  linkPreviewCache.delete(key);
  linkPreviewCache.set(key, entry);
  return entry;
}

function linkPreviewCacheSet(key, value, { error = null, ttlMs = LINK_PREVIEW_CACHE_TTL_MS } = {}) {
  if (ttlMs <= 0) return;
  linkPreviewCache.delete(key);
  linkPreviewCache.set(key, { value, error, expiresAt: Date.now() + ttlMs });
  while (linkPreviewCache.size > LINK_PREVIEW_CACHE_MAX_ENTRIES) {
    linkPreviewCache.delete(linkPreviewCache.keys().next().value);
  }
}

async function normalizePreviewImage(value, pageUrl) {
  if (!value) return '';
  try {
    const imageUrl = new URL(decodeHtmlEntities(value), pageUrl);
    if (!['http:', 'https:'].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) return '';
    imageUrl.hash = '';
    await resolveSafePreviewTarget(imageUrl);
    return imageUrl.href;
  } catch {
    return '';
  }
}

async function buildLinkPreview(url) {
  const response = await fetchPreviewResponse(url.href);
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('text/html')) return { title: '', description: '', image: '' };
  const html = response.text.substring(0, 50000);
  const getMeta = (attribute, name) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = new RegExp(`<meta[^>]*${attribute}=["']${escapedName}["'][^>]*content=["']([^"']*)["']`, 'i');
    const firstMatch = html.match(first);
    if (firstMatch) return firstMatch[1];
    const second = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attribute}=["']${escapedName}["']`, 'i');
    return html.match(second)?.[1] || '';
  };
  const title = decodeHtmlEntities(
    getMeta('property', 'og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1],
  );
  const description = decodeHtmlEntities(
    getMeta('property', 'og:description') || getMeta('name', 'description'),
  );
  const image = await normalizePreviewImage(getMeta('property', 'og:image'), response.url);
  return {
    title: title.substring(0, 200),
    description: description.substring(0, 500),
    image,
  };
}

async function getLinkPreview(url) {
  const key = url.href;
  const cached = linkPreviewCacheGet(key);
  if (cached) {
    runtimeMetrics.linkPreviewCacheHits += 1;
    if (cached.error) {
      throw Object.assign(new Error(cached.error.message), {
        status: cached.error.status,
        code: cached.error.code,
      });
    }
    return cached.value;
  }
  const inflight = linkPreviewInflight.get(key);
  if (inflight) {
    runtimeMetrics.linkPreviewInflightDeduplications += 1;
    return inflight;
  }
  runtimeMetrics.linkPreviewCacheMisses += 1;
  const request = buildLinkPreview(url)
    .then((preview) => {
      linkPreviewCacheSet(key, preview);
      return preview;
    })
    .catch((error) => {
      linkPreviewCacheSet(key, null, {
        error: {
          message: error.message || 'Failed to fetch',
          status: error.status,
          code: error.code,
        },
        ttlMs: LINK_PREVIEW_NEGATIVE_CACHE_TTL_MS,
      });
      throw error;
    })
    .finally(() => linkPreviewInflight.delete(key));
  linkPreviewInflight.set(key, request);
  return request;
}

app.get('/api/link-preview', async (req, res) => {
  try {
    const url = normalizePreviewPageUrl(req.query.url);
    return res.json(await getLinkPreview(url));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message, code: error.code });
    if (/private address|local address|Too many redirects/i.test(error.message)) {
      return res.status(400).json({ error: 'URL not allowed' });
    }
    return res.status(502).json({ error: 'Failed to fetch' });
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
    ws.close(1008, 'Server-push channel');
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

let expiryCleanupPromise = null;

function buildCleanupPlan(candidateStore, now, { boardId = null, olderThan = null } = {}) {
  const expiredBoards = candidateStore.boards.filter(board => (
    board.id !== 'default'
    && (!boardId || board.id === boardId)
    && Number.isSafeInteger(board.expiresAt)
    && board.expiresAt <= now
  ));
  const expiredBoardIds = new Set(expiredBoards.map(board => board.id));
  const clipEvents = [];
  const removedClipIds = new Map();

  for (const board of candidateStore.boards) {
    if (expiredBoardIds.has(board.id) || (boardId && board.id !== boardId)) continue;
    const ids = [];
    for (const clip of candidateStore.clips[board.id] || []) {
      const explicitlyExpired = Number.isSafeInteger(clip.expiresAt) && clip.expiresAt <= now;
      const oldEnoughForRetention = !clip.pinned
        && CLIP_RETENTION_MS > 0
        && Number.isSafeInteger(clip.createdAt)
        && clip.createdAt <= now - CLIP_RETENTION_MS;
      const oldEnoughForMaintenance = !clip.pinned
        && olderThan !== null
        && Number.isSafeInteger(clip.createdAt)
        && clip.createdAt < olderThan;
      if (!explicitlyExpired && !oldEnoughForRetention && !oldEnoughForMaintenance) continue;
      ids.push(clip.id);
      clipEvents.push({ boardId: board.id, clipId: clip.id });
    }
    if (ids.length) removedClipIds.set(board.id, new Set(ids));
  }

  const files = expiredBoards.flatMap(board => boardFileData(candidateStore, board.id));
  for (const [id, ids] of removedClipIds) {
    for (const clip of candidateStore.clips[id] || []) {
      if (!ids.has(clip.id)) continue;
      const filepath = clipStoragePath(clip);
      if (filepath) files.push({ filepath, size: clipDiskSize(clip) });
    }
  }

  return {
    expiredBoards,
    expiredBoardIds,
    removedClipIds,
    clipEvents,
    files,
    reclaimedBytes: files.reduce((total, item) => total + item.size, 0),
  };
}

async function performCleanup({ dryRun = false, boardId = null, olderThan = null } = {}) {
  const now = Date.now();
  const initialPlan = buildCleanupPlan(store, now, { boardId, olderThan });
  if (dryRun || (!initialPlan.expiredBoards.length && !initialPlan.clipEvents.length)) {
    return initialPlan;
  }

  const result = await commitStoreMutation((draft, context) => {
    const plan = buildCleanupPlan(draft, now, { boardId, olderThan });
    draft.boards = draft.boards.filter(board => !plan.expiredBoardIds.has(board.id));
    for (const id of plan.expiredBoardIds) delete draft.clips[id];
    for (const [id, ids] of plan.removedClipIds) {
      draft.clips[id] = (draft.clips[id] || []).filter(clip => !ids.has(clip.id));
    }
    context.storedBinaryBytes -= plan.reclaimedBytes;
    return plan;
  });

  for (const board of result.expiredBoards) {
    console.log(JSON.stringify({ level: 'info', event: 'board_expired', boardId: board.id }));
    broadcast({ type: 'board-deleted', boardId: board.id });
  }
  for (const event of result.clipEvents) {
    broadcast({ type: 'clip-deleted', ...event });
  }
  await unlinkCommittedFiles(result.files);
  return result;
}

async function cleanupExpiredContent(options) {
  if (expiryCleanupPromise) await expiryCleanupPromise;
  const operation = performCleanup(options);
  expiryCleanupPromise = operation.catch(() => {});
  try {
    return await operation;
  } finally {
    expiryCleanupPromise = null;
  }
}

const expiryCleanupTimer = setInterval(() => {
  void cleanupExpiredContent().catch((error) => {
    console.error(JSON.stringify({
      level: 'error',
      event: 'expiry_cleanup_failed',
      message: error.message,
    }));
  });
}, 60_000);
expiryCleanupTimer.unref();

// --- Orphan file cleanup on startup ---

function cleanOrphanFiles({ includeRecent = false, dryRun = false } = {}) {
  const referencedImages = new Set();
  const referencedFiles = new Set();
  for (const clips of Object.values(store.clips)) {
    for (const clip of clips) {
      if (clip.type === 'image' && clip.filename) referencedImages.add(clip.filename);
      if (clip.type === 'file' && clip.filename) referencedFiles.add(clip.filename);
    }
  }

  let candidates = 0;
  let removed = 0;
  let candidateBytes = 0;
  let reclaimedBytes = 0;
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  for (const [dir, label, referenced] of [
    [IMAGES_DIR, 'image', referencedImages],
    [FILES_DIR, 'file', referencedFiles],
  ]) {
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!referenced.has(f)) {
        const filepath = path.join(dir, f);
        if (pendingBinaryPaths.has(filepath)) continue;
        let stat;
        try { stat = fs.statSync(filepath); } catch { continue; }
        if (!includeRecent && stat.mtimeMs > cutoff) continue;
        candidates++;
        const size = stat.isFile() ? stat.size : 0;
        candidateBytes += size;
        if (dryRun) continue;
        try {
          fs.unlinkSync(filepath);
          removed++;
          reclaimedBytes += size;
          console.log(`Orphan ${label} removed: ${f}`);
        } catch {
          // Online orphan cleanup is best-effort; retry on the next pass.
        }
      }
    }
  }
  if (includeRecent && !dryRun) {
    try {
      for (const file of fs.readdirSync(DATA_DIR)) {
        if (!/^\.store-.*\.tmp$/.test(file)) continue;
        try {
          fs.unlinkSync(path.join(DATA_DIR, file));
          removed++;
          candidates++;
        } catch {
          // Startup temp-file cleanup is best-effort.
        }
      }
    } catch {
      // A later maintenance pass can retry if the data directory is transiently unavailable.
    }
  }
  if (removed) console.log(`Orphan cleanup: removed ${removed} file(s)`);
  return { candidates, removed, candidateBytes, reclaimedBytes };
}

cleanOrphanFiles({ includeRecent: true });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wklejka running at http://0.0.0.0:${PORT}`);
});

let shutdownPromise = null;

function closeWebsockets() {
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      for (const ws of clients) ws.terminate();
    }, 1000);
    wss.close(() => {
      clearTimeout(forceTimer);
      resolve();
    });
    for (const ws of clients) {
      try { ws.close(1001, 'Server shutting down'); } catch { ws.terminate(); }
    }
  });
}

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function shutdown(signal) {
  if (shutdownPromise) {
    console.error(JSON.stringify({ level: 'warn', event: 'forced_shutdown', signal }));
    process.exit(1);
  }

  shuttingDown = true;
  clearInterval(expiryCleanupTimer);
  clearInterval(websocketHeartbeat);
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));

  const forceTimer = setTimeout(() => {
    for (const ws of clients) ws.terminate();
    server.closeAllConnections?.();
  }, 5000);

  shutdownPromise = (async () => {
    let exitCode = 0;
    try {
      // Stop accepting requests, close upgraded connections, let active HTTP
      // requests settle, then flush the serialized mutation/store queues.
      await Promise.all([closeHttpServer(), closeWebsockets()]);
      if (expiryCleanupPromise) await expiryCleanupPromise;
      await flushStore();
      await storeWriter.close();
    } catch (error) {
      exitCode = 1;
      console.error(JSON.stringify({
        level: 'error',
        event: 'shutdown_failed',
        message: error.message,
      }));
    } finally {
      clearTimeout(forceTimer);
      console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete', exitCode }));
      process.exit(exitCode);
    }
  })();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

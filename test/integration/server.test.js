const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const qrcode = require('qrcode-generator');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REQUEST_TIMEOUT_MS = 3_000;
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise(resolve => probe.close(resolve));
  if (!port) throw new Error('Failed to allocate an integration-test port');
  return port;
}

async function waitFor(predicate, message, timeoutMs = REQUEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  const error = new Error(message);
  if (lastError) error.cause = lastError;
  throw error;
}

async function stopProcess(child, exitPromise, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([exitPromise, delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, delay(1_000)]);
  }
}

async function startApp(t, env = {}) {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wklejka-integration-'));
  const dataDir = path.join(sandbox, 'data');
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATA_DIR: dataDir,
      AUTH_TOKEN: '',
      AUTH_USERNAME: '',
      AUTH_PASSWORD: '',
      WKLEJKA_TOKEN: '',
      WKLEJKA_USER: '',
      WKLEJKA_PASSWORD: '',
      PUBLIC_ORIGIN: '',
      PUBLIC_ORIGINS: '',
      TRUST_PROXY: '',
      WS_ALLOW_NO_ORIGIN: 'false',
      LOG_REQUESTS: 'false',
      STORE_SAVE_DEBOUNCE_MS: '1',
      STORE_SAVE_MAX_WAIT_MS: '5',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  const exitPromise = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const app = {
    child,
    dataDir,
    exitPromise,
    port,
    sandbox,
    url: `http://127.0.0.1:${port}`,
    logs: () => output.join('').slice(-8_000),
  };

  try {
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Server exited during startup\n${app.logs()}`);
      }
      const response = await fetch(`${app.url}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      return response.ok;
    }, `Server did not become healthy\n${app.logs()}`);
  } catch (error) {
    await stopProcess(child, exitPromise, 'SIGKILL');
    await fs.promises.rm(sandbox, { recursive: true, force: true });
    throw error;
  }

  t.after(async () => {
    await stopProcess(child, exitPromise);
    await fs.promises.rm(sandbox, { recursive: true, force: true });
  });
  return app;
}

async function request(app, pathname, options = {}) {
  const response = await fetch(`${app.url}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { body, headers: response.headers, status: response.status };
}

function rawHttpGet(app, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: app.port,
      path: pathname,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = text;
        try { body = JSON.parse(text); } catch {}
        resolve({ body, headers: res.headers, status: res.statusCode || 0 });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('HTTP request timed out')));
    req.once('error', reject);
    req.end();
  });
}

async function jsonRequest(app, pathname, method, body, headers = {}) {
  return request(app, pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function qrSvg(value) {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

async function upload(app, data, {
  boardId = 'default',
  clipType = 'file',
  contentType = 'application/octet-stream',
  originalName = 'fixture.bin',
  headers = {},
} = {}) {
  return request(app, `/api/boards/${boardId}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Clip-Type': clipType,
      'X-Original-Name': encodeURIComponent(originalName),
      ...headers,
    },
    body: data,
  });
}

function chunkedUpload(app, chunks, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: app.port,
      path: '/api/boards/default/uploads',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Clip-Type': 'file',
        'X-Original-Name': 'chunked.bin',
        ...headers,
      },
    }, (res) => {
      const body = [];
      res.on('data', chunk => body.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(body).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ body: parsed, headers: res.headers, status: res.statusCode });
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Upload request timed out')));
    req.once('error', reject);
    chunks.forEach(chunk => req.write(chunk));
    req.end();
  });
}

/**
 * @param {object} app
 * @param {{ authorization?: string, host?: string, origin?: string, pathname?: string }} options
 */
function rawWebSocketUpgrade(app, {
  authorization,
  host = `127.0.0.1:${app.port}`,
  origin,
  pathname = '/ws',
} = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: app.port });
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('WebSocket handshake timed out'));
    }, REQUEST_TIMEOUT_MS);

    const finish = (error, result) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.once('error', error => finish(error));
    socket.on('data', (chunk) => {
      response += chunk.toString('latin1');
      if (!response.includes('\r\n\r\n')) return;
      const match = response.match(/^HTTP\/1\.1 (\d{3})/);
      if (!match) return finish(new Error(`Invalid handshake response: ${response}`));
      finish(null, { response, status: Number(match[1]) });
    });
    socket.once('connect', () => {
      const headers = [
        `GET ${pathname} HTTP/1.1`,
        `Host: ${host}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${Buffer.alloc(16, 7).toString('base64')}`,
      ];
      if (origin !== undefined) headers.push(`Origin: ${origin}`);
      if (authorization) headers.push(`Authorization: ${authorization}`);
      socket.write(`${headers.join('\r\n')}\r\n\r\n`);
    });
  });
}

test('streaming uploads persist exact file and image bytes before acknowledging', async (t) => {
  const app = await startApp(t);
  const fileBody = Buffer.from('zażółć gęślą jaźń\n', 'utf8');

  const fileResult = await upload(app, fileBody, {
    contentType: 'text/plain',
    originalName: 'ważny plik.txt',
  });
  assert.equal(fileResult.status, 200);
  assert.equal(fileResult.body.type, 'file');
  assert.equal(fileResult.body.originalName, 'ważny plik.txt');
  assert.equal(fileResult.body.size, fileBody.length);

  const download = await fetch(`${app.url}${fileResult.body.fileUrl}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBody);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);

  const imageResult = await upload(app, PNG_1X1, {
    clipType: 'image',
    contentType: 'image/png',
    originalName: 'ignored.png',
  });
  assert.equal(imageResult.status, 200);
  assert.equal(imageResult.body.type, 'image');
  assert.equal(imageResult.body.mimeType, 'image/png');
  assert.equal(imageResult.body.size, PNG_1X1.length);

  const metadata = JSON.parse(await fs.promises.readFile(path.join(app.dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(
    metadata.clips.default.slice(0, 2).map(clip => clip.id),
    [imageResult.body.id, fileResult.body.id],
    'the success response must not race ahead of the durable metadata write',
  );
  assert.equal(
    (await fs.promises.stat(path.join(app.dataDir, 'files', fileResult.body.filename))).mode & 0o777,
    0o600,
  );

  const invalidImage = await upload(app, Buffer.from('not a png'), {
    clipType: 'image',
    contentType: 'image/png',
  });
  assert.equal(invalidImage.status, 400);
  assert.equal(invalidImage.body.code, 'INVALID_IMAGE_DATA');
  assert.deepEqual(
    await fs.promises.readdir(path.join(app.dataDir, 'images')),
    [imageResult.body.filename],
    'a rejected image must not leave a temporary or final file',
  );
});

test('streaming limits accept the boundary and clean up rejected chunked bodies', async (t) => {
  const app = await startApp(t, {
    MAX_CLIP_BINARY_BYTES: '8',
    MAX_STORAGE_BYTES: '8',
  });

  const tooLarge = await chunkedUpload(app, [Buffer.alloc(6, 2), Buffer.alloc(3, 3)]);
  assert.equal(tooLarge.status, 413);
  assert.match(tooLarge.body.error, /too large/i);

  const boundary = await upload(app, Buffer.alloc(8, 1));
  assert.equal(boundary.status, 200);
  assert.equal(boundary.body.size, 8);

  const overQuota = await upload(app, Buffer.from([4]));
  assert.equal(overQuota.status, 507);
  assert.equal(overQuota.body.code, 'STORAGE_QUOTA_EXCEEDED');

  const clips = await request(app, '/api/boards/default/clips');
  assert.equal(clips.status, 200);
  assert.deepEqual(clips.body.map(clip => clip.id), [boundary.body.id]);
  assert.deepEqual(
    await fs.promises.readdir(path.join(app.dataDir, 'files')),
    [boundary.body.filename],
    'failed streams must not consume quota or leave .upload files',
  );
});

test('an aborted streaming request releases its reservation and removes the partial file', async (t) => {
  const app = await startApp(t, { MAX_CLIP_BINARY_BYTES: String(1024 * 1024) });
  const req = http.request({
    hostname: '127.0.0.1',
    port: app.port,
    path: '/api/boards/default/uploads',
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Clip-Type': 'file',
      'X-Original-Name': 'aborted.bin',
    },
  });
  req.once('error', () => {});
  const requestClosed = new Promise(resolve => req.once('close', resolve));
  req.write(Buffer.alloc(64 * 1024, 5));

  const filesDir = path.join(app.dataDir, 'files');
  await waitFor(
    async () => (await fs.promises.readdir(filesDir)).some(name => name.startsWith('.upload-')),
    'The server never created the streaming temporary file',
  );
  req.destroy();
  await requestClosed;

  await waitFor(
    async () => (await fs.promises.readdir(filesDir)).length === 0,
    'The server did not remove the aborted upload',
  );
  const clips = await request(app, '/api/boards/default/clips');
  assert.deepEqual(clips.body, []);
  const status = await request(app, '/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.storage.activeUploadBytes, 0);
  assert.equal((await request(app, '/livez')).status, 200, `server exited after abort\n${app.logs()}`);
});

test('WebSocket upgrade validates path, Host, Origin, and authentication without crashing', async (t) => {
  const app = await startApp(t, { AUTH_TOKEN: 'integration-secret' });
  const origin = `http://127.0.0.1:${app.port}`;
  const bearer = 'Bearer integration-secret';

  assert.equal((await rawWebSocketUpgrade(app, { origin, authorization: bearer })).status, 101);
  assert.equal((await rawWebSocketUpgrade(app, { origin })).status, 401);
  assert.equal((await rawWebSocketUpgrade(app, {
    origin: 'https://attacker.invalid',
    authorization: bearer,
  })).status, 403);
  assert.equal((await rawWebSocketUpgrade(app, { authorization: bearer })).status, 403);
  assert.equal((await rawWebSocketUpgrade(app, {
    pathname: '/not-websocket',
    origin,
    authorization: bearer,
  })).status, 404);
  assert.equal((await rawWebSocketUpgrade(app, {
    host: '[',
    origin,
    authorization: bearer,
  })).status, 400);

  const live = await request(app, '/livez');
  assert.equal(live.status, 200, `malformed upgrade terminated the process\n${app.logs()}`);
  assert.deepEqual(live.body, { ok: true });
});

test('readiness reports durable-store failure, failed mutations stay invisible, and recovery is possible', async (t) => {
  const app = await startApp(t);
  const initialReady = await request(app, '/readyz');
  assert.equal(initialReady.status, 200);
  assert.deepEqual(initialReady.body, { ok: true, storage: 'ready', code: null });

  const displacedDataDir = `${app.dataDir}.offline`;
  await fs.promises.rename(app.dataDir, displacedDataDir);
  await fs.promises.writeFile(app.dataDir, 'simulated unavailable mount');
  let restored = false;

  const restoreDataDirectory = async () => {
    if (restored) return;
    await fs.promises.unlink(app.dataDir).catch(() => {});
    await fs.promises.rename(displacedDataDir, app.dataDir);
    restored = true;
  };

  try {
    const failedMutation = await jsonRequest(
      app,
      '/api/boards/default/clips',
      'POST',
      { type: 'text', content: 'must not become visible' },
    );
    assert.equal(failedMutation.status, 503);
    assert.equal(failedMutation.body.code, 'STORAGE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(failedMutation.body), /\/Users\/|node_modules|server\.js/);

    const notCommitted = await request(app, '/api/boards/default/clips');
    assert.deepEqual(notCommitted.body, []);

    const unavailable = await request(app, '/readyz');
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.ok, false);
    assert.equal(unavailable.body.storage, 'unavailable');
    assert.equal(unavailable.body.code, 'ENOTDIR');
    assert.equal((await request(app, '/livez')).status, 200);
  } finally {
    await restoreDataDirectory();
  }

  const recoveredMutation = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'persisted after recovery' },
  );
  assert.equal(recoveredMutation.status, 200);
  const recovered = await request(app, '/readyz');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.storage, 'ready');

  const metadata = JSON.parse(await fs.promises.readFile(path.join(app.dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(metadata.clips.default.map(clip => clip.content), ['persisted after recovery']);
});

test('clip pagination keeps pinned order, has no cross-page duplicates, and preserves the legacy array', async (t) => {
  const app = await startApp(t, {
    DEFAULT_CLIPS_PAGE_SIZE: '2',
    MAX_CLIPS_PAGE_SIZE: '3',
  });
  const clips = [];
  for (const content of ['oldest needle', 'second', 'third needle', 'newest']) {
    const result = await jsonRequest(
      app,
      '/api/boards/default/clips',
      'POST',
      { type: 'text', content },
    );
    assert.equal(result.status, 200);
    clips.push(result.body);
    await delay(3);
  }
  const file = await upload(app, Buffer.from('report'), {
    contentType: 'text/plain',
    originalName: 'Needle-report.txt',
  });
  assert.equal(file.status, 200);
  clips.push(file.body);

  for (const clip of [clips[0], clips[2]]) {
    const pinned = await jsonRequest(
      app,
      `/api/boards/default/clips/${clip.id}`,
      'PUT',
      { pinned: true },
    );
    assert.equal(pinned.status, 200);
    clip.pinned = true;
  }

  const expected = [...clips].sort((left, right) => {
    const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    if (pinned) return pinned;
    const created = right.createdAt - left.createdAt;
    return created || String(right.id).localeCompare(String(left.id));
  });
  const legacy = await request(app, '/api/boards/default/clips');
  assert.equal(legacy.status, 200);
  assert.equal(Array.isArray(legacy.body), true);
  assert.deepEqual(legacy.body.map(clip => clip.id), expected.map(clip => clip.id));
  assert.deepEqual(
    legacy.body.slice(0, 2).map(clip => clip.id),
    [clips[2].id, clips[0].id],
    'pinned clips must precede newer unpinned clips and remain newest-first within the group',
  );

  const collected = [];
  const seen = new Set();
  let cursor = null;
  do {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await request(app, `/api/boards/default/clips?limit=2${suffix}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.total, expected.length);
    assert.ok(page.body.items.length > 0);
    for (const clip of page.body.items) {
      assert.equal(seen.has(clip.id), false, `duplicate clip across cursor pages: ${clip.id}`);
      seen.add(clip.id);
      collected.push(clip.id);
    }
    cursor = page.body.nextCursor;
  } while (cursor);
  assert.deepEqual(collected, expected.map(clip => clip.id));

  const search = await request(app, '/api/boards/default/clips?q=NEEDLE&limit=3');
  assert.equal(search.status, 200);
  assert.equal(search.body.total, 3);
  assert.deepEqual(
    new Set(search.body.items.map(clip => clip.id)),
    new Set([clips[0].id, clips[2].id, file.body.id]),
  );
  const typedSearch = await request(app, '/api/boards/default/clips?type=file&q=needle');
  assert.equal(typedSearch.status, 200);
  assert.equal(typedSearch.body.total, 1);
  assert.deepEqual(typedSearch.body.items.map(clip => clip.id), [file.body.id]);

  assert.equal((await request(app, '/api/boards/default/clips?limit=4')).status, 400);
  assert.equal((await request(app, '/api/boards/default/clips?cursor=not-a-cursor')).status, 400);
  assert.equal((await request(app, '/api/boards/default/clips?type=archive')).status, 400);
  assert.equal((await request(app, '/api/boards/default/clips?unexpected=1')).status, 400);
});

test('pin and expiry updates validate bounds and can be cleared', async (t) => {
  const app = await startApp(t, { MAX_CLIP_EXPIRY_MS: '1000' });
  const created = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'expiring note' },
  );
  assert.equal(created.status, 200);

  const beforeUpdate = Date.now();
  const updated = await jsonRequest(
    app,
    `/api/boards/default/clips/${created.body.id}`,
    'PUT',
    { pinned: true, expiresIn: 200 },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.pinned, true);
  assert.ok(updated.body.expiresAt >= beforeUpdate + 200);
  assert.ok(updated.body.expiresAt <= Date.now() + 200);

  const invalidBodies = [
    { pinned: 'true' },
    { expiresAt: Date.now() + 100, expiresIn: 100 },
    { expiresIn: 0 },
    { expiresIn: 1001 },
    { expiresAt: Date.now() - 1 },
  ];
  for (const body of invalidBodies) {
    const invalid = await jsonRequest(
      app,
      `/api/boards/default/clips/${created.body.id}`,
      'PUT',
      body,
    );
    assert.equal(invalid.status, 400, `unexpected status for ${JSON.stringify(body)}`);
  }

  const cleared = await jsonRequest(
    app,
    `/api/boards/default/clips/${created.body.id}`,
    'PUT',
    { pinned: false, expiresAt: null },
  );
  assert.equal(cleared.status, 200);
  assert.equal(Object.hasOwn(cleared.body, 'pinned'), false);
  assert.equal(Object.hasOwn(cleared.body, 'expiresAt'), false);
});

test('bulk delete is atomic, respects locks and limits, and reclaims file bytes', async (t) => {
  const app = await startApp(t, { MAX_BULK_DELETE: '3' });
  const defaultLock = await jsonRequest(app, '/api/boards/default', 'PUT', { locked: true });
  assert.equal(defaultLock.status, 400);
  assert.equal(defaultLock.body.code, 'DEFAULT_BOARD_CANNOT_BE_LOCKED');
  const board = await jsonRequest(app, '/api/boards', 'POST', { name: 'Bulk operations' });
  assert.equal(board.status, 200);
  const clipsPath = `/api/boards/${board.body.id}/clips`;
  const first = await jsonRequest(
    app,
    clipsPath,
    'POST',
    { type: 'text', content: 'delete me' },
  );
  const survivor = await jsonRequest(
    app,
    clipsPath,
    'POST',
    { type: 'text', content: 'keep me' },
  );
  const file = await upload(app, Buffer.from('12345'), {
    boardId: board.body.id,
    originalName: 'delete.bin',
  });
  assert.equal(first.status, 200);
  assert.equal(survivor.status, 200);
  assert.equal(file.status, 200);

  assert.equal((await jsonRequest(app, `/api/boards/${board.body.id}`, 'PUT', { locked: true })).status, 200);
  const blocked = await jsonRequest(
    app,
    `${clipsPath}/bulk-delete`,
    'POST',
    { ids: [first.body.id] },
  );
  assert.equal(blocked.status, 403);
  assert.equal((await jsonRequest(app, `/api/boards/${board.body.id}`, 'PUT', { locked: false })).status, 200);

  const missingId = 'missing-clip';
  const deleted = await jsonRequest(
    app,
    `${clipsPath}/bulk-delete`,
    'POST',
    { ids: [file.body.id, first.body.id, missingId] },
  );
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, 2);
  assert.deepEqual(new Set(deleted.body.deletedIds), new Set([file.body.id, first.body.id]));
  assert.deepEqual(deleted.body.notFoundIds, [missingId]);
  assert.equal(deleted.body.reclaimedBytes, 5);
  assert.equal((await request(app, file.body.fileUrl)).status, 404);

  const remaining = await request(app, clipsPath);
  assert.deepEqual(remaining.body.map(clip => clip.id), [survivor.body.id]);
  const persisted = JSON.parse(await fs.promises.readFile(path.join(app.dataDir, 'store.json'), 'utf8'));
  assert.deepEqual(persisted.clips[board.body.id].map(clip => clip.id), [survivor.body.id]);

  assert.equal((await jsonRequest(
    app,
    `${clipsPath}/bulk-delete`,
    'POST',
    { ids: [] },
  )).status, 400);
  assert.equal((await jsonRequest(
    app,
    `${clipsPath}/bulk-delete`,
    'POST',
    { ids: [survivor.body.id, survivor.body.id] },
  )).status, 400);
  assert.equal((await jsonRequest(
    app,
    `${clipsPath}/bulk-delete`,
    'POST',
    { ids: ['clip-a', 'clip-b', 'clip-c', 'clip-d'] },
  )).status, 400);
});

test('maintenance dry-run previews cleanup and execution preserves pinned clips', async (t) => {
  const app = await startApp(t, {
    CLIP_RETENTION_MS: '0',
    ORPHAN_GRACE_MS: '0',
  });
  const pinned = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'pinned survivor' },
  );
  assert.equal(pinned.status, 200);
  assert.equal((await jsonRequest(
    app,
    `/api/boards/default/clips/${pinned.body.id}`,
    'PUT',
    { pinned: true },
  )).status, 200);
  const file = await upload(app, Buffer.from('cleanup fixture'), { originalName: 'cleanup.bin' });
  assert.equal(file.status, 200);

  const orphanPath = path.join(app.dataDir, 'files', 'orphan.bin');
  await fs.promises.writeFile(orphanPath, 'orphan');
  const oldTime = new Date(Date.now() - 10_000);
  await fs.promises.utimes(orphanPath, oldTime, oldTime);
  await delay(5);
  const olderThan = Date.now();

  const preview = await jsonRequest(
    app,
    '/api/maintenance/cleanup',
    'POST',
    { dryRun: true, boardId: 'default', olderThan },
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.dryRun, true);
  assert.deepEqual(preview.body.matched, { boards: 0, clips: 1, orphans: 1 });
  assert.deepEqual(preview.body.deleted, { boards: 0, clips: 0, orphans: 0 });
  assert.equal(preview.body.reclaimedBytes, Buffer.byteLength('cleanup fixture') + Buffer.byteLength('orphan'));
  assert.equal((await request(app, file.body.fileUrl)).status, 200);
  assert.equal((await fs.promises.stat(orphanPath)).isFile(), true);

  const cleanup = await jsonRequest(
    app,
    '/api/maintenance/cleanup',
    'POST',
    { dryRun: false, boardId: 'default', olderThan },
  );
  assert.equal(cleanup.status, 200);
  assert.deepEqual(cleanup.body.matched, { boards: 0, clips: 1, orphans: 1 });
  assert.deepEqual(cleanup.body.deleted, { boards: 0, clips: 1, orphans: 1 });
  assert.equal(cleanup.body.reclaimedBytes, preview.body.reclaimedBytes);
  await assert.rejects(fs.promises.stat(orphanPath), error => (
    Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
  ));
  assert.equal((await request(app, file.body.fileUrl)).status, 404);
  const remaining = await request(app, '/api/boards/default/clips');
  assert.deepEqual(remaining.body.map(clip => clip.id), [pinned.body.id]);

  const invalid = await jsonRequest(
    app,
    '/api/maintenance/cleanup',
    'POST',
    { dryRun: true, olderThan: Date.now() + 60_000 },
  );
  assert.equal(invalid.status, 400);
});

test('metadata export and Prometheus metrics require auth and do not leak clip content', async (t) => {
  const app = await startApp(t, { AUTH_TOKEN: 'p2-secret' });
  const authorization = { Authorization: 'Bearer p2-secret' };

  assert.equal((await request(app, '/api/export')).status, 401);
  assert.equal((await request(app, '/api/metrics')).status, 401);
  assert.equal((await request(app, '/livez')).status, 200);

  const clip = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'private metric sentinel' },
    authorization,
  );
  assert.equal(clip.status, 200);

  const exported = await request(app, '/api/export', { headers: authorization });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.schemaVersion, 1);
  assert.equal(Number.isNaN(Date.parse(exported.body.exportedAt)), false);
  assert.equal(exported.body.boards.some(board => board.id === 'default'), true);
  assert.deepEqual(exported.body.clips.default.map(item => item.id), [clip.body.id]);
  assert.match(exported.headers.get('content-disposition'), /^attachment;/);

  const metrics = await request(app, '/api/metrics', { headers: authorization });
  assert.equal(metrics.status, 200);
  assert.match(metrics.headers.get('content-type'), /^text\/plain/);
  assert.match(metrics.body, /^# HELP wklejka_up/m);
  assert.match(metrics.body, /^wklejka_store_ready 1$/m);
  assert.match(metrics.body, /^wklejka_clips 1$/m);
  assert.match(metrics.body, /^wklejka_http_requests_total\{method="GET",status="401"\} 2$/m);
  assert.doesNotMatch(metrics.body, /private metric sentinel/);
});

test('QR sharing renders only an authenticated, existing clip link without leaking auth', async (t) => {
  const app = await startApp(t, {
    AUTH_TOKEN: 'qr-integration-secret',
    PUBLIC_ORIGIN: 'https://paste.example',
  });
  const authorization = { Authorization: 'Bearer qr-integration-secret' };
  const clip = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'QR payload source' },
    authorization,
  );
  assert.equal(clip.status, 200);

  const endpoint = `/api/share/qr?boardId=default&clipId=${clip.body.id}&lang=pl`;
  assert.equal((await request(app, endpoint)).status, 401);

  const result = await request(app, endpoint, {
    headers: { ...authorization, Host: 'attacker.invalid' },
  });
  const expectedLink = `https://paste.example/?lang=pl#clip=default:${clip.body.id}`;
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /^image\/svg\+xml/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.body, qrSvg(expectedLink));
  assert.match(result.body, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(result.body, /qr-integration-secret|attacker\.invalid/);
});

test('QR sharing rejects missing, invalid, unknown, and nonexistent targets', async (t) => {
  const app = await startApp(t, { AUTH_TOKEN: 'qr-validation-secret' });
  const authorization = { Authorization: 'Bearer qr-validation-secret' };
  const clip = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'QR validation source' },
    authorization,
  );
  assert.equal(clip.status, 200);

  /** @type {Array<[string, number, string]>} */
  const cases = [
    ['/api/share/qr', 400, 'BAD_REQUEST'],
    ['/api/share/qr?boardId=default', 400, 'BAD_REQUEST'],
    ['/api/share/qr?clipId=missing', 400, 'BAD_REQUEST'],
    [`/api/share/qr?boardId=default&clipId=${clip.body.id}&lang=de`, 400, 'INVALID_LANGUAGE'],
    [`/api/share/qr?boardId=../default&clipId=${clip.body.id}`, 400, 'BAD_REQUEST'],
    ['/api/share/qr?boardId=default&clipId=../missing', 400, 'BAD_REQUEST'],
    [`/api/share/qr?boardId=default&clipId=${clip.body.id}&url=https://attacker.invalid`, 400, 'BAD_REQUEST'],
    [`/api/share/qr?boardId=default&clipId=${clip.body.id}&token=qr-validation-secret`, 400, 'BAD_REQUEST'],
    ['/api/share/qr?boardId=missing&clipId=missing', 404, 'BOARD_NOT_FOUND'],
    ['/api/share/qr?boardId=default&clipId=missing', 404, 'CLIP_NOT_FOUND'],
  ];
  for (const [pathname, status, code] of cases) {
    const result = await request(app, pathname, { headers: authorization });
    assert.equal(result.status, status, pathname);
    assert.equal(result.body.code, code, pathname);
  }

  const fallback = await request(
    app,
    `/api/share/qr?boardId=default&clipId=${clip.body.id}&lang=en`,
    { headers: authorization },
  );
  assert.equal(fallback.status, 200);
  assert.equal(
    fallback.body,
    qrSvg(`${app.url}/?lang=en#clip=default:${clip.body.id}`),
  );
  assert.doesNotMatch(fallback.body, /qr-validation-secret/);
});

test('QR sharing enforces an ambiguous public-origin allowlist against the request origin', async (t) => {
  const app = await startApp(t, {
    AUTH_TOKEN: 'qr-origin-secret',
    PUBLIC_ORIGIN: 'https://one.example, https://two.example',
    TRUST_PROXY: 'loopback',
  });
  const authorization = { Authorization: 'Bearer qr-origin-secret' };
  const clip = await jsonRequest(
    app,
    '/api/boards/default/clips',
    'POST',
    { type: 'text', content: 'QR origin source' },
    authorization,
  );
  assert.equal(clip.status, 200);
  const endpoint = `/api/share/qr?boardId=default&clipId=${clip.body.id}`;

  const rejected = await rawHttpGet(app, endpoint, {
    ...authorization,
    Host: 'attacker.invalid',
    'X-Forwarded-Proto': 'https',
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'INVALID_REQUEST_ORIGIN');

  const allowed = await rawHttpGet(app, endpoint, {
    ...authorization,
    Host: 'two.example',
    'X-Forwarded-Proto': 'https',
  });
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.body,
    qrSvg(`https://two.example/#clip=default:${clip.body.id}`),
  );
});

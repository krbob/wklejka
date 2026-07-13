const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
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

async function jsonRequest(app, pathname, method, body, headers = {}) {
  return request(app, pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function upload(app, data, {
  clipType = 'file',
  contentType = 'application/octet-stream',
  originalName = 'fixture.bin',
  headers = {},
} = {}) {
  return request(app, '/api/boards/default/uploads', {
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

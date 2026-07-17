const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const publicDirectory = path.join(__dirname, '..', 'public');
const htmlSource = readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
const highlightSource = readFileSync(path.join(publicDirectory, 'highlight.js'), 'utf8');
const appSource = readFileSync(path.join(publicDirectory, 'app.js'), 'utf8');

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   createdAt?: number,
 *   locked?: boolean,
 *   expiresAt?: number,
 * }} TestBoard
 */

/**
 * @typedef {{
 *   id: string,
 *   type: string,
 *   content?: string,
 *   createdAt?: number,
 *   expiresAt?: number,
 *   [key: string]: any,
 * }} TestClip
 */

/**
 * @typedef {{
 *   method: string,
 *   url: URL,
 *   body?: any,
 * }} ApiCall
 */

/** @typedef {(call: ApiCall) => Response | null | undefined | Promise<Response | null | undefined>} RequestHandler */

/**
 * @typedef {{
 *   url?: string,
 *   boards?: TestBoard[],
 *   clips?: TestClip[],
 *   handleRequest?: RequestHandler,
 * }} BootOptions
 */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate, message = 'condition', timeout = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

/** @param {BootOptions} [options] */
async function bootApp(options = {}) {
  const {
    url = 'https://wklejka.test/?lang=pl',
    boards = [{ id: 'default', name: 'Schowek', createdAt: Date.now() - 60_000 }],
    clips = [],
    handleRequest,
  } = options;
  const dom = new JSDOM(htmlSource, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const calls = [];

  window.matchMedia = query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  Object.defineProperty(window, 'CSS', {
    configurable: true,
    value: { escape: value => String(value).replace(/["\\]/g, '\\$&') },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = FakeWebSocket.CONNECTING;
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }
  window.WebSocket = /** @type {any} */ (FakeWebSocket);

  window.fetch = async (input, init = {}) => {
    const requestUrl = new URL(String(input), window.location.href);
    const method = String(init.method || 'GET').toUpperCase();
    /** @type {any} */
    let body;
    if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
    const call = { method, url: requestUrl, body };
    calls.push(call);

    const customResponse = await handleRequest?.(call);
    if (customResponse) return customResponse;

    if (method === 'GET' && requestUrl.pathname === '/api/boards') {
      return jsonResponse(boards);
    }
    if (method === 'GET' && /^\/api\/boards\/[^/]+\/clips$/.test(requestUrl.pathname)) {
      return jsonResponse({ items: clips, total: clips.length, nextCursor: null });
    }
    if (method === 'PUT' && /^\/api\/boards\/[^/]+\/clips\/[^/]+$/.test(requestUrl.pathname)) {
      const clipId = decodeURIComponent(requestUrl.pathname.split('/').at(-1));
      const current = clips.find(clip => clip.id === clipId) || { id: clipId, type: 'text', content: '' };
      const updated = { ...current, updatedAt: Date.now() };
      if (body?.expiresIn) updated.expiresAt = Date.now() + body.expiresIn;
      if (body?.expiresAt === null) delete updated.expiresAt;
      return jsonResponse(updated);
    }
    if (method === 'POST' && /^\/api\/boards\/[^/]+\/clips$/.test(requestUrl.pathname)) {
      return jsonResponse({
        id: `created-${calls.length}`,
        type: body?.type,
        content: body?.content,
        createdAt: Date.now(),
      });
    }
    return jsonResponse({ error: `Unexpected request: ${method} ${requestUrl.pathname}` }, 404);
  };

  window.eval(highlightSource);
  window.eval(appSource);
  await waitFor(
    () => window.document.querySelector('#clips')?.getAttribute('aria-busy') === 'false'
      && window.document.querySelector('#result-count')?.textContent !== '',
    'initial board and clip load',
  );

  return {
    calls,
    close: () => dom.window.close(),
    document: window.document,
    window,
  };
}

test('clip expiry requires an explicit new deadline', async (t) => {
  const clip = {
    id: 'expiring',
    type: 'text',
    content: 'Temporary note',
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() + 7 * 86_400_000,
  };
  const app = await bootApp({ clips: [clip] });
  t.after(app.close);

  const expiryButton = /** @type {HTMLButtonElement} */ (
    app.document.querySelector('button[data-action="expiry"]')
  );
  assert.ok(expiryButton);
  expiryButton.click();

  const select = /** @type {HTMLSelectElement} */ (app.document.querySelector('#clip-expiry-value'));
  const save = /** @type {HTMLButtonElement} */ (app.document.querySelector('#clip-expiry-save'));
  assert.ok(select);
  assert.ok(save);
  assert.equal(select.value, 'unchanged');
  assert.equal(save.disabled, true);
  assert.equal(app.calls.filter(call => call.method === 'PUT').length, 0);

  select.value = '86400000';
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(save.disabled, false);
  save.click();

  await waitFor(
    () => app.calls.some(call => call.method === 'PUT'),
    'expiry update request',
  );
  const update = app.calls.find(call => call.method === 'PUT');
  assert.deepEqual(update.body, { expiresIn: 86_400_000 });
});

test('repeated keyboard submission creates one in-flight clip per board', async (t) => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    await t.test(modifier === 'ctrlKey' ? 'Ctrl+Enter' : 'Cmd+Enter', async (t) => {
      const releasePost = createDeferred();
      const app = await bootApp({
        async handleRequest(call) {
          if (call.method !== 'POST' || call.url.pathname !== '/api/boards/default/clips') return null;
          await releasePost.promise;
          return jsonResponse({
            id: `created-with-${modifier}`,
            type: 'text',
            content: call.body.content,
            createdAt: Date.now(),
          });
        },
      });
      t.after(app.close);

      const input = /** @type {HTMLTextAreaElement} */ (app.document.querySelector('#text-input'));
      assert.ok(input);
      input.value = 'Send once';
      input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
      const eventInit = { key: 'Enter', bubbles: true, cancelable: true, [modifier]: true };
      input.dispatchEvent(new app.window.KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new app.window.KeyboardEvent('keydown', eventInit));

      await waitFor(
        () => app.calls.some(call => call.method === 'POST'),
        'clip creation request',
      );
      assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);

      releasePost.resolve();
      await waitFor(() => input.value === '', 'successful submission');
      assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
    });
  }
});

test('a failed filtered request remains an inline error until retry succeeds', async (t) => {
  let filteredRequests = 0;
  const clip = {
    id: 'existing',
    type: 'text',
    content: 'Existing entry',
    createdAt: Date.now() - 60_000,
  };
  const app = await bootApp({
    clips: [clip],
    handleRequest(call) {
      if (call.method !== 'GET' || call.url.searchParams.get('q') !== 'missing') return null;
      filteredRequests++;
      if (filteredRequests === 1) return jsonResponse({ error: 'Nie udało się wyszukać' }, 503);
      return jsonResponse({ items: [], total: 0, nextCursor: null });
    },
  });
  t.after(app.close);

  const search = /** @type {HTMLInputElement} */ (app.document.querySelector('#search-input'));
  assert.ok(search);
  search.value = 'missing';
  search.dispatchEvent(new app.window.Event('input', { bubbles: true }));

  await waitFor(() => app.document.querySelector('.error-state'), 'inline filter error');
  const error = app.document.querySelector('.error-state');
  assert.match(error.textContent, /Nie udało się wyszukać/);
  assert.doesNotMatch(app.document.querySelector('#clips').textContent, /Brak wyników/);
  assert.equal(app.document.querySelector('#result-count').textContent, '');

  const retry = /** @type {HTMLButtonElement} */ (error.querySelector('button'));
  assert.ok(retry);
  retry.click();
  await waitFor(
    () => filteredRequests === 2
      && app.document.querySelector('#clips')?.getAttribute('aria-busy') === 'false'
      && /Brak wyników/.test(app.document.querySelector('#clips')?.textContent || ''),
    'successful filter retry',
  );
  assert.match(app.document.querySelector('#clips').textContent, /Brak wyników/);
  assert.equal(app.document.querySelector('#result-count').textContent, '0 z 0');
});

test('an unavailable clip target is reported and removed from the URL', async (t) => {
  const scenarios = [
    { name: 'missing clip in an existing board', hash: '#clip=default:missing' },
    { name: 'missing board', hash: '#clip=missing-board:missing' },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const app = await bootApp({
        url: `https://wklejka.test/?lang=pl${scenario.hash}`,
      });
      t.after(app.close);

      await waitFor(
        () => app.document.querySelector('.toast')?.textContent === 'Wpis wygasł lub został usunięty.',
        'unavailable clip feedback',
      );
      assert.equal(app.window.location.hash, '');
      assert.equal(app.window.location.search, '?lang=pl');
      assert.equal(app.document.querySelector('#board-heading').textContent, 'Schowek');
    });
  }
});

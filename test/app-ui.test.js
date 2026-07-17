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
 *   online?: boolean,
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
    online = true,
  } = options;
  const dom = new JSDOM(htmlSource, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url,
  });
  const { window } = dom;
  const calls = [];
  const scrollTargets = [];

  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online,
  });

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
  window.HTMLElement.prototype.scrollIntoView = function (options) {
    scrollTargets.push({ element: this, options });
  };

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
    if (method === 'POST' && requestUrl.pathname === '/api/boards') {
      return jsonResponse({
        id: `board-${calls.length}`,
        name: body?.name,
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
    scrollTargets,
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
  const expiryMenu = /** @type {HTMLDetailsElement} */ (expiryButton.closest('.clip-more'));
  assert.ok(expiryMenu);
  expiryMenu.open = true;
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
  await waitFor(
    () => !app.document.querySelector('#clip-expiry-modal')?.hasAttribute('open'),
    'expiry dialog close',
  );
  await new Promise(resolve => app.window.requestAnimationFrame(() => resolve()));
  assert.match(app.document.activeElement?.outerHTML || '', /clip-more-trigger/);
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
      const send = /** @type {HTMLButtonElement} */ (app.document.querySelector('#send-btn'));
      assert.ok(send);
      assert.equal(send.disabled, false);
      const eventInit = { key: 'Enter', bubbles: true, cancelable: true, [modifier]: true };
      input.dispatchEvent(new app.window.KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new app.window.KeyboardEvent('keydown', eventInit));

      await waitFor(
        () => app.calls.some(call => call.method === 'POST'),
        'clip creation request',
      );
      assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(send.disabled, true);

      releasePost.resolve();
      await waitFor(() => input.value === '', 'successful submission');
      assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal(send.disabled, true);
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

test('board management stays outside the tablist and follows the active board', async (t) => {
  const customBoard = {
    id: 'project',
    name: 'Projekt',
    createdAt: Date.now() - 30_000,
  };
  const app = await bootApp({
    boards: [
      { id: 'default', name: 'Schowek', createdAt: Date.now() - 60_000 },
      customBoard,
    ],
  });
  t.after(app.close);

  const tablist = app.document.querySelector('#tabs');
  const manageButton = /** @type {HTMLButtonElement} */ (
    app.document.querySelector('#manage-board-btn')
  );
  assert.ok(tablist);
  assert.ok(manageButton);
  assert.equal(tablist.contains(manageButton), false);
  assert.equal(tablist.querySelector('button:not([role="tab"])'), null);
  assert.equal(tablist.querySelector('[aria-haspopup]'), null);
  assert.equal(manageButton.hidden, true);

  const customTab = /** @type {HTMLButtonElement} */ (
    tablist.querySelector(`[role="tab"][data-board-id="${customBoard.id}"]`)
  );
  assert.ok(customTab);
  customTab.click();

  await waitFor(
    () => app.document.querySelector('#board-heading')?.textContent === customBoard.name
      && app.document.querySelector('#clips')?.getAttribute('aria-busy') === 'false'
      && app.calls.some(call => call.method === 'GET'
        && call.url.pathname === `/api/boards/${customBoard.id}/clips`)
      && app.scrollTargets.some(target => target.element.id === 'main-content'),
    'custom board load',
  );

  assert.equal(manageButton.hidden, false);
  assert.equal(manageButton.getAttribute('aria-label'), 'Zarządzaj kartą Projekt');
});

test('theme toggle accessible name includes its visible state', async (t) => {
  const app = await bootApp();
  t.after(app.close);

  const toggle = /** @type {HTMLButtonElement} */ (app.document.querySelector('#theme-toggle'));
  assert.ok(toggle);
  for (let index = 0; index < 3; index++) {
    const visibleState = toggle.textContent.trim();
    assert.ok(visibleState);
    assert.match(toggle.getAttribute('aria-label') || '', new RegExp(`${visibleState}$`));
    toggle.click();
  }
});

test('storage dialog focuses its title while the status request is pending', async (t) => {
  const releaseStatus = createDeferred();
  const app = await bootApp({
    async handleRequest(call) {
      if (call.method !== 'GET' || call.url.pathname !== '/api/status') return null;
      await releaseStatus.promise;
      return jsonResponse({
        boards: 1,
        clips: 0,
        websocketClients: 0,
        storage: { usedBytes: 0, activeUploadBytes: 0, maxBytes: 1024 },
        limits: { maxClipsPerBoard: 100, maxTotalClips: 1000, maxBulkDelete: 100 },
      });
    },
  });
  t.after(app.close);

  const storageButton = /** @type {HTMLButtonElement} */ (app.document.querySelector('#storage-btn'));
  const storageTitle = /** @type {HTMLElement} */ (app.document.querySelector('#storage-title'));
  const refreshButton = /** @type {HTMLButtonElement} */ (
    app.document.querySelector('#storage-refresh')
  );
  assert.ok(storageButton);
  assert.ok(storageTitle);
  assert.ok(refreshButton);
  storageButton.click();

  await waitFor(
    () => app.calls.some(call => call.method === 'GET' && call.url.pathname === '/api/status'),
    'pending storage status request',
  );
  await waitFor(() => app.document.activeElement === storageTitle, 'storage title focus');
  assert.equal(refreshButton.disabled, true);

  releaseStatus.resolve();
  await waitFor(() => refreshButton.disabled === false, 'completed storage status request');
});

test('unlock input has a static label and prompt description', async (t) => {
  const app = await bootApp();
  t.after(app.close);

  const input = /** @type {HTMLInputElement} */ (app.document.querySelector('#unlock-input'));
  const label = app.document.querySelector('label[for="unlock-input"]');
  const labelText = app.document.querySelector('#unlock-name-label');
  assert.ok(input);
  assert.ok(label);
  assert.ok(labelText);
  assert.equal(label.contains(input), true);
  assert.equal(label.contains(labelText), true);
  assert.equal(labelText.classList.contains('visually-hidden'), true);
  assert.equal(labelText.textContent, 'Nazwa');
  assert.equal(input.getAttribute('aria-describedby'), 'unlock-prompt');
  assert.equal(input.labels?.length, 1);
  assert.equal(input.labels?.[0], label);
});

test('each clip type exposes one primary action in its header', async (t) => {
  const app = await bootApp({
    clips: [
      { id: 'text', type: 'text', content: 'Text', createdAt: Date.now() - 3_000 },
      {
        id: 'image',
        type: 'image',
        imageUrl: '/images/example.png',
        createdAt: Date.now() - 2_000,
      },
      {
        id: 'file',
        type: 'file',
        originalName: 'example.pdf',
        fileUrl: '/files/example.pdf',
        createdAt: Date.now() - 1_000,
      },
    ],
  });
  t.after(app.close);

  const expected = new Map([
    ['text', 'Kopiuj'],
    ['image', 'Kopiuj'],
    ['file', 'Pobierz'],
  ]);
  for (const [id, label] of expected) {
    const clip = app.document.querySelector(`.clip[data-id="${id}"]`);
    assert.ok(clip);
    const primaryActions = clip.querySelectorAll('.clip-header .clip-primary-action');
    assert.equal(primaryActions.length, 1);
    assert.equal(primaryActions[0].textContent, label);
  }

  const fileClip = app.document.querySelector('.clip[data-id="file"]');
  assert.equal(fileClip.querySelector('.clip-more-actions')?.textContent.includes('Pobierz'), false);
  const imageClip = app.document.querySelector('.clip[data-id="image"]');
  assert.equal(imageClip.querySelector('.clip-more-actions')?.textContent.includes('Pobierz'), true);
});

test('secondary clip actions are grouped by type and board lock state', async (t) => {
  const clips = [
    { id: 'text', type: 'text', content: 'Text', createdAt: Date.now() - 3_000 },
    {
      id: 'image',
      type: 'image',
      imageUrl: '/images/example.png',
      createdAt: Date.now() - 2_000,
    },
    {
      id: 'file',
      type: 'file',
      originalName: 'example.pdf',
      fileUrl: '/files/example.pdf',
      createdAt: Date.now() - 1_000,
    },
  ];
  const scenarios = [
    {
      name: 'unlocked',
      board: { id: 'default', name: 'Schowek', createdAt: Date.now() },
      expected: {
        text: ['Edytuj', 'Udostępnij', 'Przypnij', 'Wygasanie', 'Usuń'],
        image: ['Pobierz', 'Udostępnij', 'Przypnij', 'Wygasanie', 'Usuń'],
        file: ['Udostępnij', 'Przypnij', 'Wygasanie', 'Usuń'],
      },
    },
    {
      name: 'locked',
      board: { id: 'default', name: 'Schowek', createdAt: Date.now(), locked: true },
      expected: {
        text: ['Udostępnij'],
        image: ['Pobierz', 'Udostępnij'],
        file: ['Udostępnij'],
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const app = await bootApp({ boards: [scenario.board], clips });
      t.after(app.close);
      for (const [id, labels] of Object.entries(scenario.expected)) {
        const clip = app.document.querySelector(`.clip[data-id="${id}"]`);
        assert.ok(clip);
        assert.equal(clip.querySelectorAll(':scope > article > .clip-actions').length, 0);
        const buttons = [...clip.querySelectorAll('.clip-more-actions > button')];
        assert.deepEqual(buttons.map(button => button.textContent), labels);
      }
    });
  }
});

test('clip action disclosures keep only one menu open and support Escape', async (t) => {
  const app = await bootApp({
    clips: [
      { id: 'first', type: 'text', content: 'First', createdAt: Date.now() - 2_000 },
      { id: 'second', type: 'text', content: 'Second', createdAt: Date.now() - 1_000 },
    ],
  });
  t.after(app.close);

  const menus = /** @type {HTMLDetailsElement[]} */ (
    [...app.document.querySelectorAll('.clip-more')]
  );
  const triggers = menus.map(menu => /** @type {HTMLElement} */ (
    menu.querySelector('.clip-more-trigger')
  ));
  assert.equal(menus.length, 2);

  triggers[0].click();
  await waitFor(() => menus[0].open, 'first action menu');
  triggers[1].click();
  await waitFor(() => menus[1].open && !menus[0].open, 'second action menu');

  triggers[1].focus();
  triggers[1].dispatchEvent(new app.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(menus[1].open, false);
  assert.equal(app.document.activeElement, triggers[1]);

  triggers[0].click();
  await waitFor(() => menus[0].open, 'reopened first action menu');
  const heading = /** @type {HTMLElement} */ (app.document.querySelector('#board-heading'));
  assert.ok(heading);
  heading.click();
  assert.equal(menus[0].open, false);
});

test('pinning restores focus after the reconciled clip render', async (t) => {
  const app = await bootApp({
    clips: [{ id: 'pinnable', type: 'text', content: 'Pin me', createdAt: Date.now() - 1_000 }],
  });
  t.after(app.close);

  const menu = /** @type {HTMLDetailsElement} */ (app.document.querySelector('.clip-more'));
  assert.ok(menu);
  menu.open = true;
  const pin = /** @type {HTMLButtonElement} */ (
    [...menu.querySelectorAll('button')].find(button => button.textContent === 'Przypnij')
  );
  assert.ok(pin);
  pin.focus();
  pin.click();

  await waitFor(
    () => app.calls.filter(call => call.method === 'GET'
      && call.url.pathname === '/api/boards/default/clips').length >= 2
      && app.document.activeElement?.matches('.clip-more-trigger'),
    'pin reconciliation and focus restoration',
  );
});

test('composer enables submission only for valid, idle text', async (t) => {
  let failNextPost = true;
  const app = await bootApp({
    handleRequest(call) {
      if (call.method !== 'POST' || call.url.pathname !== '/api/boards/default/clips') return null;
      if (failNextPost) {
        failNextPost = false;
        return jsonResponse({ error: 'Temporary failure' }, 503);
      }
      return jsonResponse({
        id: 'created-after-retry',
        type: 'text',
        content: call.body.content,
        createdAt: Date.now(),
      });
    },
  });
  t.after(app.close);

  const input = /** @type {HTMLTextAreaElement} */ (app.document.querySelector('#text-input'));
  const send = /** @type {HTMLButtonElement} */ (app.document.querySelector('#send-btn'));
  assert.ok(input);
  assert.ok(send);
  assert.equal(send.disabled, true);

  input.value = '   ';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(send.disabled, true);

  input.value = 'Keep this draft';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(send.disabled, false);
  send.click();
  await waitFor(() => app.calls.filter(call => call.method === 'POST').length === 1
    && send.disabled === false, 'failed submission state');
  assert.equal(input.value, 'Keep this draft');

  send.click();
  await waitFor(() => input.value === '' && send.disabled, 'successful retry state');
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 2);
});

test('new board creation requires a non-empty name', async (t) => {
  const app = await bootApp();
  t.after(app.close);

  const open = /** @type {HTMLButtonElement} */ (app.document.querySelector('#add-board-btn'));
  const name = /** @type {HTMLInputElement} */ (app.document.querySelector('#modal-name'));
  const create = /** @type {HTMLButtonElement} */ (app.document.querySelector('#modal-create'));
  assert.ok(open);
  assert.ok(name);
  assert.ok(create);
  assert.equal(name.required, true);

  open.click();
  assert.equal(create.disabled, true);
  name.value = '   ';
  name.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(create.disabled, true);
  name.value = 'Projekt';
  name.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(create.disabled, false);
});

test('new board creation keeps failures in the dialog and activates a successful retry', async (t) => {
  let failNextCreation = true;
  const app = await bootApp({
    handleRequest(call) {
      if (call.method !== 'POST' || call.url.pathname !== '/api/boards') return null;
      if (failNextCreation) {
        failNextCreation = false;
        return jsonResponse({ error: 'Temporary board failure' }, 503);
      }
      return jsonResponse({
        id: 'project-board',
        name: call.body.name,
        createdAt: Date.now(),
      });
    },
  });
  t.after(app.close);

  const open = /** @type {HTMLButtonElement} */ (app.document.querySelector('#add-board-btn'));
  const dialog = /** @type {HTMLDialogElement} */ (app.document.querySelector('#new-board-modal'));
  const name = /** @type {HTMLInputElement} */ (app.document.querySelector('#modal-name'));
  const create = /** @type {HTMLButtonElement} */ (app.document.querySelector('#modal-create'));
  assert.ok(open);
  assert.ok(dialog);
  assert.ok(name);
  assert.ok(create);

  open.click();
  name.value = 'Projekt';
  name.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  create.click();
  await waitFor(
    () => app.calls.filter(call => call.method === 'POST' && call.url.pathname === '/api/boards').length === 1
      && create.disabled === false,
    'failed board creation',
  );
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(
    app.document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-board-id'),
    'default',
  );

  create.click();
  await waitFor(
    () => !dialog.hasAttribute('open')
      && app.document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-board-id') === 'project-board'
      && app.document.querySelector('#board-heading')?.textContent === 'Projekt'
      && app.document.querySelector('#clips')?.getAttribute('aria-busy') === 'false'
      && app.document.activeElement === app.document.querySelector('#text-input'),
    'successful board activation',
  );
  assert.ok(app.calls.some(call => call.method === 'GET'
    && call.url.pathname === '/api/boards/project-board/clips'));
});

test('offline mode keeps the draft editable and pauses network actions', async (t) => {
  const app = await bootApp({ online: false });
  t.after(app.close);

  const input = /** @type {HTMLTextAreaElement} */ (app.document.querySelector('#text-input'));
  const send = /** @type {HTMLButtonElement} */ (app.document.querySelector('#send-btn'));
  const file = /** @type {HTMLButtonElement} */ (app.document.querySelector('#file-btn'));
  const hint = /** @type {HTMLElement} */ (app.document.querySelector('#composer-hint'));
  assert.ok(input);
  assert.ok(send);
  assert.ok(file);
  assert.ok(hint);

  input.value = 'Offline draft';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(input.readOnly, false);
  assert.equal(send.disabled, true);
  assert.equal(file.disabled, true);
  assert.equal(hint.dataset.mode, 'offline');
  assert.match(hint.textContent, /Szkic zapisany lokalnie/);
  send.click();
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(app.window.localStorage.getItem('wklejka-drafts-v1'), '{"default":"Offline draft"}');
});

test('mobile utility menu exposes its state and closes with Escape', async (t) => {
  const app = await bootApp();
  t.after(app.close);

  const toggle = /** @type {HTMLButtonElement} */ (app.document.querySelector('#header-menu-toggle'));
  const tools = /** @type {HTMLElement} */ (app.document.querySelector('#header-tools'));
  assert.ok(toggle);
  assert.ok(tools);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(tools.classList.contains('is-open'), true);

  toggle.dispatchEvent(new app.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(tools.classList.contains('is-open'), false);
  assert.equal(app.document.activeElement, toggle);
});

test('empty and selection states avoid stale copy and duplicate exit actions', async (t) => {
  const app = await bootApp();
  t.after(app.close);

  assert.match(app.document.querySelector('#clips')?.textContent || '', /tekst, obraz lub plik/);
  assert.equal(app.document.querySelector('#selection-cancel'), null);
  const selectionToggle = /** @type {HTMLButtonElement} */ (
    app.document.querySelector('#selection-toggle')
  );
  assert.ok(selectionToggle);
  assert.equal(selectionToggle.disabled, true);
});

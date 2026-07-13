/* Wklejka - frontend */

const $ = (s) => document.querySelector(s);
const highlight = window.WklejkaHighlight || {
  highlightedTextWithLinks(text) {
    return { html: escapeHtml(text), asCode: false };
  },
};

// --- i18n ---

const i18n = {
  pl: {
    defaultBoard: 'Schowek',
    subtitle: 'schowek w sieci',
    placeholder: 'Wpisz lub wklej tekst tutaj...',
    hint: 'Ctrl+Enter = wy\u015blij \u00a0|\u00a0 Ctrl+V = wklej obrazek',
    send: 'Wy\u015blij',
    dropHere: 'Upu\u015b\u0107 obrazek tutaj',
    newTab: '+ Nowa karta',
    deleteTab: 'Usu\u0144 kart\u0119',
    confirmDelete: 'Usun\u0105\u0107 t\u0119 kart\u0119 i wszystkie jej wpisy?',
    tabNamePrompt: 'Nazwa nowej karty:',
    empty: 'Brak wpis\u00f3w. Wklej tekst lub obrazek powy\u017cej.',
    image: 'Obrazek',
    text: 'Tekst',
    copy: 'Kopiuj',
    download: 'Pobierz',
    delete: 'Usu\u0144',
    copied: 'Skopiowano!',
    copyFailed: 'Nie uda\u0142o si\u0119 skopiowa\u0107',
    sendError: 'B\u0142\u0105d wysy\u0142ania: {message}',
    deleteError: 'B\u0142\u0105d usuwania',
    justNow: 'przed chwil\u0105',
    minutesAgo: '{count} min temu',
    hoursAgo: '{count} godz. temu',
    daysAgo: '{count} dn. temu',
    connected: 'Po\u0142\u0105czono',
    reconnecting: 'Roz\u0142\u0105czono \u2013 ponawiam...',
    file: 'Plik',
    attachFile: 'Za\u0142\u0105cz plik',
    uploading: 'Przesy\u0142anie...',
    uploadFailed: 'Przesy\u0142anie nie powiod\u0142o si\u0119',
    retry: 'Pon\u00f3w',
    payloadTooLarge: 'Plik jest za du\u017cy',
    payloadTooLargeWithLimit: 'Plik jest za du\u017cy (maks. {maxSize})',
    pastedImage: 'Wklejony obrazek',
    dropHereFiles: 'Upu\u015b\u0107 pliki tutaj',
    newTabTitle: 'Nowa karta',
    boardNameLabel: 'Nazwa',
    expiresLabel: 'Wygasa po',
    expiresNever: 'Nigdy',
    expires1h: '1 godzinie',
    expires24h: '24 godzinach',
    expires7d: '7 dniach',
    expires30d: '30 dniach',
    create: 'Utw\u00f3rz',
    cancel: 'Anuluj',
    expiresIn: 'Wygasa {time}',
    notificationNewClip: 'Nowy wpis w {boardName}',
    showMore: 'Rozwiń',
    showLess: 'Zwiń',
    sure: 'Na pewno?',
    lock: 'Zablokuj',
    unlock: 'Odblokuj',
    unlockTitle: 'Odblokuj kart\u0119',
    unlockPrompt: 'Wpisz "{name}" aby odblokowa\u0107:',
    boardLocked: 'Karta jest zablokowana',
    themeAuto: 'Auto',
    themeDark: 'Ciemny',
    themeLight: 'Jasny',
    themeToggleLabel: 'Zmie\u0144 motyw',
    expiryMinutes: '{count} min',
    expiryHours: '{count} godz.',
    expiryDays: '{count} dn.',
    searchPlaceholder: 'Szukaj wpisów',
    noSearchResults: 'Brak wyników.',
    edit: 'Edytuj',
    save: 'Zapisz',
    link: 'Link',
    linkCopied: 'Skopiowano link',
    editError: 'Błąd edycji',
    loading: 'Ładowanie…',
    loadingClips: 'Ładowanie wpisów…',
    offline: 'Brak połączenia z siecią',
    syncError: 'Błąd synchronizacji',
    realtimeReconnecting: 'Dane dostępne · łączenie realtime…',
    retry: 'Ponów',
    secureWarning: 'Połączenie nie jest szyfrowane. Kopiowanie, powiadomienia i instalacja aplikacji mogą być niedostępne. Otwórz Wklejkę przez HTTPS.',
    notificationsEnable: 'Włącz powiadomienia',
    notificationsOn: 'Powiadomienia włączone',
    notificationsBlocked: 'Powiadomienia zablokowane',
    typeFilter: 'Typ',
    typeAll: 'Wszystkie',
    typeImages: 'Obrazki',
    typeFiles: 'Pliki',
    results: '{visible} z {total}',
    boardMenu: 'Zarządzaj kartą {name}',
    manageBoard: 'Zarządzaj kartą: {name}',
    saveName: 'Zapisz nazwę',
    close: 'Zamknij',
    moveLeft: 'W lewo',
    moveRight: 'W prawo',
    moveGroup: 'Zmień pozycję karty',
    lockedBadge: 'Chroniona przed zmianami',
    previewLoad: 'Pokaż podgląd linku',
    previewPrivacy: 'Podgląd pobierze dane wskazanej strony',
    previewFailed: 'Nie udało się pobrać podglądu',
    openImage: 'Otwórz obraz w nowej karcie',
    loadPreview: 'Wczytaj podgląd pliku',
    newClipAnnounce: 'Nowy wpis w karcie {boardName}',
    copyFallback: 'Skopiuj tekst z pola poniżej:',
    boardUpdateError: 'Nie udało się zmienić karty',
    boardDeleteError: 'Nie udało się usunąć karty',
    addClip: 'Dodaj wpis',
    clipsLabel: 'Wpisy',
  },
  en: {
    defaultBoard: 'Clipboard',
    subtitle: 'shared clipboard',
    placeholder: 'Type or paste text here...',
    hint: 'Ctrl+Enter = send \u00a0|\u00a0 Ctrl+V = paste image',
    send: 'Send',
    dropHere: 'Drop image here',
    newTab: '+ New tab',
    deleteTab: 'Delete tab',
    confirmDelete: 'Delete this tab and all its entries?',
    tabNamePrompt: 'New tab name:',
    empty: 'No entries. Paste text or image above.',
    image: 'Image',
    text: 'Text',
    copy: 'Copy',
    download: 'Download',
    delete: 'Delete',
    copied: 'Copied!',
    copyFailed: 'Failed to copy',
    sendError: 'Send error: {message}',
    deleteError: 'Delete error',
    justNow: 'just now',
    minutesAgo: '{count} min ago',
    hoursAgo: '{count} hrs ago',
    daysAgo: '{count} days ago',
    connected: 'Connected',
    reconnecting: 'Disconnected \u2013 reconnecting...',
    file: 'File',
    attachFile: 'Attach file',
    uploading: 'Uploading...',
    uploadFailed: 'Upload failed',
    retry: 'Retry',
    payloadTooLarge: 'File is too large',
    payloadTooLargeWithLimit: 'File is too large (max {maxSize})',
    pastedImage: 'Pasted image',
    dropHereFiles: 'Drop files here',
    newTabTitle: 'New tab',
    boardNameLabel: 'Name',
    expiresLabel: 'Expires after',
    expiresNever: 'Never',
    expires1h: '1 hour',
    expires24h: '24 hours',
    expires7d: '7 days',
    expires30d: '30 days',
    create: 'Create',
    cancel: 'Cancel',
    expiresIn: 'Expires {time}',
    notificationNewClip: 'New clip in {boardName}',
    showMore: 'Show more',
    showLess: 'Show less',
    sure: 'Sure?',
    lock: 'Lock',
    unlock: 'Unlock',
    unlockTitle: 'Unlock tab',
    unlockPrompt: 'Type "{name}" to unlock:',
    boardLocked: 'Board is locked',
    themeAuto: 'Auto',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeToggleLabel: 'Toggle theme',
    expiryMinutes: '{count} min',
    expiryHours: '{count}h',
    expiryDays: '{count}d',
    searchPlaceholder: 'Search clips',
    noSearchResults: 'No matches.',
    edit: 'Edit',
    save: 'Save',
    link: 'Link',
    linkCopied: 'Link copied',
    editError: 'Edit failed',
    loading: 'Loading…',
    loadingClips: 'Loading clips…',
    offline: 'No network connection',
    syncError: 'Sync failed',
    realtimeReconnecting: 'Data available · reconnecting realtime…',
    retry: 'Retry',
    secureWarning: 'This connection is not encrypted. Copying, notifications, and app installation may be unavailable. Open Wklejka over HTTPS.',
    notificationsEnable: 'Enable notifications',
    notificationsOn: 'Notifications enabled',
    notificationsBlocked: 'Notifications blocked',
    typeFilter: 'Type',
    typeAll: 'All',
    typeImages: 'Images',
    typeFiles: 'Files',
    results: '{visible} of {total}',
    boardMenu: 'Manage tab {name}',
    manageBoard: 'Manage tab: {name}',
    saveName: 'Save name',
    close: 'Close',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    moveGroup: 'Change tab position',
    lockedBadge: 'Protected from changes',
    previewLoad: 'Show link preview',
    previewPrivacy: 'Preview will fetch data from the linked website',
    previewFailed: 'Could not load preview',
    openImage: 'Open image in a new tab',
    loadPreview: 'Load file preview',
    newClipAnnounce: 'New clip in tab {boardName}',
    copyFallback: 'Copy the text from the field below:',
    boardUpdateError: 'Could not update tab',
    boardDeleteError: 'Could not delete tab',
    addClip: 'Add clip',
    clipsLabel: 'Clips',
  }
};

const supportedLanguages = Object.keys(i18n);
const lang = detectLanguage();
document.documentElement.lang = lang;

function detectLanguage() {
  const requestedLanguage = normalizeLanguage(new URLSearchParams(location.search).get('lang'));
  if (requestedLanguage) return requestedLanguage;

  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const browserLanguage of browserLanguages) {
    const normalizedLanguage = normalizeLanguage(browserLanguage);
    if (normalizedLanguage) return normalizedLanguage;
  }

  return 'en';
}

function normalizeLanguage(value) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const base = normalized.split('-')[0];
  if (supportedLanguages.includes(normalized)) return normalized;
  if (supportedLanguages.includes(base)) return base;
  return null;
}

function t(key, params = {}) {
  const template = (i18n[lang] || i18n.en)[key] || key;
  return Object.entries(params).reduce((text, [name, value]) => {
    return text.replaceAll(`{${name}}`, value == null ? '' : String(value));
  }, template);
}

function updateStaticTexts() {
  $('.subtitle').textContent = t('subtitle');
  $('#text-input').placeholder = t('placeholder');
  $('.hint').textContent = t('hint');
  $('#send-btn').textContent = t('send');
  $('.drop-overlay-content p').textContent = t('dropHereFiles');
  $('#file-btn').textContent = t('attachFile');
  $('#search-input').placeholder = t('searchPlaceholder');
  // Modal texts
  $('#modal-title').textContent = t('newTabTitle');
  $('#modal-name-label').textContent = t('boardNameLabel');
  $('#modal-expires-label').textContent = t('expiresLabel');
  $('#modal-cancel').textContent = t('cancel');
  $('#modal-create').textContent = t('create');
  const sel = $('#modal-expires');
  sel.options[0].textContent = t('expiresNever');
  sel.options[1].textContent = t('expires1h');
  sel.options[2].textContent = t('expires24h');
  sel.options[3].textContent = t('expires7d');
  sel.options[4].textContent = t('expires30d');
}

// --- Dark mode ---

let themeMode = localStorage.getItem('wklejka-theme') || 'auto';

function applyTheme() {
  if (themeMode === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
  } else {
    document.documentElement.dataset.theme = themeMode;
  }
  updateThemeToggle();
  // Update theme-color meta for standalone PWA status bar
  const isDark = document.documentElement.dataset.theme === 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', isDark ? '#1e293b' : '#ffffff');
  });
}

function initTheme() {
  applyTheme();
}

function toggleTheme() {
  const order = ['auto', 'dark', 'light'];
  themeMode = order[(order.indexOf(themeMode) + 1) % 3];
  if (themeMode === 'auto') {
    localStorage.removeItem('wklejka-theme');
  } else {
    localStorage.setItem('wklejka-theme', themeMode);
  }
  applyTheme();
}

function updateThemeToggle() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const labels = { auto: t('themeAuto'), dark: t('themeDark'), light: t('themeLight') };
  btn.textContent = labels[themeMode];
  btn.setAttribute('aria-label', t('themeToggleLabel'));
}

// --- State ---

let boards = [];
let currentBoardId = 'default';
let clips = [];
let ws;
let wsOpenedOnce = false;
let syncPromise = null;
let syncQueued = false;
let lastSyncAt = 0;
let clipStateVersion = 0;
let loadClipsRequestId = 0;
const unreadCounts = {};
let hiddenClipCount = 0;
let isDraggingTab = false;
let renderedClipIds = new Set();
let renderedBoardIds = new Set();
const linkPreviewCache = new Map();
let searchQuery = '';
let focusedClipHash = '';
const DRAFTS_STORAGE_KEY = 'wklejka-drafts-v1';
const uploadTasks = new Map();
let filePickerBoardId = null;

function readDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

let drafts = readDrafts();

function draftFor(boardId) {
  return typeof drafts[boardId] === 'string' ? drafts[boardId] : '';
}

function saveDraft(boardId, value) {
  if (!boardId) return;
  if (value) drafts[boardId] = value;
  else delete drafts[boardId];
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // A draft remaining in memory is still preferable to clearing the editor.
  }
}

function restoreDraft(boardId) {
  const textarea = $('#text-input');
  textarea.value = draftFor(boardId);
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
}

function selectBoard(boardId, { clearHash = true } = {}) {
  if (!boardId || boardId === currentBoardId) return false;
  saveDraft(currentBoardId, $('#text-input').value);
  currentBoardId = boardId;
  restoreDraft(boardId);
  renderUploads();
  if (clearHash && location.hash.startsWith('#clip=')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  unreadCounts[boardId] = 0;
  updateTitle();
  renderTabs();
  loadClips(boardId);
  return true;
}

// --- API helpers ---

function normalizeApiErrorMessage(status, statusText, message) {
  let nextMessage = message || '';
  if (status === 413) {
    const maxSize = nextMessage.match(/\(max ([^)]+)\)/i)?.[1];
    nextMessage = maxSize ? t('payloadTooLargeWithLimit', { maxSize }) : t('payloadTooLarge');
  }
  return nextMessage || statusText || `HTTP ${status}`;
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    let message = '';
    const contentType = res.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const data = await res.json();
        message = data.error || data.message || '';
      } else {
        message = (await res.text()).trim();
      }
    } catch {}
    throw new Error(normalizeApiErrorMessage(res.status, res.statusText, message));
  }
  return res.json();
}

function uploadRequest(task, onProgress) {
  let xhr;
  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/boards/' + encodeURIComponent(task.boardId) + '/uploads');
    xhr.setRequestHeader('Content-Type', task.blob.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Clip-Type', task.type);
    if (task.originalName) {
      xhr.setRequestHeader('X-Original-Name', encodeURIComponent(task.originalName));
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      let parsed = null;
      if (contentType.includes('application/json') && xhr.responseText) {
        try { parsed = JSON.parse(xhr.responseText); } catch {}
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed);
        return;
      }
      const message = parsed?.error || parsed?.message || xhr.responseText.trim();
      reject(new Error(normalizeApiErrorMessage(xhr.status, xhr.statusText, message)));
    };
    xhr.onerror = () => reject(new Error(lang === 'pl' ? 'Błąd sieci' : 'Network error'));
    xhr.onabort = () => reject(Object.assign(new Error(lang === 'pl' ? 'Anulowano' : 'Cancelled'), { aborted: true }));
    xhr.send(task.blob);
  });
  return { promise, abort: () => xhr?.abort() };
}

function stripTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  if (!params.has('token')) return;
  params.delete('token');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
}

// --- Data operations ---

async function loadBoards() {
  boards = await api('GET', '/boards');
  const boardIds = new Set(boards.map(b => b.id));
  Object.keys(unreadCounts).forEach((id) => {
    if (!boardIds.has(id)) delete unreadCounts[id];
  });
  const target = clipTargetFromHash();
  if (target && boardIds.has(target.boardId)) {
    currentBoardId = target.boardId;
  }
  if (boards.length && !boards.some(b => b.id === currentBoardId)) {
    currentBoardId = boards[0].id;
  }
  renderedBoardIds = new Set(boards.map(b => b.id));
  renderTabs();
  restoreDraft(currentBoardId);
  renderUploads();
}

async function loadClips(boardId = currentBoardId) {
  const requestId = ++loadClipsRequestId;
  const version = clipStateVersion;
  const nextClips = await api('GET', '/boards/' + boardId + '/clips');
  if (requestId !== loadClipsRequestId || boardId !== currentBoardId) return;
  if (version !== clipStateVersion) return loadClips(boardId);
  clips = nextClips;
  renderedClipIds.clear();
  renderClips();
  focusClipFromHash();
}

async function syncFromServer() {
  if (syncPromise) {
    syncQueued = true;
    return syncPromise;
  }

  syncPromise = (async () => {
    do {
      syncQueued = false;
      await loadBoards();
      await loadClips();
      lastSyncAt = Date.now();
    } while (syncQueued);
  })()
    .catch((error) => {
      console.warn('Sync failed:', error);
    })
    .finally(() => {
      syncPromise = null;
    });

  return syncPromise;
}

function syncAfterResume() {
  if (Date.now() - lastSyncAt < 1000) return;
  syncFromServer();
}

async function sendClip(boardId, type, content, originalName) {
  try {
    const body = { type, content };
    if (originalName) body.originalName = originalName;
    const clip = await api('POST', '/boards/' + encodeURIComponent(boardId) + '/clips', body);
    if (boardId === currentBoardId && !clips.find(c => c.id === clip.id)) {
      clips.unshift(clip);
      clipStateVersion++;
      if (searchQuery && !clipMatchesSearch(clip, searchQuery)) {
        renderClips();
      } else {
        insertClipAnimated(clip);
      }
    }
    return clip;
  } catch (e) {
    showToast(t('sendError', { message: e.message }));
    throw e;
  }
}

function createUploadElement(task) {
  const el = document.createElement('div');
  el.className = 'clip clip-uploading';
  el.dataset.uploadId = task.id;
  const header = document.createElement('div');
  header.className = 'clip-header';
  const name = document.createElement('span');
  name.textContent = task.originalName || (task.type === 'image' ? t('image') : t('file'));
  header.appendChild(name);
  if (task.status === 'uploading') {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    header.appendChild(spinner);
  }
  el.appendChild(header);
  const body = document.createElement('div');
  body.className = 'clip-content uploading-label';
  body.textContent = task.status === 'error'
    ? `${t('uploadFailed')}: ${task.error || ''}`
    : `${t('uploading')} ${task.progress}%`;
  el.appendChild(body);
  const progress = document.createElement('div');
  progress.className = 'upload-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(task.progress));
  progress.setAttribute('aria-label', name.textContent);
  const bar = document.createElement('div');
  bar.className = 'upload-progress-bar';
  bar.style.width = task.progress + '%';
  progress.appendChild(bar);
  el.appendChild(progress);
  const actions = document.createElement('div');
  actions.className = 'clip-actions';
  if (task.status === 'error') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = t('retry');
    retry.addEventListener('click', () => startUpload(task));
    actions.appendChild(retry);
  }
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t('cancel');
  cancel.addEventListener('click', () => {
    task.request?.abort();
    uploadTasks.delete(task.id);
    renderUploads();
  });
  actions.appendChild(cancel);
  el.appendChild(actions);
  return el;
}

function renderUploads() {
  const container = $('#uploading');
  if (!container) return;
  container.innerHTML = '';
  for (const task of uploadTasks.values()) {
    if (task.boardId === currentBoardId) container.appendChild(createUploadElement(task));
  }
}

async function startUpload(task) {
  task.status = 'uploading';
  task.error = '';
  task.progress = 0;
  renderUploads();
  const request = uploadRequest(task, (progress) => {
    task.progress = Math.max(0, Math.min(100, Math.round(progress * 100)));
    if (task.boardId === currentBoardId) renderUploads();
  });
  task.request = request;
  try {
    const clip = await request.promise;
    if (!uploadTasks.has(task.id)) return;
    uploadTasks.delete(task.id);
    if (task.boardId === currentBoardId && !clips.some(item => item.id === clip.id)) {
      clips.unshift(clip);
      clipStateVersion++;
      if (searchQuery && !clipMatchesSearch(clip, searchQuery)) renderClips();
      else insertClipAnimated(clip);
    }
    renderUploads();
  } catch (error) {
    if (!uploadTasks.has(task.id) || error.aborted) return;
    task.status = 'error';
    task.error = error.message;
    renderUploads();
    showToast(t('sendError', { message: error.message }));
  } finally {
    task.request = null;
  }
}

function uploadBlob(blob, type, originalName, boardId = currentBoardId) {
  if (!blob || !boardId) return;
  const task = {
    id: 'upload-' + Date.now() + Math.random().toString(36).slice(2, 7),
    boardId,
    blob,
    type,
    originalName: originalName || (type === 'image' ? t('pastedImage') : t('file')),
    progress: 0,
    status: 'uploading',
    error: '',
    request: null,
  };
  uploadTasks.set(task.id, task);
  startUpload(task);
}

function animateClipOut(el, callback) {
  el.classList.add('clip-exit');
  el.addEventListener('animationend', callback, { once: true });
}

async function deleteClip(boardId, clipId) {
  try {
    await api('DELETE', '/boards/' + encodeURIComponent(boardId) + '/clips/' + encodeURIComponent(clipId));
    if (boardId !== currentBoardId) return;
    const el = document.querySelector(`.clip[data-id="${clipId}"]`);
    clips = clips.filter(c => c.id !== clipId);
    clipStateVersion++;
    if (el) {
      animateClipOut(el, () => {
        renderedClipIds.delete(clipId);
        renderClips();
      });
    } else {
      renderedClipIds.delete(clipId);
      renderClips();
    }
  } catch (e) {
    showToast(t('deleteError'));
  }
}

async function createBoard(name, expiresIn) {
  const body = { name };
  if (expiresIn) body.expiresIn = Number(expiresIn);
  await api('POST', '/boards', body);
}

function animateTabOut(boardId, callback) {
  callback();
}

async function deleteBoard(boardId) {
  if (!confirm(t('confirmDelete'))) return;
  await api('DELETE', '/boards/' + boardId);
}

async function reorderBoard(draggedId, targetId) {
  const fromIdx = boards.findIndex(b => b.id === draggedId);
  const toIdx = boards.findIndex(b => b.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = boards.splice(fromIdx, 1);
  boards.splice(toIdx, 0, moved);
  renderTabs();
  try {
    await api('PUT', '/boards/reorder', { ids: boards.map(b => b.id) });
  } catch {
    await loadBoards();
  }
}

// --- Link preview ---

async function fetchLinkPreview(url) {
  if (linkPreviewCache.has(url)) return linkPreviewCache.get(url);
  try {
    const res = await fetch('/api/link-preview?url=' + encodeURIComponent(url));
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.title && !data.description) return null;
    linkPreviewCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}

function renderLinkPreviews(content, text) {
  const urls = (text.match(/https?:\/\/[^\s]+/g) || []).slice(0, 3);
  urls.forEach(url => {
    fetchLinkPreview(url).then(preview => {
      if (!preview || !preview.title) return;
      if (content.querySelector(`.link-preview[href="${CSS.escape(url)}"]`)) return;
      const card = document.createElement('a');
      card.className = 'link-preview';
      card.href = url;
      card.target = '_blank';
      card.rel = 'noopener';
      if (preview.image) {
        const img = document.createElement('img');
        img.src = preview.image;
        img.onerror = () => img.remove();
        card.appendChild(img);
      }
      const info = document.createElement('div');
      info.className = 'link-preview-info';
      const title = document.createElement('div');
      title.className = 'link-preview-title';
      title.textContent = preview.title;
      info.appendChild(title);
      if (preview.description) {
        const desc = document.createElement('div');
        desc.className = 'link-preview-desc';
        desc.textContent = preview.description;
        info.appendChild(desc);
      }
      try {
        const domain = document.createElement('div');
        domain.className = 'link-preview-domain';
        domain.textContent = new URL(url).hostname;
        info.appendChild(domain);
      } catch {}
      card.appendChild(info);
      content.appendChild(card);
    });
  });
}

// --- WebSocket ---

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');

  ws.onopen = () => {
    $('#status').className = 'status online';
    $('#status').title = t('connected');
    if (wsOpenedOnce || !lastSyncAt) syncFromServer();
    wsOpenedOnce = true;
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'clip-added':
        if (msg.boardId === currentBoardId && !clips.find(c => c.id === msg.clip.id)) {
          clips.unshift(msg.clip);
          clipStateVersion++;
          insertClipAnimated(msg.clip);
        }
        if (msg.boardId !== currentBoardId) {
          unreadCounts[msg.boardId] = (unreadCounts[msg.boardId] || 0) + 1;
          renderTabs();
        }
        if (document.hidden) {
          hiddenClipCount++;
        }
        updateTitle();
        if (document.hidden && Notification.permission === 'granted') {
          const board = boards.find(b => b.id === msg.boardId);
          const boardName = board ? (board.id === 'default' ? t('defaultBoard') : board.name) : '';
          const body = t('notificationNewClip', { boardName });
          const n = new Notification('Wklejka', { body, tag: 'wklejka-' + msg.boardId });
          n.onclick = () => {
            window.focus();
            selectBoard(msg.boardId);
            n.close();
          };
        }
        break;
      case 'clip-deleted':
        if (msg.boardId === currentBoardId) {
          const clipEl = document.querySelector(`.clip[data-id="${msg.clipId}"]`);
          clips = clips.filter(c => c.id !== msg.clipId);
          clipStateVersion++;
          if (clipEl) {
            animateClipOut(clipEl, () => {
              renderedClipIds.delete(msg.clipId);
              renderClips();
            });
          } else {
            renderedClipIds.delete(msg.clipId);
            renderClips();
          }
        }
        break;
      case 'clip-updated':
        if (msg.boardId === currentBoardId) {
          const idx = clips.findIndex(c => c.id === msg.clip.id);
          if (idx !== -1) {
            clips[idx] = msg.clip;
            clipStateVersion++;
            renderClips();
            focusClipFromHash();
          }
        }
        break;
      case 'board-added':
        if (!boards.find(b => b.id === msg.board.id)) {
          boards.push(msg.board);
          renderTabs();
        }
        break;
      case 'board-updated': {
        const idx = boards.findIndex(b => b.id === msg.board.id);
        if (idx !== -1) boards[idx] = msg.board;
        renderTabs();
        if (msg.board.id === currentBoardId) renderClips();
        break;
      }
      case 'board-deleted':
        animateTabOut(msg.boardId, () => {
          boards = boards.filter(b => b.id !== msg.boardId);
          if (currentBoardId === msg.boardId) {
            selectBoard('default', { clearHash: false });
          }
          renderTabs();
        });
        break;
      case 'boards-reordered':
        boards.sort((a, b) => msg.ids.indexOf(a.id) - msg.ids.indexOf(b.id));
        renderTabs();
        break;
    }
  };

  ws.onclose = () => {
    $('#status').className = 'status offline';
    $('#status').title = t('reconnecting');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();
}

// --- Rendering ---

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';

  boards.forEach(board => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (board.id === currentBoardId ? ' active' : '');
    btn.dataset.boardId = board.id;
    btn.draggable = true;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = board.id === 'default' ? t('defaultBoard') : board.name;
    btn.appendChild(label);

    // Double-click to rename (non-default, non-locked)
    if (board.id !== 'default') {
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (board.locked) return;
        const input = document.createElement('input');
        input.className = 'tab-rename-input';
        input.value = board.name;
        input.size = Math.max(board.name.length, 5);
        btn.replaceChild(input, label);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== board.name) {
            api('PUT', '/boards/' + board.id, { name: newName });
          }
          label.textContent = newName || board.name;
          if (input.parentNode === btn) btn.replaceChild(label, input);
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          if (ev.key === 'Escape') { if (input.parentNode === btn) btn.replaceChild(label, input); }
          ev.stopPropagation();
        });
        input.addEventListener('blur', commit);
        input.addEventListener('click', (ev) => ev.stopPropagation());
      });
    }

    if (unreadCounts[board.id] > 0) {
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.textContent = unreadCounts[board.id];
      btn.appendChild(badge);
    }

    if (board.expiresAt) {
      const tip = boardTooltip(board);
      if (tip) btn.title = tip;
    }

    // Lock icon (non-default only)
    if (board.id !== 'default') {
      const lock = document.createElement('span');
      lock.className = 'lock-board' + (board.locked ? ' locked' : '');
      lock.textContent = board.locked ? '\uD83D\uDD12' : '\uD83D\uDD13';
      lock.title = board.locked ? t('unlock') : t('lock');
      lock.addEventListener('click', (e) => {
        e.stopPropagation();
        if (board.locked) {
          openUnlockModal(board);
        } else {
          api('PUT', '/boards/' + board.id, { locked: true });
        }
      });
      btn.appendChild(lock);
    }

    // Delete button (non-default, non-locked)
    if (board.id !== 'default' && !board.locked) {
      const del = document.createElement('span');
      del.className = 'delete-board';
      del.textContent = '\u00d7';
      del.title = t('deleteTab');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBoard(board.id);
      });
      btn.appendChild(del);
    }

    // Tab drag & drop for reordering
    btn.addEventListener('dragstart', (e) => {
      isDraggingTab = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', board.id);
      btn.classList.add('tab-dragging');
    });

    btn.addEventListener('dragend', () => {
      isDraggingTab = false;
      btn.classList.remove('tab-dragging');
      nav.querySelectorAll('.tab-drag-over').forEach(t => t.classList.remove('tab-drag-over'));
    });

    btn.addEventListener('dragover', (e) => {
      if (!isDraggingTab) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      btn.classList.add('tab-drag-over');
    });

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('tab-drag-over');
    });

    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('tab-drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === board.id) return;
      reorderBoard(draggedId, board.id);
    });

    btn.addEventListener('click', () => {
      selectBoard(board.id);
    });

    nav.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'tab add-tab';
  addBtn.textContent = t('newTab');
  addBtn.addEventListener('click', openNewBoardModal);
  nav.appendChild(addBtn);

  // Animate newly added tabs
  const newBoardIds = new Set(boards.map(b => b.id));
  boards.forEach(board => {
    if (!renderedBoardIds.has(board.id)) {
      const tab = nav.querySelector(`.tab[data-board-id="${board.id}"]`);
      if (tab) tab.classList.add('tab-enter');
    }
  });
  renderedBoardIds = newBoardIds;
}

function expiryLabel(ms) {
  if (ms < 3600000) return t('expiryMinutes', { count: Math.round(ms / 60000) });
  if (ms < 86400000) return t('expiryHours', { count: Math.round(ms / 3600000) });
  return t('expiryDays', { count: Math.round(ms / 86400000) });
}

function boardTooltip(board) {
  if (!board.expiresAt) return '';
  const remaining = board.expiresAt - Date.now();
  if (remaining <= 0) return t('expiresIn', { time: t('justNow') });
  return t('expiresIn', { time: expiryLabel(remaining) });
}

function clipMatchesSearch(clip, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    clip.type,
    clip.content,
    clip.originalName,
    clip.mimeType,
    clip.size ? formatSize(clip.size) : '',
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(normalized);
}

function visibleClips() {
  return clips.filter(clip => clipMatchesSearch(clip, searchQuery));
}

function clipLink(boardId, clipId) {
  const params = new URLSearchParams(location.search);
  const langParam = params.get('lang');
  const query = langParam ? `?lang=${encodeURIComponent(langParam)}` : '';
  return `${location.origin}${location.pathname}${query}#clip=${encodeURIComponent(boardId)}:${encodeURIComponent(clipId)}`;
}

function clipTargetFromHash() {
  const match = location.hash.match(/^#clip=([^:]+):(.+)$/);
  if (!match) return null;
  try {
    return {
      boardId: decodeURIComponent(match[1]),
      clipId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function focusClipElement(clipId) {
  const el = document.querySelector(`.clip[data-id="${CSS.escape(clipId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('clip-focused');
  setTimeout(() => el.classList.remove('clip-focused'), 1600);
  return true;
}

function focusClipFromHash() {
  const target = clipTargetFromHash();
  if (!target) return;
  if (location.hash === focusedClipHash) return;
  if (target.boardId !== currentBoardId) {
    if (boards.some(board => board.id === target.boardId)) {
      selectBoard(target.boardId, { clearHash: false });
    }
    return;
  }
  if (searchQuery) {
    searchQuery = '';
    $('#search-input').value = '';
    renderClips();
  }
  requestAnimationFrame(() => {
    if (focusClipElement(target.clipId)) focusedClipHash = location.hash;
  });
}

function createClipElement(clip, boardId = currentBoardId) {
  const el = document.createElement('div');
  el.className = 'clip';
  el.dataset.id = clip.id;

  // Header
  const header = document.createElement('div');
  header.className = 'clip-header';
  const typeLabel = document.createElement('span');
  const typeLabels = { image: t('image'), file: t('file'), text: t('text') };
  typeLabel.textContent = typeLabels[clip.type] || clip.type;
  const time = document.createElement('span');
  time.textContent = timeAgo(clip.createdAt);
  time.dataset.ts = clip.createdAt;
  header.appendChild(typeLabel);
  header.appendChild(time);
  el.appendChild(header);

  // Content
  const content = document.createElement('div');
  content.className = 'clip-content';
  if (clip.type === 'image') {
    const img = document.createElement('img');
    img.src = clip.imageUrl;
    img.alt = t('pastedImage');
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(clip.imageUrl, '_blank'));
    content.appendChild(img);
  } else if (clip.type === 'file') {
    const previewUrl = clip.previewUrl || `${clip.fileUrl}/preview`;
    const fileInfo = document.createElement('div');
    fileInfo.className = 'file-info';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = fileIcon(clip.originalName);
    fileInfo.appendChild(icon);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = clip.originalName || t('file');
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatSize(clip.size);
    fileInfo.appendChild(nameSpan);
    fileInfo.appendChild(sizeSpan);
    content.appendChild(fileInfo);
    const ext = (clip.originalName || '').toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      const embed = document.createElement('embed');
      embed.src = previewUrl;
      embed.type = 'application/pdf';
      embed.className = 'pdf-preview';
      content.appendChild(embed);
    } else if (['mp4', 'webm', 'mov', 'ogg'].includes(ext)) {
      const video = document.createElement('video');
      video.src = previewUrl;
      video.controls = true;
      video.className = 'media-preview';
      content.appendChild(video);
    } else if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) {
      const audio = document.createElement('audio');
      audio.src = previewUrl;
      audio.controls = true;
      audio.className = 'audio-preview';
      content.appendChild(audio);
    }
  } else {
    const pre = document.createElement('pre');
    const highlighted = highlight.highlightedTextWithLinks(clip.content);
    pre.innerHTML = highlighted.html;
    if (highlighted.asCode) pre.classList.add('syntax-highlight');
    content.appendChild(pre);
    requestAnimationFrame(() => {
      if (pre.scrollHeight > 400) {
        pre.classList.add('collapsible', 'collapsed');
        const fullHeight = pre.scrollHeight;
        const btn = document.createElement('button');
        btn.className = 'expand-btn';
        btn.textContent = t('showMore');
        btn.addEventListener('click', () => {
          const isCollapsed = pre.classList.contains('collapsed');
          if (isCollapsed) {
            pre.style.maxHeight = fullHeight + 'px';
            pre.classList.remove('collapsed');
            pre.classList.add('expanded');
          } else {
            pre.style.maxHeight = '400px';
            pre.classList.add('collapsed');
            pre.classList.remove('expanded');
          }
          btn.textContent = isCollapsed ? t('showLess') : t('showMore');
        });
        content.appendChild(btn);
      }
    });
    // Link previews
    renderLinkPreviews(content, clip.content);
  }
  el.appendChild(content);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'clip-actions';
  const board = boards.find(item => item.id === boardId);
  const isLocked = !!board?.locked;

  if (clip.type !== 'file') {
    const copyBtn = document.createElement('button');
    copyBtn.textContent = t('copy');
    copyBtn.addEventListener('click', () => copyClip(clip, copyBtn));
    actions.appendChild(copyBtn);
  }

  if (clip.type === 'text' && !isLocked) {
    const editBtn = document.createElement('button');
    editBtn.textContent = t('edit');
    editBtn.addEventListener('click', () => startEditClip(boardId, clip, el));
    actions.appendChild(editBtn);
  }

  if (clip.type === 'image' || clip.type === 'file') {
    const dlBtn = document.createElement('button');
    dlBtn.textContent = t('download');
    dlBtn.addEventListener('click', () => downloadClip(clip));
    actions.appendChild(dlBtn);
  }

  const linkBtn = document.createElement('button');
  linkBtn.textContent = t('link');
  linkBtn.addEventListener('click', () => copyClipLink(boardId, clip.id, linkBtn));
  actions.appendChild(linkBtn);

  if (!isLocked) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = t('delete');
    let deleteConfirmTimeout;
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm) {
        clearTimeout(deleteConfirmTimeout);
        deleteClip(boardId, clip.id);
        return;
      }
      delBtn.dataset.confirm = '1';
      delBtn.textContent = t('sure');
      delBtn.classList.add('btn-confirm-active');
      deleteConfirmTimeout = setTimeout(() => {
        delete delBtn.dataset.confirm;
        delBtn.textContent = t('delete');
        delBtn.classList.remove('btn-confirm-active');
      }, 3000);
    });
    actions.appendChild(delBtn);
  }

  el.appendChild(actions);
  return el;
}

function renderClips() {
  const container = $('#clips');
  const nextClips = visibleClips();

  if (!clips.length) {
    renderedClipIds.clear();
    container.innerHTML = '<div class="empty-state">' + escapeHtml(t('empty')) + '</div>';
    return;
  }

  if (!nextClips.length) {
    renderedClipIds.clear();
    container.innerHTML = '<div class="empty-state">' + escapeHtml(t('noSearchResults')) + '</div>';
    return;
  }

  container.innerHTML = '';
  nextClips.forEach(clip => {
    container.appendChild(createClipElement(clip, currentBoardId));
  });
  renderedClipIds = new Set(nextClips.map(c => c.id));
}

function insertClipAnimated(clip) {
  const container = $('#clips');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const el = createClipElement(clip, currentBoardId);
  el.classList.add('clip-enter');
  container.prepend(el);
  renderedClipIds.add(clip.id);
}

function startEditClip(boardId, clip, el) {
  const content = el.querySelector('.clip-content');
  if (!content) return;
  content.innerHTML = '';
  el.classList.add('editing');

  const editor = document.createElement('textarea');
  editor.className = 'clip-editor';
  editor.value = clip.content;
  content.appendChild(editor);

  const editActions = document.createElement('div');
  editActions.className = 'clip-edit-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = t('cancel');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = t('save');
  editActions.appendChild(cancelBtn);
  editActions.appendChild(saveBtn);
  content.appendChild(editActions);

  const finish = () => {
    el.classList.remove('editing');
    renderClips();
    focusClipElement(clip.id);
  };

  cancelBtn.addEventListener('click', finish);
  saveBtn.addEventListener('click', async () => {
    const nextContent = editor.value;
    if (!nextContent.trim()) return;
    saveBtn.disabled = true;
    try {
      const updated = await api('PUT', '/boards/' + boardId + '/clips/' + clip.id, { content: nextContent });
      const idx = clips.findIndex(c => c.id === updated.id);
      if (idx !== -1) clips[idx] = updated;
      clipStateVersion++;
      finish();
    } catch {
      saveBtn.disabled = false;
      showToast(t('editError'));
    }
  });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') finish();
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      saveBtn.click();
    }
  });
  requestAnimationFrame(() => {
    editor.focus();
    editor.selectionStart = editor.selectionEnd = editor.value.length;
  });
}

// --- Clip actions ---

async function copyClipLink(boardId, clipId, btn) {
  try {
    await navigator.clipboard.writeText(clipLink(boardId, clipId));
    showToast(t('linkCopied'));
    if (btn) {
      clearTimeout(btn._linkTimeout);
      btn.textContent = '\u2713';
      btn.classList.add('copy-success');
      btn._linkTimeout = setTimeout(() => {
        btn.textContent = t('link');
        btn.classList.remove('copy-success');
      }, 1500);
    }
  } catch {
    showToast(t('copyFailed'));
  }
}

async function copyClip(clip, btn) {
  try {
    if (clip.type === 'text') {
      await navigator.clipboard.writeText(clip.content);
    } else {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': fetch(clip.imageUrl)
            .then(r => r.blob())
            .then(blob => {
              if (blob.type === 'image/png') return blob;
              return createImageBitmap(blob).then(bmp => {
                const c = document.createElement('canvas');
                c.width = bmp.width;
                c.height = bmp.height;
                c.getContext('2d').drawImage(bmp, 0, 0);
                return new Promise(r => c.toBlob(r, 'image/png'));
              });
            })
        })
      ]);
    }
    if (btn) {
      clearTimeout(btn._copyTimeout);
      btn.textContent = '\u2713';
      btn.classList.add('copy-success');
      btn._copyTimeout = setTimeout(() => {
        btn.textContent = t('copy');
        btn.classList.remove('copy-success');
      }, 1500);
    }
  } catch {
    if (clip.type === 'image') {
      window.open(clip.imageUrl, '_blank');
    }
    showToast(t('copyFailed'));
  }
}

function downloadClip(clip) {
  const a = document.createElement('a');
  a.href = clip.fileUrl || clip.imageUrl;
  a.download = clip.originalName || clip.filename || 'file';
  a.click();
}

// --- Event handlers ---

// Global paste: capture images anywhere
document.addEventListener('paste', (e) => {
  const items = Array.from(e.clipboardData.items);
  const imageItem = items.find(i => i.type.startsWith('image/'));

  if (imageItem) {
    e.preventDefault();
    const blob = imageItem.getAsFile();
    uploadBlob(blob, 'image', undefined, currentBoardId);
  }
  // Text paste in textarea: default behavior handles it
});

// Drag & drop
let dragCounter = 0;

function isFileDrag(e) {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

document.addEventListener('dragenter', (e) => {
  if (isDraggingTab || !isFileDrag(e)) return;
  e.preventDefault();
  dragCounter++;
  $('#drop-overlay').classList.add('visible');
});

document.addEventListener('dragleave', (e) => {
  if (isDraggingTab || !isFileDrag(e)) return;
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    $('#drop-overlay').classList.remove('visible');
  }
});

document.addEventListener('dragover', (e) => {
  if (isDraggingTab || !isFileDrag(e)) return;
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  if (isDraggingTab || !isFileDrag(e)) return;
  e.preventDefault();
  dragCounter = 0;
  $('#drop-overlay').classList.remove('visible');

  const boardId = currentBoardId;
  const files = Array.from(e.dataTransfer.files);
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      uploadBlob(file, 'image', file.name, boardId);
    } else {
      uploadBlob(file, 'file', file.name, boardId);
    }
  });
});

// Send text
async function sendText() {
  const textarea = $('#text-input');
  const boardId = currentBoardId;
  const text = textarea.value;
  if (!text.trim()) return;
  saveDraft(boardId, text);
  const sendButton = $('#send-btn');
  sendButton.disabled = true;
  try {
    await sendClip(boardId, 'text', text);
    if (draftFor(boardId) === text) saveDraft(boardId, '');
    if (currentBoardId === boardId && textarea.value === text) {
      textarea.value = '';
      textarea.style.height = 'auto';
    }
  } catch {
    // Keep the exact draft for retry, including leading and trailing whitespace.
  } finally {
    sendButton.disabled = false;
  }
}

$('#text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendText();
  }
});

$('#send-btn').addEventListener('click', sendText);

$('#search-input').addEventListener('input', (event) => {
  searchQuery = event.target.value.trim();
  renderClips();
});

// File picker
$('#file-btn').addEventListener('click', () => {
  filePickerBoardId = currentBoardId;
  $('#file-input').click();
});
$('#file-input').addEventListener('change', (e) => {
  const boardId = filePickerBoardId || currentBoardId;
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      uploadBlob(file, 'image', file.name, boardId);
    } else {
      uploadBlob(file, 'file', file.name, boardId);
    }
  });
  filePickerBoardId = null;
  e.target.value = '';
});

// Auto-resize textarea
$('#text-input').addEventListener('input', function () {
  saveDraft(currentBoardId, this.value);
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 300) + 'px';
});

// --- Utilities ---

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function fileIcon(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  const icons = {
    pdf: '\uD83D\uDCC4', doc: '\uD83D\uDCC4', docx: '\uD83D\uDCC4', odt: '\uD83D\uDCC4',
    xls: '\uD83D\uDCCA', xlsx: '\uD83D\uDCCA', csv: '\uD83D\uDCCA',
    zip: '\uD83D\uDCE6', rar: '\uD83D\uDCE6', '7z': '\uD83D\uDCE6', tar: '\uD83D\uDCE6', gz: '\uD83D\uDCE6',
    mp3: '\uD83C\uDFB5', wav: '\uD83C\uDFB5', ogg: '\uD83C\uDFB5', flac: '\uD83C\uDFB5', aac: '\uD83C\uDFB5', m4a: '\uD83C\uDFB5',
    mp4: '\uD83C\uDFAC', webm: '\uD83C\uDFAC', mov: '\uD83C\uDFAC', avi: '\uD83C\uDFAC',
    png: '\uD83D\uDDBC\uFE0F', jpg: '\uD83D\uDDBC\uFE0F', jpeg: '\uD83D\uDDBC\uFE0F', gif: '\uD83D\uDDBC\uFE0F', svg: '\uD83D\uDDBC\uFE0F', webp: '\uD83D\uDDBC\uFE0F',
    txt: '\uD83D\uDCC3', md: '\uD83D\uDCC3', log: '\uD83D\uDCC3',
    js: '\uD83D\uDCBB', ts: '\uD83D\uDCBB', py: '\uD83D\uDCBB', rb: '\uD83D\uDCBB', go: '\uD83D\uDCBB', rs: '\uD83D\uDCBB', java: '\uD83D\uDCBB', c: '\uD83D\uDCBB', cpp: '\uD83D\uDCBB', h: '\uD83D\uDCBB',
    json: '\uD83D\uDCBB', xml: '\uD83D\uDCBB', yaml: '\uD83D\uDCBB', yml: '\uD83D\uDCBB', toml: '\uD83D\uDCBB',
  };
  return icons[ext] || '\uD83D\uDCC1';
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return t('justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('minutesAgo', { count: min });
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return t('hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('daysAgo', { count: days });
}

function updateTitle() {
  const boardUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const total = Math.max(boardUnread, hiddenClipCount);
  document.title = total > 0 ? `(${total}) Wklejka` : 'Wklejka';
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// --- New board modal ---

function openNewBoardModal() {
  $('#modal-name').value = '';
  $('#modal-expires').value = '';
  $('#new-board-modal').classList.add('visible');
  setTimeout(() => $('#modal-name').focus(), 50);
}

function closeNewBoardModal() {
  $('#new-board-modal').classList.remove('visible');
}

$('#modal-cancel').addEventListener('click', closeNewBoardModal);

$('#new-board-modal').addEventListener('click', (e) => {
  if (e.target === $('#new-board-modal')) closeNewBoardModal();
});

$('#modal-create').addEventListener('click', () => {
  const name = $('#modal-name').value.trim();
  if (!name) return;
  const expiresIn = $('#modal-expires').value;
  createBoard(name, expiresIn || null);
  closeNewBoardModal();
});

$('#modal-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#modal-create').click();
  }
  if (e.key === 'Escape') closeNewBoardModal();
});

// --- Unlock modal ---

let unlockBoardId = null;

function openUnlockModal(board) {
  unlockBoardId = board.id;
  $('#unlock-title').textContent = t('unlockTitle');
  $('#unlock-prompt').textContent = t('unlockPrompt', { name: board.name });
  $('#unlock-input').value = '';
  $('#unlock-input').dataset.expected = board.name;
  $('#unlock-confirm').disabled = true;
  $('#unlock-confirm').textContent = t('unlock');
  $('#unlock-cancel').textContent = t('cancel');
  $('#unlock-modal').classList.add('visible');
  setTimeout(() => $('#unlock-input').focus(), 50);
}

function closeUnlockModal() {
  $('#unlock-modal').classList.remove('visible');
  unlockBoardId = null;
}

$('#unlock-cancel').addEventListener('click', closeUnlockModal);

$('#unlock-modal').addEventListener('click', (e) => {
  if (e.target === $('#unlock-modal')) closeUnlockModal();
});

$('#unlock-input').addEventListener('input', () => {
  $('#unlock-confirm').disabled = $('#unlock-input').value !== $('#unlock-input').dataset.expected;
});

$('#unlock-confirm').addEventListener('click', () => {
  if (!unlockBoardId || $('#unlock-confirm').disabled) return;
  api('PUT', '/boards/' + unlockBoardId, { locked: false });
  closeUnlockModal();
});

$('#unlock-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('#unlock-confirm').disabled) {
    e.preventDefault();
    $('#unlock-confirm').click();
  }
  if (e.key === 'Escape') closeUnlockModal();
});

// --- Init ---

stripTokenFromUrl();
initTheme();
$('#theme-toggle').addEventListener('click', toggleTheme);
updateStaticTexts();
connectWS();
syncFromServer();

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    hiddenClipCount = 0;
    updateTitle();
    syncAfterResume();
  }
});

window.addEventListener('focus', syncAfterResume);
window.addEventListener('hashchange', () => {
  focusedClipHash = '';
  focusClipFromHash();
});

// Refresh time labels every 30s
setInterval(() => {
  document.querySelectorAll('[data-ts]').forEach(el => {
    el.textContent = timeAgo(Number(el.dataset.ts));
  });
}, 30000);

// Listen for OS theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeMode === 'auto') applyTheme();
});

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

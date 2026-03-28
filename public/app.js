/* Wklejka - frontend */

const $ = (s) => document.querySelector(s);

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
    sendError: 'B\u0142\u0105d wysy\u0142ania: ',
    deleteError: 'B\u0142\u0105d usuwania',
    justNow: 'przed chwil\u0105',
    minAgo: ' min temu',
    hrsAgo: ' godz. temu',
    daysAgo: ' dn. temu',
    connected: 'Po\u0142\u0105czono',
    reconnecting: 'Roz\u0142\u0105czono \u2013 ponawiam...',
    file: 'Plik',
    attachFile: 'Za\u0142\u0105cz plik',
    uploading: 'Przesy\u0142anie...',
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
    expiresIn: 'Wygasa ',
    notificationNewClip: 'Nowy wpis w %s',
    showMore: 'Rozwiń',
    showLess: 'Zwiń',
    sure: 'Na pewno?',
    lock: 'Zablokuj',
    unlock: 'Odblokuj',
    unlockTitle: 'Odblokuj kart\u0119',
    unlockPrompt: 'Wpisz "%s" aby odblokowa\u0107:',
    boardLocked: 'Karta jest zablokowana',
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
    sendError: 'Send error: ',
    deleteError: 'Delete error',
    justNow: 'just now',
    minAgo: ' min ago',
    hrsAgo: ' hrs ago',
    daysAgo: ' days ago',
    connected: 'Connected',
    reconnecting: 'Disconnected \u2013 reconnecting...',
    file: 'File',
    attachFile: 'Attach file',
    uploading: 'Uploading...',
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
    expiresIn: 'Expires ',
    notificationNewClip: 'New clip in %s',
    showMore: 'Show more',
    showLess: 'Show less',
    sure: 'Sure?',
    lock: 'Lock',
    unlock: 'Unlock',
    unlockTitle: 'Unlock tab',
    unlockPrompt: 'Type "%s" to unlock:',
    boardLocked: 'Board is locked',
  }
};

const lang = new URLSearchParams(location.search).get('lang')
  || (navigator.language.startsWith('pl') ? 'pl' : 'en');

function t(key) {
  return (i18n[lang] || i18n.en)[key] || key;
}

function updateStaticTexts() {
  $('.subtitle').textContent = t('subtitle');
  $('#text-input').placeholder = t('placeholder');
  $('.hint').textContent = t('hint');
  $('#send-btn').textContent = t('send');
  $('.drop-overlay-content p').textContent = t('dropHereFiles');
  $('#file-btn').textContent = t('attachFile');
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
  const labels = { auto: 'Auto', dark: lang === 'pl' ? 'Ciemny' : 'Dark', light: lang === 'pl' ? 'Jasny' : 'Light' };
  btn.textContent = labels[themeMode];
}

// --- State ---

let boards = [];
let currentBoardId = 'default';
let clips = [];
let ws;
const unreadCounts = {};
let hiddenClipCount = 0;
let isDraggingTab = false;
let renderedClipIds = new Set();
let renderedBoardIds = new Set();
const linkPreviewCache = new Map();

// --- API helpers ---

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// --- Data operations ---

async function loadBoards() {
  boards = await api('GET', '/boards');
  renderedBoardIds = new Set(boards.map(b => b.id));
  renderTabs();
}

async function loadClips() {
  clips = await api('GET', '/boards/' + currentBoardId + '/clips');
  renderedClipIds.clear();
  renderClips();
}

async function sendClip(type, content, originalName) {
  const ghostId = 'ghost-' + Date.now() + Math.random().toString(36).substr(2, 5);
  if (type !== 'text') {
    showGhost(ghostId, originalName || (type === 'image' ? t('image') : t('file')));
  }
  try {
    const body = { type, content };
    if (originalName) body.originalName = originalName;
    const clip = await api('POST', '/boards/' + currentBoardId + '/clips', body);
    removeGhost(ghostId);
    if (!clips.find(c => c.id === clip.id)) {
      clips.unshift(clip);
      insertClipAnimated(clip);
    }
  } catch (e) {
    removeGhost(ghostId);
    showToast(t('sendError') + e.message);
  }
}

function showGhost(ghostId, label) {
  const container = $('#uploading');
  const el = document.createElement('div');
  el.className = 'clip clip-uploading';
  el.id = ghostId;
  const header = document.createElement('div');
  header.className = 'clip-header';
  const name = document.createElement('span');
  name.textContent = label;
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  header.appendChild(name);
  header.appendChild(spinner);
  el.appendChild(header);
  const body = document.createElement('div');
  body.className = 'clip-content uploading-label';
  body.textContent = t('uploading');
  el.appendChild(body);
  container.appendChild(el);
}

function removeGhost(ghostId) {
  const el = document.getElementById(ghostId);
  if (el) el.remove();
}

function animateClipOut(el, callback) {
  const height = el.offsetHeight;
  el.classList.add('clip-animating');
  el.style.maxHeight = height + 'px';
  el.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.97)';
      el.style.maxHeight = '0px';
      el.style.paddingTop = '0px';
      el.style.paddingBottom = '0px';
      el.style.marginBottom = '0px';
      el.addEventListener('transitionend', callback, { once: true });
    });
  });
}

async function deleteClip(clipId) {
  try {
    await api('DELETE', '/boards/' + currentBoardId + '/clips/' + clipId);
    const el = document.querySelector(`.clip[data-id="${clipId}"]`);
    clips = clips.filter(c => c.id !== clipId);
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
  const tab = document.querySelector(`.tab[data-board-id="${boardId}"]`);
  if (tab) {
    tab.style.maxWidth = tab.offsetWidth + 'px';
    tab.classList.add('tab-animating');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tab.style.maxWidth = '0px';
        tab.style.paddingLeft = '0px';
        tab.style.paddingRight = '0px';
        tab.style.opacity = '0';
        tab.addEventListener('transitionend', callback, { once: true });
      });
    });
  } else {
    callback();
  }
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
  ws = new WebSocket(proto + '//' + location.host);

  ws.onopen = () => {
    $('#status').className = 'status online';
    $('#status').title = t('connected');
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'clip-added':
        if (msg.boardId === currentBoardId && !clips.find(c => c.id === msg.clip.id)) {
          clips.unshift(msg.clip);
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
          const body = t('notificationNewClip').replace('%s', boardName);
          const n = new Notification('Wklejka', { body, tag: 'wklejka-' + msg.boardId });
          n.onclick = () => {
            window.focus();
            if (currentBoardId !== msg.boardId) {
              currentBoardId = msg.boardId;
              unreadCounts[msg.boardId] = 0;
              updateTitle();
              renderTabs();
              loadClips();
            }
            n.close();
          };
        }
        break;
      case 'clip-deleted':
        if (msg.boardId === currentBoardId) {
          const clipEl = document.querySelector(`.clip[data-id="${msg.clipId}"]`);
          clips = clips.filter(c => c.id !== msg.clipId);
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
            currentBoardId = 'default';
            loadClips();
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
      if (currentBoardId === board.id) return;
      currentBoardId = board.id;
      unreadCounts[board.id] = 0;
      updateTitle();
      renderTabs();
      loadClips();
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
      if (tab) {
        const fullWidth = tab.offsetWidth;
        // Collapse instantly (no transition)
        tab.style.transition = 'none';
        tab.style.overflow = 'hidden';
        tab.style.maxWidth = '0px';
        tab.style.paddingLeft = '0px';
        tab.style.paddingRight = '0px';
        tab.style.opacity = '0';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Now animate open
            tab.classList.add('tab-animating');
            tab.style.transition = '';
            tab.style.maxWidth = fullWidth + 'px';
            tab.style.paddingLeft = '';
            tab.style.paddingRight = '';
            tab.style.opacity = '1';
            tab.addEventListener('transitionend', () => {
              tab.classList.remove('tab-animating');
              tab.style.maxWidth = '';
              tab.style.overflow = '';
            }, { once: true });
          });
        });
      }
    }
  });
  renderedBoardIds = newBoardIds;
}

function expiryLabel(ms) {
  if (ms < 3600000) return Math.round(ms / 60000) + ' min';
  if (ms < 86400000) return Math.round(ms / 3600000) + (lang === 'pl' ? ' godz.' : 'h');
  return Math.round(ms / 86400000) + (lang === 'pl' ? ' dn.' : 'd');
}

function boardTooltip(board) {
  if (!board.expiresAt) return '';
  const remaining = board.expiresAt - Date.now();
  if (remaining <= 0) return t('expiresIn') + t('justNow');
  return t('expiresIn') + expiryLabel(remaining);
}

function createClipElement(clip) {
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
    const fileInfo = document.createElement('div');
    fileInfo.className = 'file-info';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = fileIcon(clip.originalName);
    fileInfo.appendChild(icon);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = clip.originalName || 'file';
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = formatSize(clip.size);
    fileInfo.appendChild(nameSpan);
    fileInfo.appendChild(sizeSpan);
    content.appendChild(fileInfo);
    const ext = (clip.originalName || '').toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      const embed = document.createElement('embed');
      embed.src = clip.fileUrl;
      embed.type = 'application/pdf';
      embed.className = 'pdf-preview';
      content.appendChild(embed);
    } else if (['mp4', 'webm', 'mov', 'ogg'].includes(ext)) {
      const video = document.createElement('video');
      video.src = clip.fileUrl;
      video.controls = true;
      video.className = 'media-preview';
      content.appendChild(video);
    } else if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) {
      const audio = document.createElement('audio');
      audio.src = clip.fileUrl;
      audio.controls = true;
      audio.className = 'audio-preview';
      content.appendChild(audio);
    }
  } else {
    const pre = document.createElement('pre');
    pre.innerHTML = linkify(clip.content);
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

  if (clip.type !== 'file') {
    const copyBtn = document.createElement('button');
    copyBtn.textContent = t('copy');
    copyBtn.addEventListener('click', () => copyClip(clip, copyBtn));
    actions.appendChild(copyBtn);
  }

  if (clip.type === 'image' || clip.type === 'file') {
    const dlBtn = document.createElement('button');
    dlBtn.textContent = t('download');
    dlBtn.addEventListener('click', () => downloadClip(clip));
    actions.appendChild(dlBtn);
  }

  const currentBoard = boards.find(b => b.id === currentBoardId);
  if (!currentBoard || !currentBoard.locked) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = t('delete');
    let deleteConfirmTimeout;
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirm) {
        clearTimeout(deleteConfirmTimeout);
        deleteClip(clip.id);
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

  if (!clips.length) {
    renderedClipIds.clear();
    container.innerHTML = '<div class="empty-state">' + escapeHtml(t('empty')) + '</div>';
    return;
  }

  container.innerHTML = '';
  clips.forEach(clip => {
    container.appendChild(createClipElement(clip));
  });
  renderedClipIds = new Set(clips.map(c => c.id));
}

function insertClipAnimated(clip) {
  const container = $('#clips');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const el = createClipElement(clip);

  // For images/files: simple fade-in (height unknown until loaded)
  if (clip.type !== 'text') {
    el.classList.add('clip-fade-enter');
    container.prepend(el);
    renderedClipIds.add(clip.id);
    return;
  }

  // For text: smooth height expand
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.width = container.offsetWidth + 'px';
  container.appendChild(el);
  const fullHeight = el.offsetHeight;
  el.remove();

  el.style.position = '';
  el.style.visibility = '';
  el.style.width = '';
  el.classList.add('clip-animating');
  el.style.maxHeight = '0px';
  el.style.paddingTop = '0px';
  el.style.paddingBottom = '0px';
  el.style.marginBottom = '0px';
  el.style.opacity = '0';
  container.prepend(el);
  renderedClipIds.add(clip.id);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.maxHeight = fullHeight + 'px';
      el.style.paddingTop = '';
      el.style.paddingBottom = '';
      el.style.marginBottom = '';
      el.style.opacity = '1';
      el.addEventListener('transitionend', () => {
        el.classList.remove('clip-animating');
        el.style.maxHeight = '';
      }, { once: true });
    });
  });
}

// --- Clip actions ---

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
    const reader = new FileReader();
    reader.onload = () => sendClip('image', reader.result);
    reader.readAsDataURL(blob);
  }
  // Text paste in textarea: default behavior handles it
});

// Drag & drop
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  if (isDraggingTab) return;
  e.preventDefault();
  dragCounter++;
  $('#drop-overlay').classList.add('visible');
});

document.addEventListener('dragleave', (e) => {
  if (isDraggingTab) return;
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    $('#drop-overlay').classList.remove('visible');
  }
});

document.addEventListener('dragover', (e) => {
  if (isDraggingTab) return;
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  if (isDraggingTab) return;
  e.preventDefault();
  dragCounter = 0;
  $('#drop-overlay').classList.remove('visible');

  const files = Array.from(e.dataTransfer.files);
  files.forEach(file => {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onload = () => sendClip('image', reader.result);
    } else {
      reader.onload = () => sendClip('file', reader.result, file.name);
    }
    reader.readAsDataURL(file);
  });
});

// Send text
function sendText() {
  const textarea = $('#text-input');
  const text = textarea.value.trim();
  if (!text) return;
  sendClip('text', text);
  textarea.value = '';
  textarea.style.height = 'auto';
}

$('#text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendText();
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + '\t' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 1;
  }
});

$('#send-btn').addEventListener('click', sendText);

// File picker
$('#file-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onload = () => sendClip('image', reader.result);
    } else {
      reader.onload = () => sendClip('file', reader.result, file.name);
    }
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});

// Auto-resize textarea
$('#text-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 300) + 'px';
});

// --- Utilities ---

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
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
  if (min < 60) return min + t('minAgo');
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return hrs + t('hrsAgo');
  const days = Math.floor(hrs / 24);
  return days + t('daysAgo');
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
  $('#unlock-prompt').textContent = t('unlockPrompt').replace('%s', board.name);
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

initTheme();
$('#theme-toggle').addEventListener('click', toggleTheme);
updateStaticTexts();
connectWS();
loadBoards().then(() => loadClips());

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    hiddenClipCount = 0;
    updateTitle();
  }
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

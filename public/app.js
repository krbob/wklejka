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
}

// --- State ---

let boards = [];
let currentBoardId = 'default';
let clips = [];
let ws;

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
  renderTabs();
}

async function loadClips() {
  clips = await api('GET', '/boards/' + currentBoardId + '/clips');
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
      renderClips();
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

async function deleteClip(clipId) {
  try {
    await api('DELETE', '/boards/' + currentBoardId + '/clips/' + clipId);
    clips = clips.filter(c => c.id !== clipId);
    renderClips();
  } catch (e) {
    showToast(t('deleteError'));
  }
}

async function createBoard(name) {
  await api('POST', '/boards', { name });
}

async function deleteBoard(boardId) {
  if (!confirm(t('confirmDelete'))) return;
  await api('DELETE', '/boards/' + boardId);
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
          renderClips();
        }
        break;
      case 'clip-deleted':
        if (msg.boardId === currentBoardId) {
          clips = clips.filter(c => c.id !== msg.clipId);
          renderClips();
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
        break;
      }
      case 'board-deleted':
        boards = boards.filter(b => b.id !== msg.boardId);
        if (currentBoardId === msg.boardId) {
          currentBoardId = 'default';
          loadClips();
        }
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

    const label = document.createElement('span');
    label.textContent = board.id === 'default' ? t('defaultBoard') : board.name;
    btn.appendChild(label);

    if (board.id !== 'default') {
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

    btn.addEventListener('click', () => {
      if (currentBoardId === board.id) return;
      currentBoardId = board.id;
      renderTabs();
      loadClips();
    });

    nav.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'tab add-tab';
  addBtn.textContent = t('newTab');
  addBtn.addEventListener('click', () => {
    const name = prompt(t('tabNamePrompt'));
    if (name && name.trim()) createBoard(name.trim());
  });
  nav.appendChild(addBtn);
}

function renderClips() {
  const container = $('#clips');

  if (!clips.length) {
    container.innerHTML = '<div class="empty-state">' + escapeHtml(t('empty')) + '</div>';
    return;
  }

  container.innerHTML = '';
  clips.forEach(clip => {
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
    }
    el.appendChild(content);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'clip-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = t('copy');
    copyBtn.addEventListener('click', () => copyClip(clip));
    actions.appendChild(copyBtn);

    if (clip.type === 'image' || clip.type === 'file') {
      const dlBtn = document.createElement('button');
      dlBtn.textContent = t('download');
      dlBtn.addEventListener('click', () => downloadClip(clip));
      actions.appendChild(dlBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete';
    delBtn.textContent = t('delete');
    delBtn.addEventListener('click', () => deleteClip(clip.id));
    actions.appendChild(delBtn);

    el.appendChild(actions);
    container.appendChild(el);
  });
}

// --- Clip actions ---

async function copyClip(clip) {
  try {
    if (clip.type === 'text') {
      await navigator.clipboard.writeText(clip.content);
    } else {
      const res = await fetch(clip.imageUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
    }
    showToast(t('copied'));
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
  e.preventDefault();
  dragCounter++;
  $('#drop-overlay').classList.add('visible');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    $('#drop-overlay').classList.remove('visible');
  }
});

document.addEventListener('dragover', (e) => e.preventDefault());

document.addEventListener('drop', (e) => {
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

// --- Init ---

updateStaticTexts();
connectWS();
loadBoards().then(() => loadClips());

// Refresh time labels every 30s
setInterval(() => {
  document.querySelectorAll('[data-ts]').forEach(el => {
    el.textContent = timeAgo(Number(el.dataset.ts));
  });
}, 30000);

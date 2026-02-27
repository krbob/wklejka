const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const FILES_DIR = path.join(DATA_DIR, 'files');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// --- Store ---

let store = { boards: [], clips: {} };

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load store:', e.message);
  }
  if (!store.boards || !store.boards.length) {
    store.boards = [{ id: 'default', name: 'Schowek', createdAt: Date.now() }];
    store.clips = { default: [] };
    saveStore();
  }
}

let saveTimeout;
function saveStore() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
    } catch (e) {
      console.error('Failed to save store:', e.message);
    }
  }, 200);
}

loadStore();

// --- Express ---

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Boards
app.get('/api/boards', (_req, res) => {
  res.json(store.boards);
});

app.post('/api/boards', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const board = { id: generateId(), name, createdAt: Date.now() };
  store.boards.push(board);
  store.clips[board.id] = [];
  saveStore();
  broadcast({ type: 'board-added', board });
  res.json(board);
});

app.put('/api/boards/:id', (req, res) => {
  const board = store.boards.find(b => b.id === req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  board.name = name;
  saveStore();
  broadcast({ type: 'board-updated', board });
  res.json(board);
});

app.delete('/api/boards/:id', (req, res) => {
  const { id } = req.params;
  if (id === 'default') return res.status(400).json({ error: 'Cannot delete default board' });
  if (!store.boards.find(b => b.id === id)) return res.status(404).json({ error: 'Board not found' });
  store.boards = store.boards.filter(b => b.id !== id);
  // Delete associated files
  (store.clips[id] || []).forEach(clip => {
    if (clip.type === 'image' && clip.filename) {
      try { fs.unlinkSync(path.join(IMAGES_DIR, clip.filename)); } catch {}
    }
    if (clip.type === 'file' && clip.filename) {
      try { fs.unlinkSync(path.join(FILES_DIR, clip.filename)); } catch {}
    }
  });
  delete store.clips[id];
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

  const clip = { id: generateId(), type, createdAt: Date.now() };

  if (type === 'image') {
    const match = content.match(/^data:image\/([\w+]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid image data' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+xml', '');
    const buffer = Buffer.from(match[2], 'base64');
    const filename = `${clip.id}.${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
    clip.filename = filename;
    clip.imageUrl = `/api/images/${filename}`;
  } else if (type === 'file') {
    const match = content.match(/^data:([^;]*);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid file data' });
    const buffer = Buffer.from(match[2], 'base64');
    const originalName = req.body.originalName || 'file';
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${clip.id}_${safeName}`;
    fs.writeFileSync(path.join(FILES_DIR, filename), buffer);
    clip.filename = filename;
    clip.originalName = originalName;
    clip.size = buffer.length;
    clip.fileUrl = `/api/files/${filename}`;
  } else {
    clip.content = content;
  }

  store.clips[id].unshift(clip);
  saveStore();
  broadcast({ type: 'clip-added', boardId: id, clip });
  res.json(clip);
});

app.delete('/api/boards/:boardId/clips/:clipId', (req, res) => {
  const { boardId, clipId } = req.params;
  if (!store.clips[boardId]) return res.status(404).json({ error: 'Board not found' });
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
  res.sendFile(filepath);
});

// Serve files
app.get('/api/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(FILES_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.sendFile(filepath);
});

// --- HTTP + WebSocket ---

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wklejka running at http://0.0.0.0:${PORT}`);
});

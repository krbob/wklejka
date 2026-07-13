function createDefaultStore(now = Date.now()) {
  return {
    boards: [{ id: 'default', name: 'Schowek', createdAt: now }],
    clips: { default: [] },
  };
}

const MAX_STORE_BOARDS = 10_000;
const MAX_STORE_CLIPS = 1_000_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[a-zA-Z0-9_-]+$/.test(value);
}

function normalizeClip(clip) {
  if (!isRecord(clip) || !isSafeId(clip.id)) return null;
  // Preserve sparse records produced by older versions, while rejecting an
  // explicitly invalid type and all non-object/null entries.
  if (clip.type !== undefined && !['text', 'image', 'file'].includes(clip.type)) return null;

  const normalized = { ...clip };
  if (normalized.pinned !== true) delete normalized.pinned;
  if (!Number.isSafeInteger(normalized.expiresAt) || normalized.expiresAt <= 0) {
    delete normalized.expiresAt;
  }
  if (normalized.filename !== undefined) {
    if (
      typeof normalized.filename !== 'string'
      || normalized.filename.length > 512
      || normalized.filename !== normalized.filename.replace(/\\/g, '/').split('/').pop()
      || /[\0\r\n]/.test(normalized.filename)
    ) {
      delete normalized.filename;
      delete normalized.imageUrl;
      delete normalized.fileUrl;
      delete normalized.previewUrl;
    }
  }

  return normalized;
}

function normalizeStore(candidate, now = Date.now()) {
  if (!isRecord(candidate)) {
    throw new Error('Store root must be an object');
  }

  const rawBoards = Array.isArray(candidate.boards) ? candidate.boards : [];
  const rawClips = isRecord(candidate.clips)
    ? candidate.clips
    : {};
  const boards = [];
  const clips = {};
  const boardIds = new Set();
  const clipIds = new Set();
  let clipCount = 0;

  for (const board of rawBoards.slice(0, MAX_STORE_BOARDS)) {
    if (!isRecord(board) || !isSafeId(board.id) || boardIds.has(board.id)) continue;
    boardIds.add(board.id);
    const normalizedBoard = { ...board };
    if (normalizedBoard.id === 'default') delete normalizedBoard.locked;
    boards.push(normalizedBoard);
  }
  if (boards.length && !boardIds.has('default')) {
    boardIds.add('default');
    boards.unshift({ id: 'default', name: 'Schowek', createdAt: now });
  }

  for (const board of boards) {
    const boardClips = Array.isArray(rawClips[board.id]) ? rawClips[board.id] : [];
    clips[board.id] = [];
    for (const candidateClip of boardClips) {
      if (clipCount >= MAX_STORE_CLIPS) break;
      const clip = normalizeClip(candidateClip);
      if (!clip || clipIds.has(clip.id)) continue;
      clipIds.add(clip.id);
      clips[board.id].push(clip);
      clipCount += 1;
    }
  }

  return { ...candidate, boards, clips };
}

module.exports = {
  createDefaultStore,
  normalizeStore,
};

function createDefaultStore(now = Date.now()) {
  return {
    boards: [{ id: 'default', name: 'Schowek', createdAt: now }],
    clips: { default: [] },
  };
}

function normalizeStore(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Store root must be an object');
  }

  const boards = Array.isArray(candidate.boards) ? candidate.boards : [];
  const rawClips = candidate.clips && typeof candidate.clips === 'object' && !Array.isArray(candidate.clips)
    ? candidate.clips
    : {};
  const clips = { ...rawClips };

  for (const board of boards) {
    if (board && typeof board.id === 'string' && !Array.isArray(clips[board.id])) {
      clips[board.id] = [];
    }
  }

  return { ...candidate, boards, clips };
}

module.exports = {
  createDefaultStore,
  normalizeStore,
};

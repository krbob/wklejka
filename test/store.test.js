const assert = require('node:assert/strict');
const test = require('node:test');
const { createDefaultStore, normalizeStore } = require('../lib/store');

test('createDefaultStore creates the default board deterministically', () => {
  assert.deepEqual(createDefaultStore(123), {
    boards: [{ id: 'default', name: 'Schowek', createdAt: 123 }],
    clips: { default: [] },
  });
});

test('normalizeStore fills missing clip arrays for known boards', () => {
  const input = {
    boards: [{ id: 'default' }, { id: 'work' }],
    clips: { default: [{ id: 'c1' }] },
  };

  const normalized = normalizeStore(input);

  assert.deepEqual(normalized.clips.default, [{ id: 'c1' }]);
  assert.deepEqual(normalized.clips.work, []);
  assert.equal(input.clips.work, undefined);
});

test('normalizeStore restores exactly one default board when valid custom boards exist', () => {
  const normalized = normalizeStore({
    boards: [{ id: 'work', name: 'Work' }, { id: 'work', name: 'Duplicate' }],
    clips: { work: [{ id: 'c1', type: 'text', content: 'kept' }] },
  }, 123);

  assert.deepEqual(normalized.boards, [
    { id: 'default', name: 'Schowek', createdAt: 123 },
    { id: 'work', name: 'Work' },
  ]);
  assert.equal(normalized.boards.filter(board => board.id === 'default').length, 1);
  assert.deepEqual(normalized.clips.default, []);
  assert.deepEqual(normalized.clips.work, [{ id: 'c1', type: 'text', content: 'kept' }]);
});

test('normalizeStore replaces invalid board and clip roots with empty collections', () => {
  const normalized = normalizeStore({ boards: 'bad', clips: [] });

  assert.deepEqual(normalized.boards, []);
  assert.deepEqual(normalized.clips, {});
});

test('normalizeStore rejects invalid store roots', () => {
  assert.throws(() => normalizeStore(null), /Store root/);
  assert.throws(() => normalizeStore('bad'), /Store root/);
});

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

test('normalizeStore replaces invalid board and clip roots with empty collections', () => {
  const normalized = normalizeStore({ boards: 'bad', clips: [] });

  assert.deepEqual(normalized.boards, []);
  assert.deepEqual(normalized.clips, {});
});

test('normalizeStore rejects invalid store roots', () => {
  assert.throws(() => normalizeStore(null), /Store root/);
  assert.throws(() => normalizeStore('bad'), /Store root/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DurableStoreWriter } = require('../lib/durable-store');

async function temporaryStore(t) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wklejka-writer-'));
  const file = path.join(directory, 'store.json');
  const backupFile = path.join(directory, 'store.json.bak');
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return { backupFile, directory, file };
}

test('DurableStoreWriter coalesces snapshots, writes a backup, and closes cleanly', async (t) => {
  const paths = await temporaryStore(t);
  await fs.promises.writeFile(paths.file, '{"version":0}');
  const states = [];
  const writer = new DurableStoreWriter({
    file: paths.file,
    backupFile: paths.backupFile,
    debounceMs: 2,
    maxWaitMs: 10,
    onStateChange(status) { states.push(status); },
  });

  const first = writer.enqueue({ version: 1 });
  const second = writer.enqueue({ version: 2 });
  assert.equal(writer.status().pending, true);
  await Promise.all([first, second]);

  assert.deepEqual(JSON.parse(await fs.promises.readFile(paths.file, 'utf8')), { version: 2 });
  assert.deepEqual(JSON.parse(await fs.promises.readFile(paths.backupFile, 'utf8')), { version: 0 });
  assert.equal(writer.status().ready, true);
  assert.equal(writer.status().pending, false);
  assert.equal(typeof writer.status().lastSuccessAt, 'number');
  assert.ok(states.some(status => status.pending));

  await writer.flush();
  await writer.close();
  await assert.rejects(
    writer.enqueue({ version: 3 }),
    error => Boolean(error && typeof error === 'object' && 'code' in error
      && error.code === 'STORE_WRITER_CLOSED'),
  );
});

test('DurableStoreWriter exposes a write failure and becomes ready after a later success', async (t) => {
  const paths = await temporaryStore(t);
  const displacedDirectory = `${paths.directory}.offline`;
  const writer = new DurableStoreWriter({
    file: paths.file,
    backupFile: paths.backupFile,
    debounceMs: 1,
    maxWaitMs: 2,
    onStateChange() {
      // Notification failures must not affect persistence callers.
      throw new Error('observer failed');
    },
  });

  await fs.promises.rename(paths.directory, displacedDirectory);
  await fs.promises.writeFile(paths.directory, 'unavailable mount');
  try {
    await assert.rejects(
      writer.enqueue({ version: 'failed' }),
      error => Boolean(error && typeof error === 'object' && 'code' in error
        && error.code === 'ENOTDIR'),
    );
    const failed = writer.status();
    assert.equal(failed.ready, false);
    assert.equal(failed.pending, false);
    assert.equal(failed.lastError.code, 'ENOTDIR');
    assert.equal(typeof failed.lastError.at, 'number');
  } finally {
    await fs.promises.unlink(paths.directory);
    await fs.promises.rename(displacedDirectory, paths.directory);
  }

  await writer.enqueue({ version: 'recovered' });
  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(paths.file, 'utf8')),
    { version: 'recovered' },
  );
  assert.equal(writer.status().ready, true);
  assert.equal(writer.status().lastError, null);
  await writer.close();
});

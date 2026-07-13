const fs = require('fs');
const path = require('path');

class DurableStoreWriter {
  constructor({
    file,
    backupFile,
    debounceMs = 20,
    maxWaitMs = 200,
    onStateChange = (_status) => {},
  }) {
    this.file = file;
    this.backupFile = backupFile;
    this.directory = path.dirname(file);
    this.debounceMs = debounceMs;
    this.maxWaitMs = Math.max(debounceMs, maxWaitMs);
    this.onStateChange = onStateChange;
    this.pending = null;
    this.debounceTimer = null;
    this.maxWaitTimer = null;
    this.writePromise = null;
    this.lastError = null;
    this.lastSuccessAt = null;
    this.closed = false;
    this.sequence = 0;
  }

  enqueue(data) {
    if (this.closed) {
      return Promise.reject(Object.assign(new Error('Store writer is closed'), { code: 'STORE_WRITER_CLOSED' }));
    }

    const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return new Promise((resolve, reject) => {
      if (!this.pending) this.pending = { data: serialized, waiters: [] };
      this.pending.data = serialized;
      this.pending.waiters.push({ resolve, reject });
      this.#schedule();
      this.#notify();
    });
  }

  status() {
    return {
      ready: !this.lastError,
      pending: Boolean(this.pending || this.writePromise),
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError ? {
        code: this.lastError.code || 'STORE_WRITE_FAILED',
        message: this.lastError.message,
        at: this.lastError.at,
      } : null,
    };
  }

  async flush() {
    this.#clearTimers();
    while (this.pending || this.writePromise) {
      if (this.pending && !this.writePromise) this.#startWrite();
      if (this.writePromise) await this.writePromise;
    }
    if (this.lastError) {
      throw Object.assign(new Error(this.lastError.message), {
        code: this.lastError.code || 'STORE_WRITE_FAILED',
      });
    }
  }

  async close() {
    await this.flush();
    this.closed = true;
    this.#notify();
  }

  #schedule() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.#startWrite(), this.debounceMs);
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => this.#startWrite(), this.maxWaitMs);
    }
  }

  #clearTimers() {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxWaitTimer);
    this.debounceTimer = null;
    this.maxWaitTimer = null;
  }

  #startWrite() {
    if (this.writePromise || !this.pending) return;
    this.#clearTimers();
    const batch = this.pending;
    this.pending = null;

    const write = this.#writeAtomic(batch.data);
    this.writePromise = write
      .then(() => {
        this.lastError = null;
        this.lastSuccessAt = Date.now();
        for (const waiter of batch.waiters) waiter.resolve();
      })
      .catch((error) => {
        this.lastError = { ...error, message: error.message, code: error.code, at: Date.now() };
        for (const waiter of batch.waiters) waiter.reject(error);
      })
      .finally(() => {
        this.writePromise = null;
        this.#notify();
        if (this.pending) this.#schedule();
      });
    this.#notify();
  }

  async #writeAtomic(data) {
    const suffix = `${process.pid}-${Date.now()}-${this.sequence++}`;
    const tempFile = path.join(
      this.directory,
      `.store-${suffix}.tmp`,
    );
    const backupTempFile = path.join(this.directory, `.store-backup-${suffix}.tmp`);
    let handle;
    try {
      handle = await fs.promises.open(tempFile, 'wx', 0o600);
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = null;

      try {
        await fs.promises.copyFile(this.file, backupTempFile);
        await fs.promises.rename(backupTempFile, this.backupFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.promises.unlink(backupTempFile).catch(() => {});
      }
      await fs.promises.rename(tempFile, this.file);

      try {
        const directoryHandle = await fs.promises.open(this.directory, 'r');
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      } catch {
        // Directory fsync is best-effort on platforms that do not support it.
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(tempFile).catch(() => {});
      await fs.promises.unlink(backupTempFile).catch(() => {});
      throw error;
    }
  }

  #notify() {
    try { this.onStateChange(this.status()); } catch {}
  }
}

module.exports = { DurableStoreWriter };

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clientAddress,
  compileTrustProxy,
  parseTrustProxy,
} = require('../lib/proxy');

function req(remoteAddress, forwardedFor) {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress },
  };
}

test('parseTrustProxy handles booleans, hop counts, and named ranges', () => {
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('off'), false);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});

test('clientAddress uses numeric trusted proxy hop count for WebSocket requests', () => {
  const trustProxy = compileTrustProxy(parseTrustProxy('1'));

  assert.equal(
    clientAddress(req('10.0.0.2', '198.51.100.10'), trustProxy),
    '198.51.100.10'
  );
});

test('clientAddress honors named trusted proxy ranges for WebSocket requests', () => {
  const trustProxy = compileTrustProxy(parseTrustProxy('loopback'));

  assert.equal(
    clientAddress(req('127.0.0.1', '198.51.100.10'), trustProxy),
    '198.51.100.10'
  );
});

test('clientAddress ignores spoofed X-Forwarded-For from untrusted sockets', () => {
  const trustProxy = compileTrustProxy(parseTrustProxy('loopback'));

  assert.equal(
    clientAddress(req('203.0.113.44', '198.51.100.10'), trustProxy),
    '203.0.113.44'
  );
});

test('clientAddress falls back to socket address when proxy trust is disabled', () => {
  assert.equal(
    clientAddress(req('203.0.113.44', '198.51.100.10'), compileTrustProxy(false)),
    '203.0.113.44'
  );
});

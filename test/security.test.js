const assert = require('node:assert/strict');
const test = require('node:test');
const { isPrivateAddress } = require('../lib/security');

test('isPrivateAddress blocks private and non-routable IPv4 ranges', () => {
  [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.2.1',
    '192.168.1.10',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
  ].forEach(address => assert.equal(isPrivateAddress(address), true, address));
});

test('isPrivateAddress allows public IPv4 addresses', () => {
  [
    '1.1.1.1',
    '8.8.8.8',
    '172.32.0.1',
    '192.0.3.1',
  ].forEach(address => assert.equal(isPrivateAddress(address), false, address));
});

test('isPrivateAddress blocks private and documentation IPv6 ranges', () => {
  [
    '::',
    '::1',
    '::ffff:192.168.1.1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ].forEach(address => assert.equal(isPrivateAddress(address), true, address));
});

test('isPrivateAddress allows public IPv6 addresses', () => {
  [
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ].forEach(address => assert.equal(isPrivateAddress(address), false, address));
});

test('isPrivateAddress ignores invalid input', () => {
  [
    null,
    undefined,
    42,
    '999.0.0.1',
    'not-an-ip',
  ].forEach(address => assert.equal(isPrivateAddress(address), false, String(address)));
});

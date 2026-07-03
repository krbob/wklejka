const proxyaddr = require('proxy-addr');

function parseTrustProxy(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (!normalized || ['false', '0', 'off', 'no'].includes(normalized)) return false;
  if (['true', 'on', 'yes'].includes(normalized)) return true;
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  return raw;
}

function compileTrustProxy(value) {
  if (!value) return null;
  if (value === true) return () => true;
  if (typeof value === 'number') return (_address, index) => index < value;
  if (typeof value === 'string') {
    return proxyaddr.compile(value.split(',').map(part => part.trim()).filter(Boolean));
  }
  return null;
}

function forwardedClientAddress(req, trustProxyFn) {
  if (!trustProxyFn) return null;
  try {
    return proxyaddr(req, trustProxyFn);
  } catch {
    return null;
  }
}

function clientAddress(req, trustProxyFn) {
  return req.ip
    || forwardedClientAddress(req, trustProxyFn)
    || req.socket?.remoteAddress
    || req.connection?.remoteAddress
    || 'unknown';
}

module.exports = {
  clientAddress,
  compileTrustProxy,
  forwardedClientAddress,
  parseTrustProxy,
};

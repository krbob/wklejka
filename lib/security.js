const net = require('net');

function parseIpv4(address) {
  if (typeof address !== 'string') return false;
  const rawParts = address.split('.');
  if (
    rawParts.length !== 4
    || rawParts.some(part => !/^(?:0|[1-9]\d{0,2})$/.test(part))
  ) return null;
  const parts = rawParts.map(Number);
  return parts.some(part => part > 255) ? null : parts;
}

function isPrivateIpv4(address) {
  const parts = parseIpv4(address);
  if (!parts) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
    || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || parts[0] === 0
    || parts[0] >= 224;
}

function parseIpv6(address) {
  if (typeof address !== 'string') return null;
  let normalized = address.toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) normalized = normalized.slice(0, zoneIndex);

  const lastColon = normalized.lastIndexOf(':');
  const ipv4Tail = normalized.slice(lastColon + 1);
  if (ipv4Tail.includes('.')) {
    const ipv4 = parseIpv4(ipv4Tail);
    if (!ipv4) return null;
    normalized = `${normalized.slice(0, lastColon)}:${(
      (ipv4[0] << 8) | ipv4[1]
    ).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const compression = normalized.indexOf('::');
  if (compression !== -1 && compression !== normalized.lastIndexOf('::')) return null;
  const left = (compression === -1 ? normalized : normalized.slice(0, compression))
    .split(':')
    .filter(Boolean);
  const right = (compression === -1 ? '' : normalized.slice(compression + 2))
    .split(':')
    .filter(Boolean);
  if (
    [...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))
    || (compression === -1 && left.length !== 8)
    || (compression !== -1 && left.length + right.length >= 8)
  ) return null;

  const zeroCount = compression === -1 ? 0 : 8 - left.length - right.length;
  return [
    ...left.map(part => Number.parseInt(part, 16)),
    ...Array(zeroCount).fill(0),
    ...right.map(part => Number.parseInt(part, 16)),
  ];
}

function allZero(parts, start, end) {
  return parts.slice(start, end).every(part => part === 0);
}

function isPrivateIpv6(address) {
  const parts = parseIpv6(address);
  if (!parts) return false;

  const ipv4Mapped = allZero(parts, 0, 5) && parts[5] === 0xffff;
  if (ipv4Mapped) {
    return isPrivateIpv4([
      parts[6] >> 8,
      parts[6] & 0xff,
      parts[7] >> 8,
      parts[7] & 0xff,
    ].join('.'));
  }

  const unspecifiedOrLoopback = allZero(parts, 0, 7) && parts[7] <= 1;
  const uniqueLocal = (parts[0] & 0xfe00) === 0xfc00;
  const linkLocal = (parts[0] & 0xffc0) === 0xfe80;
  const siteLocal = (parts[0] & 0xffc0) === 0xfec0;
  const multicast = (parts[0] & 0xff00) === 0xff00;
  const discardOnly = parts[0] === 0x0100 && allZero(parts, 1, 4);
  const nat64WellKnown = parts[0] === 0x0064
    && parts[1] === 0xff9b
    && allZero(parts, 2, 6);
  const nat64Local = parts[0] === 0x0064 && parts[1] === 0xff9b && parts[2] === 1;
  const documentation = parts[0] === 0x2001 && parts[1] === 0x0db8;
  const benchmarking = parts[0] === 0x2001 && parts[1] === 2 && parts[2] === 0;

  return unspecifiedOrLoopback
    || uniqueLocal
    || linkLocal
    || siteLocal
    || multicast
    || discardOnly
    || nat64WellKnown
    || nat64Local
    || documentation
    || benchmarking;
}

function isPrivateAddress(address) {
  if (typeof address !== 'string') return false;
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

module.exports = {
  isPrivateAddress,
  isPrivateIpv4,
  isPrivateIpv6,
};

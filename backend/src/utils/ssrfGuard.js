// SSRF guard.
//
// URL preview and link unfurling is one of the most commonly exploited SSRF
// entry points in existence. On a cloud host it reaches 169.254.169.254 — the
// instance metadata service — and that is credential disclosure, not a
// information leak.
//
// THE BUG EVERY NAIVE IMPLEMENTATION HAS: validate the hostname, then hand the
// URL to an HTTP client. The client re-resolves DNS, and between the check and
// the connection the attacker's nameserver returns 127.0.0.1. That is DNS
// rebinding — a time-of-check/time-of-use race — and hostname allowlisting
// cannot close it.
//
// THE FIX: resolve the hostname ourselves, validate the RESULTING IP, then
// connect to that exact IP with the Host header set manually. The client never
// resolves anything, so there is no second lookup to poison.
//
// Everything here is pure or DNS-only and is exported for testing, because a
// guard nobody can test is a guard nobody should trust.
//
// Reference: OWASP SSRF Prevention Cheat Sheet.

const dns = require('dns').promises;
const net = require('net');

// http and https only. `file:` reads the disk, `gopher:` can forge arbitrary
// TCP payloads (including Redis and SMTP commands), and `data:` smuggles
// content past every network control.
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * IPv4 ranges that must never be reachable.
 *
 * 169.254.0.0/16 is the one that matters most: it covers the cloud metadata
 * endpoint on AWS, GCP, Azure and DigitalOcean alike.
 */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — CLOUD METADATA LIVES HERE
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

const v4ToInt = (ip) =>
  ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;

const inV4Range = (ip, [network, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(network) & mask);
};

/**
 * Is this IPv6 address forbidden?
 *
 * The IPv4-mapped forms matter as much as the native ranges: `::ffff:127.0.0.1`
 * is loopback wearing a different hat, and a v4-only check misses it entirely.
 */
const isBlockedV6 = (ip) => {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (address === '::' || address === '::1') return true; // unspecified, loopback

  // IPv4-mapped and IPv4-compatible: ::ffff:127.0.0.1, ::127.0.0.1
  const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped) return isBlockedIp(mapped[2]);

  // Some resolvers emit the mapped form in hex: ::ffff:7f00:1
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const asV4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    return isBlockedIp(asV4);
  }

  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(address)) return true; // ff00::/8 multicast
  if (address.startsWith('64:ff9b:')) return true; // NAT64 — reaches v4 space
  if (address.startsWith('2002:')) return true; // 6to4 — embeds a v4 address

  return false;
};

/** Is this literal IP forbidden? Exported — it is the core of the guard. */
const isBlockedIp = (ip) => {
  if (typeof ip !== 'string' || !ip) return true; // unknown means blocked

  const version = net.isIP(ip);
  if (version === 4) return BLOCKED_V4.some((range) => inV4Range(ip, range));
  if (version === 6) return isBlockedV6(ip);
  return true; // not an IP at all
};

/**
 * Parse and structurally validate a URL.
 *
 * Rejects credentials in the URL (`http://user:pass@host`) because they are
 * both a phishing vector in a rendered preview and a way to confuse naive
 * host parsing. Rejects non-default ports outside a small allowlist, since
 * `http://internal-host:6379/` is how SSRF reaches Redis.
 */
const parseUrl = (raw, { allowedPorts = [80, 443, 8080, 8443] } = {}) => {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch (error) {
    return { ok: false, reason: 'malformed' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!allowedPorts.includes(port)) return { ok: false, reason: 'port' };

  // A bare IP in the URL skips DNS entirely, so check it here too.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) return { ok: false, reason: 'private_ip' };

  // Trailing-dot hostnames ("evil.com.") bypass suffix matching in some
  // allowlist implementations while resolving identically.
  if (url.hostname.endsWith('.')) return { ok: false, reason: 'malformed' };

  return { ok: true, url, port, host };
};

/**
 * Resolve a hostname and return only addresses that pass the IP check.
 *
 * ALL resolved addresses must be safe, not just one. A host that returns both
 * a public and a private address is a rebinding attempt, and picking the safe
 * one would still let the connection land wherever the OS chose.
 */
const resolveSafely = async (hostname, { lookup = null } = {}) => {
  if (net.isIP(hostname)) {
    return isBlockedIp(hostname)
      ? { ok: false, reason: 'private_ip' }
      : { ok: true, addresses: [hostname] };
  }

  let records;
  try {
    records = lookup
      ? await lookup(hostname)
      : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    return { ok: false, reason: 'dns' };
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => (typeof record === 'string' ? record : record.address))
    .filter(Boolean);

  if (!addresses.length) return { ok: false, reason: 'dns' };
  if (addresses.some(isBlockedIp)) return { ok: false, reason: 'private_ip' };

  return { ok: true, addresses };
};

/**
 * Full validation: parse, then resolve, then approve a specific IP to connect to.
 *
 * The returned `address` is what the caller must connect to. Handing the
 * hostname back to an HTTP client instead would reintroduce the rebinding race
 * this whole module exists to close.
 */
const validate = async (raw, options = {}) => {
  const parsed = parseUrl(raw, options);
  if (!parsed.ok) return parsed;

  const resolved = await resolveSafely(parsed.host, options);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    url: parsed.url,
    host: parsed.host,
    port: parsed.port,
    address: resolved.addresses[0],
    addresses: resolved.addresses,
  };
};

// Reasons are internal. A caller that reflects them to the user turns the
// endpoint into an internal port scanner: "dns" versus "private_ip" versus
// "timeout" tells an attacker exactly what exists behind the firewall.
const PUBLIC_ERROR = 'That link could not be loaded';

const describeInternal = (reason) =>
  ({
    malformed: 'URL could not be parsed',
    scheme: 'scheme not allowed',
    credentials: 'URL contains credentials',
    port: 'port not allowed',
    private_ip: 'resolves to a private or reserved address',
    dns: 'DNS resolution failed',
    redirect: 'redirect target failed validation',
    too_many_redirects: 'redirect limit exceeded',
    too_large: 'response exceeded the size cap',
    timeout: 'request timed out',
  }[reason] || 'rejected');

module.exports = {
  validate,
  parseUrl,
  resolveSafely,
  isBlockedIp,
  isBlockedV6,
  inV4Range,
  v4ToInt,
  ALLOWED_SCHEMES,
  BLOCKED_V4,
  PUBLIC_ERROR,
  describeInternal,
};

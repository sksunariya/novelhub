// SSRF guard, and the child-safety pipeline's refusal to publish unscanned.
//
// Every case below is a published bypass technique. A guard that passes the
// obvious cases and fails these is worse than none, because it creates
// confidence without protection.

const ssrfGuard = require('../src/utils/ssrfGuard');
const linkPreview = require('../src/services/community/linkPreviewService');
const hashMatch = require('../src/services/safety/hashMatchService');
const ChildSafetyIncident = require('../src/models/ChildSafetyIncident');

describe('blocked IP ranges', () => {
  const BLOCKED = [
    ['127.0.0.1', 'loopback'],
    ['127.1.1.1', 'loopback, non-obvious form'],
    ['0.0.0.0', 'this network'],
    ['10.0.0.1', 'RFC1918'],
    ['172.16.0.1', 'RFC1918 lower bound'],
    ['172.31.255.255', 'RFC1918 upper bound'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.169.254', 'CLOUD METADATA — the one that matters most'],
    ['169.254.0.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
  ];

  const ALLOWED = [
    ['8.8.8.8', 'public DNS'],
    ['1.1.1.1', 'public DNS'],
    ['172.32.0.1', 'just outside RFC1918'],
    ['172.15.255.255', 'just below RFC1918'],
    ['93.184.216.34', 'example.com'],
  ];

  it.each(BLOCKED)('blocks %s (%s)', (ip) => {
    expect(ssrfGuard.isBlockedIp(ip)).toBe(true);
  });

  it.each(ALLOWED)('allows %s (%s)', (ip) => {
    expect(ssrfGuard.isBlockedIp(ip)).toBe(false);
  });

  it('gets the RFC1918 boundaries exactly right', () => {
    // Off-by-one in a CIDR mask is how 172.16/12 becomes 172.16/16 and half the
    // private range becomes reachable.
    expect(ssrfGuard.isBlockedIp('172.15.255.255')).toBe(false);
    expect(ssrfGuard.isBlockedIp('172.16.0.0')).toBe(true);
    expect(ssrfGuard.isBlockedIp('172.31.255.255')).toBe(true);
    expect(ssrfGuard.isBlockedIp('172.32.0.0')).toBe(false);
  });

  it('treats anything unparseable as blocked', () => {
    // Fail closed. An address the guard cannot classify is not an address it
    // should connect to.
    for (const value of ['', null, undefined, 'not-an-ip', '999.999.999.999', {}, 42]) {
      expect(ssrfGuard.isBlockedIp(value)).toBe(true);
    }
  });
});

describe('IPv6 — including the forms that wrap IPv4', () => {
  const BLOCKED = [
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback in hex'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['2002:7f00:0001::', '6to4 wrapping loopback'],
    ['64:ff9b::7f00:1', 'NAT64 reaching IPv4 space'],
  ];

  it.each(BLOCKED)('blocks %s (%s)', (ip) => {
    expect(ssrfGuard.isBlockedIp(ip)).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(ssrfGuard.isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('handles bracketed forms', () => {
    expect(ssrfGuard.isBlockedIp('[::1]')).toBe(true);
  });
});

describe('URL structural validation', () => {
  const reject = (url, reason) => {
    const result = ssrfGuard.parseUrl(url);
    expect(result.ok).toBe(false);
    if (reason) expect(result.reason).toBe(reason);
  };

  it('allows only http and https', () => {
    reject('file:///etc/passwd', 'scheme');
    reject('gopher://host/_command', 'scheme'); // can forge Redis/SMTP payloads
    reject('data:text/html,<script>x</script>', 'scheme');
    reject('ftp://host/', 'scheme');
    reject('jar:http://host!/', 'scheme');
    expect(ssrfGuard.parseUrl('https://example.com/').ok).toBe(true);
    expect(ssrfGuard.parseUrl('http://example.com/').ok).toBe(true);
  });

  it('rejects credentials in the URL', () => {
    // Both a phishing vector in a rendered preview and a way to confuse naive
    // host parsing: http://expected.com@evil.com/
    reject('http://user:pass@example.com/', 'credentials');
    reject('http://user@example.com/', 'credentials');
  });

  it('rejects ports outside the allowlist', () => {
    // http://internal:6379/ is how SSRF reaches Redis.
    reject('http://example.com:6379/', 'port');
    reject('http://example.com:22/', 'port');
    reject('http://example.com:11211/', 'port');
    expect(ssrfGuard.parseUrl('http://example.com:8080/').ok).toBe(true);
  });

  it('rejects a literal private address in the URL', () => {
    reject('http://169.254.169.254/latest/meta-data/', 'private_ip');
    reject('http://127.0.0.1:8080/', 'private_ip');
    reject('https://[::1]/', 'private_ip');
  });

  it('rejects a trailing-dot hostname', () => {
    // "evil.com." resolves identically but bypasses suffix matching in many
    // allowlist implementations.
    reject('https://evil.com./', 'malformed');
  });

  it('rejects malformed input without throwing', () => {
    for (const value of ['', 'not a url', '///', null, undefined]) {
      expect(ssrfGuard.parseUrl(value).ok).toBe(false);
    }
  });
});

describe('DNS resolution — the rebinding defence', () => {
  const lookupReturning = (addresses) => async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('rejects a hostname that resolves to a private address', () => {
    // The core rebinding case: the name looks fine, the answer does not.
    return expect(
      ssrfGuard.resolveSafely('evil.com', { lookup: lookupReturning(['127.0.0.1']) })
    ).resolves.toMatchObject({ ok: false, reason: 'private_ip' });
  });

  it('rejects when ANY resolved address is private, not just the first', () => {
    // A host answering with both a public and a private address is a rebinding
    // attempt. Picking the safe one still lets the OS choose the other.
    return expect(
      ssrfGuard.resolveSafely('evil.com', { lookup: lookupReturning(['93.184.216.34', '169.254.169.254']) })
    ).resolves.toMatchObject({ ok: false, reason: 'private_ip' });
  });

  it('accepts a hostname that resolves entirely to public addresses', async () => {
    const result = await ssrfGuard.resolveSafely('example.com', {
      lookup: lookupReturning(['93.184.216.34']),
    });
    expect(result.ok).toBe(true);
    expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('rejects a DNS failure rather than proceeding', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await ssrfGuard.resolveSafely('nope.invalid', { lookup: failing })).toMatchObject({
      ok: false,
      reason: 'dns',
    });
  });

  it('rejects an empty answer', async () => {
    expect(await ssrfGuard.resolveSafely('nope.invalid', { lookup: async () => [] })).toMatchObject({
      ok: false,
      reason: 'dns',
    });
  });

  it('returns a specific address to connect to', async () => {
    // This is what closes the race. The caller connects to THIS, never to the
    // hostname — so the client performs no second lookup to be poisoned.
    const result = await ssrfGuard.validate('https://example.com/page', {
      lookup: lookupReturning(['93.184.216.34']),
    });
    expect(result.ok).toBe(true);
    expect(result.address).toBe('93.184.216.34');
    expect(result.host).toBe('example.com');
  });
});

describe('fetchPreview refuses dangerous targets', () => {
  // These never reach the network — the guard rejects before any socket opens.
  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'private_ip'],
    ['http://127.0.0.1:8080/admin', 'private_ip'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://internal/_x', 'scheme'],
    ['http://user:pass@example.com/', 'credentials'],
    ['http://example.com:6379/', 'port'],
  ])('refuses %s', async (url, reason) => {
    const result = await linkPreview.fetchPreview(url, { timeoutMs: 200 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it('keeps failure reasons internal', () => {
    // Reflecting "dns" vs "private_ip" vs "timeout" to a user turns the preview
    // endpoint into an internal port scanner.
    expect(ssrfGuard.PUBLIC_ERROR).toBe('That link could not be loaded');
    expect(ssrfGuard.PUBLIC_ERROR).not.toMatch(/private|dns|timeout|port/i);
    expect(ssrfGuard.describeInternal('private_ip')).toMatch(/private or reserved/);
  });
});

describe('preview metadata extraction', () => {
  it('prefers OpenGraph over the title tag', () => {
    const html = '<head><title>Fallback</title><meta property="og:title" content="Real"></head>';
    expect(linkPreview.extractMeta(html).title).toBe('Real');
  });

  it('falls back to the title tag', () => {
    expect(linkPreview.extractMeta('<head><title>Only This</title></head>').title).toBe('Only This');
  });

  it('handles attributes in either order', () => {
    const html = '<meta content="Reversed" property="og:description">';
    expect(linkPreview.extractMeta(html).description).toBe('Reversed');
  });

  it('decodes entities', () => {
    const html = '<meta property="og:title" content="Tom &amp; Jerry &lt;3">';
    expect(linkPreview.extractMeta(html).title).toBe('Tom & Jerry <3');
  });

  it('caps extracted lengths', () => {
    const html = `<meta property="og:title" content="${'x'.repeat(2000)}">`;
    expect(linkPreview.extractMeta(html).title.length).toBeLessThanOrEqual(300);
  });

  it('returns empty strings rather than throwing on junk', () => {
    for (const html of ['', '<html>', 'not html at all']) {
      expect(() => linkPreview.extractMeta(html)).not.toThrow();
    }
  });
});

describe('child safety pipeline', () => {
  afterEach(() => hashMatch.resetProvider());

  it('refuses to run an image pipeline with no scanner configured', () => {
    // "Not configured" must not behave like "clean". This is the guard that
    // stops months of unscanned uploads going unnoticed.
    expect(() => hashMatch.assertReady({ allowUnscanned: false })).toThrow(/no CSAM scanning provider/);
  });

  it('allows an explicit development override', () => {
    expect(hashMatch.assertReady({ allowUnscanned: true })).toBe(true);
  });

  it('reports unavailable rather than clean with no provider', async () => {
    const result = await hashMatch.scan(Buffer.from('image-bytes'));
    expect(result.available).toBe(false);
    expect(result.matched).toBe(false); // but `available` is what callers check
  });

  it('reports unavailable when the provider throws', async () => {
    // A vendor outage must fail the upload, never wave it through.
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    hashMatch.setProvider({
      name: 'broken',
      match: async () => {
        throw new Error('vendor down');
      },
    });
    const result = await hashMatch.scan(Buffer.from('x'));
    expect(result.available).toBe(false);
    silence.mockRestore();
  });

  it('hashes deterministically', () => {
    const a = hashMatch.sha256Of(Buffer.from('same'));
    expect(a).toBe(hashMatch.sha256Of(Buffer.from('same')));
    expect(a).not.toBe(hashMatch.sha256Of(Buffer.from('different')));
    expect(a).toHaveLength(64);
  });
});

describe('ChildSafetyIncident is a preservation record, not a moderation record', () => {
  it('cannot be deleted by any route', () => {
    // A moderator must not be able to delete their way out of a legal
    // preservation obligation. deleteMany is included because that is what a
    // bulk cleanup script reaches for.
    const hooks = ChildSafetyIncident.schema.s.hooks._pres;
    for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete']) {
      expect(hooks.get(op)).toBeDefined();
    }
  });

  it('is not soft-deletable either', () => {
    expect(ChildSafetyIncident.schema.paths.deletedAt).toBeUndefined();
  });

  it('preserves everything the statute requires', () => {
    // 18 U.S.C. § 2258A: content, metadata, uploader account info, IP address.
    for (const field of ['sha256', 'storageKey', 'uploader', 'uploaderSnapshot.username', 'ipAddress', 'userAgent']) {
      expect(ChildSafetyIncident.schema.path(field)).toBeDefined();
    }
  });

  it('indexes the hash so a re-upload is caught without a vendor call', () => {
    const specs = ChildSafetyIncident.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ sha256: 1 }));
  });

  it('does not default a preservation expiry', () => {
    // Preserved material is released by a documented decision, never by a
    // retention sweep that happens to run.
    expect(ChildSafetyIncident.schema.paths.preservationUntil.defaultValue).toBeNull();
  });
});

describe('S3 key layout', () => {
  const mediaKeys = require('../src/services/community/mediaKeys');
  const at = new Date('2026-08-15T00:00:00Z');

  it('puts the space at the root so purging one is a single prefix delete', () => {
    // The dominant bulk operation is "this space was deleted/banned/purged".
    // Date-first would make that a full-bucket scan.
    const key = mediaKeys.postMedia({ spaceId: 'SP1', postId: 'PO1', assetId: 'AS1', mime: 'image/jpeg', at });
    expect(key).toBe('spaces/SP1/posts/2026/08/PO1/AS1.jpg');
    expect(key.startsWith(mediaKeys.prefixes.space('SP1'))).toBe(true);
  });

  it('keeps a post’s objects under one prefix', () => {
    const prefix = mediaKeys.prefixes.post('SP1', 'PO1', at);
    for (const key of [
      mediaKeys.postMedia({ spaceId: 'SP1', postId: 'PO1', assetId: 'AS1', mime: 'image/png', at }),
      mediaKeys.postMediaThumb({ spaceId: 'SP1', postId: 'PO1', assetId: 'AS1', mime: 'image/webp', at }),
    ]) {
      expect(key.startsWith(prefix)).toBe(true);
    }
  });

  it('date-partitions posts so lifecycle rules can target a period', () => {
    expect(mediaKeys.datePart(new Date('2026-01-05T00:00:00Z'))).toBe('2026/01');
    expect(mediaKeys.datePart(new Date('2026-12-31T23:59:59Z'))).toBe('2026/12');
  });

  it('content-addresses icons, banners and avatars', () => {
    // They are replaced repeatedly, and the old URL must stop resolving to the
    // new image. A content hash means a change yields a new key, so
    // Cache-Control: immutable is safe and nothing needs invalidating.
    const a = Buffer.from('image-one');
    const b = Buffer.from('image-two');
    expect(mediaKeys.spaceIcon({ spaceId: 'SP1', buffer: a, mime: 'image/png' }))
      .toBe(mediaKeys.spaceIcon({ spaceId: 'SP1', buffer: a, mime: 'image/png' }));
    expect(mediaKeys.spaceIcon({ spaceId: 'SP1', buffer: a, mime: 'image/png' }))
      .not.toBe(mediaKeys.spaceIcon({ spaceId: 'SP1', buffer: b, mime: 'image/png' }));
  });

  it('separates drafts, which have no post yet, from attached media', () => {
    const key = mediaKeys.draftMedia({ userId: 'US1', assetId: 'AS1', mime: 'image/png', at });
    expect(key).toBe('spaces/drafts/2026/08/US1/AS1.png');
    expect(key.startsWith(mediaKeys.prefixes.allDrafts())).toBe(true);
  });

  it('keeps quarantine on its own prefix, for the private bucket area', () => {
    expect(mediaKeys.quarantine({ incidentId: 'IN1', mime: 'image/jpeg', at }))
      .toBe('spaces/quarantine/2026/08/IN1.jpg');
  });

  it('derives the extension from the MIME type, never the filename', () => {
    // The filename is user input. "photo.jpg" containing a GIF would produce a
    // key that lies about its contents.
    expect(mediaKeys.extFor('image/webp')).toBe('webp');
    expect(mediaKeys.extFor('image/jpeg')).toBe('jpg');
    expect(mediaKeys.extFor('application/x-msdownload')).toBe('bin');
  });

  it('marks objects immutable', () => {
    expect(mediaKeys.CACHE_CONTROL).toContain('immutable');
    expect(mediaKeys.CACHE_CONTROL).toContain('max-age=31536000');
  });
});

describe('media pipeline ordering', () => {
  const mediaService = require('../src/services/community/mediaService');

  it('reports honestly when sharp is absent rather than silently skipping EXIF', async () => {
    // An unstripped phone photo carries GPS coordinates. Degrading silently
    // would publish someone's home address without anyone noticing.
    if (mediaService.loadSharp()) return;
    const result = await mediaService.processImage(Buffer.from('not-a-real-image'), {
      mime: 'image/jpeg',
      limits: { stripExif: true, generateThumbnails: true, thumbnailWidth: 640 },
    });
    expect(result.exifStripped).toBe(false);
    expect(result.degraded).toMatch(/sharp is not installed/);
    expect(result.thumb).toBeNull();
  });
});

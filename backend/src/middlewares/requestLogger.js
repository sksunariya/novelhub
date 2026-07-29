const crypto = require('crypto');

// Dependency-free, color-coded HTTP request logger.
// Logs one comprehensive line per finished request plus indented detail lines
// (user, query, body, files, error) when they carry information.
//
// Env toggles:
//   REQUEST_LOG=off  -> disable entirely
//   NO_COLOR         -> disable ANSI colors (standard, https://no-color.org)
//   FORCE_COLOR      -> force ANSI colors even when stdout is not a TTY

const ENABLED = process.env.REQUEST_LOG !== 'off';
const COLOR = !('NO_COLOR' in process.env) && ('FORCE_COLOR' in process.env || process.stdout.isTTY === true);

const paint = (text, ...codes) =>
  COLOR && codes.length ? `\x1b[${codes.join(';')}m${text}\x1b[0m` : String(text);

const C = { reset: 0, bold: 1, dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90 };

const METHOD_CODES = {
  GET: [C.green],
  POST: [C.yellow],
  PUT: [C.blue],
  PATCH: [C.cyan],
  DELETE: [C.red],
  HEAD: [C.gray],
  OPTIONS: [C.gray],
};

const statusCodes = (s) => {
  if (s >= 500) return [C.red, C.bold];
  if (s >= 400) return [C.yellow, C.bold];
  if (s >= 300) return [C.cyan];
  if (s >= 200) return [C.green];
  return [C.gray];
};

const durationCodes = (ms) => (ms >= 1000 ? [C.red] : ms >= 300 ? [C.yellow] : [C.green]);

// Keys whose values must never be logged (matched case-insensitively).
const REDACT_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'confirmpassword', 'oldpassword',
  'otp', 'code', 'token', 'accesstoken', 'refreshtoken', 'authorization', 'secret', 'pin',
]);

const MAX_STRING = 500; // truncate long values (e.g. pasted chapter HTML)
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

const sanitize = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (+${value.length - MAX_STRING} chars)` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const arr = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1));
    if (value.length > MAX_ARRAY) arr.push(`… (+${value.length - MAX_ARRAY} more)`);
    return arr;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v, depth + 1);
  }
  return out;
};

const hasKeys = (obj) => obj && typeof obj === 'object' && Object.keys(obj).length > 0;

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
};

const timestamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const detail = (label, value) => `    ${paint(label.padEnd(6), C.dim)} ${value}`;

const requestLogger = (req, res, next) => {
  if (!ENABLED) return next();

  req.id = req.id || crypto.randomBytes(3).toString('hex');
  const startedAt = process.hrtime.bigint();

  // Capture the response payload so error responses can be logged.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals._responseBody = body;
    return originalJson(body);
  };

  let done = false;
  const log = (aborted) => {
    if (done) return;
    done = true;
    try {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const status = aborted ? 499 : res.statusCode;

      const method = paint(req.method.padEnd(6), ...(METHOD_CODES[req.method] || [C.magenta]));
      const statusStr = paint(String(status).padStart(3), ...statusCodes(status));
      const durStr = paint(`${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`.padStart(7), ...durationCodes(ms));

      const lenHeader = Number(res.getHeader('content-length'));
      const size = paint(formatBytes(Number.isFinite(lenHeader) ? lenHeader : NaN).padStart(7), C.gray);

      const ip = req.ip || req.socket?.remoteAddress || '-';
      const reqId = paint(`#${req.id}`, C.dim);
      const abortedTag = aborted ? ` ${paint('[aborted]', C.red)}` : '';

      const lines = [
        `${paint(timestamp(), C.dim)} ${method} ${statusStr} ${durStr} ${size}  ${req.originalUrl} ${paint(`· ${ip}`, C.dim)} ${reqId}${abortedTag}`,
      ];

      if (req.user) {
        const u = req.user;
        lines.push(detail('user', `${u._id} ${paint(`${u.email || u.username || ''}`.trim(), C.cyan)} ${paint(`(${u.role || 'user'})`, C.dim)}`));
      }
      if (hasKeys(req.query)) lines.push(detail('query', JSON.stringify(sanitize(req.query))));
      if (hasKeys(req.body)) lines.push(detail('body', JSON.stringify(sanitize(req.body))));

      const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : req.file ? [req.file] : [];
      if (files.length) {
        const summary = files.map((f) => `${f.originalname} (${f.mimetype}, ${formatBytes(f.size)})`);
        lines.push(detail('files', JSON.stringify(summary)));
      }

      if (status >= 400) {
        const body = res.locals._responseBody;
        const message = body && typeof body === 'object' ? body.message || body.error : typeof body === 'string' ? body : undefined;
        if (message) lines.push(detail('error', paint(String(message).slice(0, MAX_STRING), status >= 500 ? C.red : C.yellow)));
      }

      const write = status >= 500 ? console.error : console.log;
      write(lines.join('\n'));
    } catch (err) {
      console.error('requestLogger failed:', err.message);
    }
  };

  res.on('finish', () => log(false));
  res.on('close', () => {
    if (!res.writableEnded) log(true); // client aborted before the response finished
  });

  next();
};

module.exports = requestLogger;

// GENERATED FILE - DO NOT EDIT.
//
// Source: backend/src/utils/emailList.js
// Regenerate: cd backend && node scripts/buildEmailListMirror.js
//
// This copy exists so the admin portal can validate a pasted list or an
// uploaded CSV as it is typed, with no round trip. It is a preview only: the
// server re-parses the same input on dispatch and its counts are the real
// ones. Edit the backend file and rerun the generator.

// Chosen with the 5,000-recipient dispatch cap in mind: the whole list travels
// as JSON in one request, and the in-process email queue works through it on a
// single instance. Raise both together, or move to a durable queue first.
const MAX_RECIPIENTS = 5000;

// RFC 5321 limits. A longer address is refused by the receiving MTA anyway, so
// catching it here turns a silent bounce into a visible error at compose time.
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_LABEL_LENGTH = 63;

// How many bad entries to hand back for display. The count is always exact;
// only the sample is capped, so pasting a 4,000-row junk file cannot blow up
// the response or the admin's browser.
const INVALID_SAMPLE_LIMIT = 50;

// Invisible characters that survive a copy-paste out of Word, Excel, Google
// Sheets or a mail client and would otherwise make a valid address fail
// validation for no reason a human can see. Written as escapes deliberately:
// a literal zero-width space in source is invisible to the next reader too.
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

// Local part per RFC 5322 dot-atom: no leading/trailing dot, no "..".
const LOCAL_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;

/**
 * Strip the decoration people paste around an address and lower-case it.
 *
 * Handles: "Ada Lovelace <ada@x.com>", <ada@x.com>, "ada@x.com" (quoted),
 * mailto:ada@x.com, Excel's text-forcing leading apostrophe, non-breaking
 * spaces, and a trailing . or ; left behind by a sentence or a mail client.
 *
 * Lower-casing the local part is technically lossy - RFC 5321 lets it be
 * case-sensitive - but no mail provider in practice treats it that way, and
 * folding is what makes "Bob@x.com" and "bob@x.com" dedupe to one send.
 */
const normalizeEmail = (raw) => {
  if (raw === null || raw === undefined) return '';
  let value = String(raw);

  value = value.replace(INVISIBLE_CHARS, '').replace(UNICODE_SPACES, ' ').trim();
  if (!value) return '';

  // "Ada Lovelace <ada@x.com>" / "<ada@x.com>" -> take what is inside.
  const angled = value.match(/<([^<>]*)>/);
  if (angled) value = angled[1].trim();

  value = value.replace(/^mailto:/i, '').trim();

  // Excel writes a leading apostrophe to force a cell to text.
  value = value.replace(/^'+/, '').trim();

  // Surrounding quotes, but not the RFC quoted-local-part form ("a b"@x.com),
  // which we reject as invalid below rather than silently mangling.
  if (value.length > 1 && /^(["'])(.*)\1$/.test(value) && !/"@/.test(value)) {
    value = value.slice(1, -1).trim();
  }

  // Sentence punctuation that rode along on the last entry of a paste.
  value = value.replace(/[.,;:]+$/, '').trim();

  return value.toLowerCase();
};

const isValidDomain = (domain) => {
  if (!domain || domain.length > 253) return false;
  // No bare hostnames and no IP-literal / bracketed forms: a marketing list
  // wants deliverable public addresses, and "user@localhost" is neither.
  if (!domain.includes('.') || domain.startsWith('[')) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;

  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH) return false;
    if (label.startsWith('-') || label.endsWith('-')) return false;
    if (!/^[a-z0-9-]+$/.test(label)) return false;
  }

  // TLD: letters only, at least two. Rules out "user@example.c" and
  // "user@1.2.3.4" without needing a public-suffix list.
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && /^[a-z]+$/.test(tld);
};

/**
 * Validate an already-normalized address. Deliberately stricter than the
 * grammar in RFC 5322 - the exotic forms it permits (quoted locals, comments,
 * IP literals) never appear on a real marketing list, and letting them through
 * only produces bounces.
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  if (email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;

  // Exactly one @, and neither side empty.
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length > MAX_LOCAL_LENGTH) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!local.split('.').every((atom) => LOCAL_ATOM.test(atom))) return false;

  return isValidDomain(domain);
};

const isBlankToken = (raw) =>
  !String(raw === null || raw === undefined ? '' : raw)
    .replace(INVISIBLE_CHARS, '')
    .replace(UNICODE_SPACES, ' ')
    .trim();

/**
 * Accumulates candidates from either parser, keeping the first spelling of each
 * address and counting - not listing - the repeats.
 */
const createCollector = () => {
  const seen = new Set();
  const emails = [];
  const invalid = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let totalFound = 0;

  return {
    add(rawValue, line) {
      // A token that is empty once trimmed is not an entry at all - a trailing
      // comma or a blank CSV row is normal input, not an error to report.
      if (isBlankToken(rawValue)) return;

      const raw = String(rawValue);
      totalFound += 1;
      const normalized = normalizeEmail(raw);

      if (!isValidEmail(normalized)) {
        invalidCount += 1;
        if (invalid.length < INVALID_SAMPLE_LIMIT) {
          invalid.push({ value: raw.trim().slice(0, 120), line: line || null });
        }
        return;
      }

      if (seen.has(normalized)) {
        duplicateCount += 1;
        return;
      }

      seen.add(normalized);
      emails.push(normalized);
    },
    result() {
      return { emails, invalid, invalidCount, duplicateCount, totalFound };
    },
  };
};

/**
 * Parse a pasted list of addresses.
 *
 * Separators: comma, semicolon, newline (LF or CRLF), tab - and plain spaces,
 * which is how a list arrives when someone copies a "To:" line. Space handling
 * is applied per token rather than globally so "Ada Lovelace <ada@x.com>"
 * survives as one entry instead of splitting into three.
 */
const parseEmailList = (text) => {
  const collector = createCollector();
  if (!text || typeof text !== 'string') return collector.result();

  // Line numbers make the invalid list actionable on a long paste.
  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    line.split(/[,;\t]+/).forEach((token) => {
      const trimmed = token.trim();
      if (!trimmed) return;

      // Keep display-name forms intact; split anything else on whitespace so a
      // space-separated paste is not read as one malformed address.
      if (trimmed.includes('<') || !/\s/.test(trimmed)) {
        collector.add(trimmed, lineNumber);
        return;
      }
      trimmed.split(/\s+/).forEach((part) => collector.add(part, lineNumber));
    });
  });

  return collector.result();
};

/**
 * Split one CSV line into fields, honouring RFC 4180 quoting: quoted fields may
 * contain the delimiter, and "" inside a quoted field is a literal quote.
 * Written by hand rather than pulled from a dependency - this is the whole of
 * the CSV grammar we need, and the file has to stay copyable to the frontend.
 */
const splitCsvLine = (line, delimiter) => {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    // A quote only opens a quoted field at the start of one; a stray quote
    // mid-value (O"Brien) is data, not syntax.
    if (char === '"' && current.trim() === '') {
      inQuotes = true;
      current = '';
      continue;
    }
    if (char === delimiter) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
};

/**
 * Split CSV text into records, keeping a newline that sits inside a quoted
 * field attached to its row. Without this, one quoted multi-line cell (a
 * "notes" column out of a CRM export) shifts every row after it.
 */
const splitCsvRows = (text) => {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      rows.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  rows.push(current);
  return rows;
};

// Excel on a European locale writes semicolons; some exports use tabs. Guessing
// from the first meaningful row beats forcing the admin to know or care.
const detectDelimiter = (rows) => {
  const sample = rows.find((row) => row.trim()) || '';
  const counts = [
    { delimiter: ',', count: (sample.match(/,/g) || []).length },
    { delimiter: ';', count: (sample.match(/;/g) || []).length },
    { delimiter: '\t', count: (sample.match(/\t/g) || []).length },
  ].sort((a, b) => b.count - a.count);

  return counts[0].count > 0 ? counts[0].delimiter : ',';
};

const HEADER_EMAIL_NAMES = /^(e[-_\s]?mail(\s*(address|id))?|address|recipient|to)$/i;

/**
 * Parse the text of an uploaded CSV.
 *
 * Layout is auto-detected rather than mandated, because the two files admins
 * actually have are "one address per line, no header" and "a spreadsheet export
 * with an Email column somewhere among others":
 *   1. A header row naming an email column -> read only that column, so a
 *      "backup_email" or "manager" column is never mailed by accident.
 *   2. No recognisable header -> scan every cell and take the addresses, which
 *      makes a bare one-column list work with no ceremony.
 * A header row is only skipped when it is genuinely a header (contains no valid
 * address), so a headerless file never loses its first recipient.
 */
const parseEmailCsv = (text) => {
  const collector = createCollector();
  if (!text || typeof text !== 'string') return collector.result();

  // A UTF-8 BOM is what Excel's "CSV UTF-8" writes; left in place it corrupts
  // the first header cell and, in a headerless file, the first address.
  const cleaned = text.replace(/^﻿/, '');
  if (!cleaned.trim()) return collector.result();

  const rows = splitCsvRows(cleaned);
  const delimiter = detectDelimiter(rows);

  let emailColumn = -1;
  let startRow = 0;

  const firstIndex = rows.findIndex((row) => row.trim());
  if (firstIndex !== -1) {
    const headerCells = splitCsvLine(rows[firstIndex], delimiter);
    const rowHasAddress = headerCells.some((cell) => isValidEmail(normalizeEmail(cell)));

    if (!rowHasAddress) {
      // No address in row 1, so it is a header (or junk) either way - skipping
      // it costs nothing, and naming the column buys precision.
      const named = headerCells.findIndex((cell) =>
        HEADER_EMAIL_NAMES.test(cell.replace(INVISIBLE_CHARS, '').replace(/^["']|["']$/g, '').trim())
      );
      if (named !== -1) emailColumn = named;
      startRow = firstIndex + 1;
    }
  }

  for (let i = startRow; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.trim()) continue; // blank line between records, or a trailing newline

    const cells = splitCsvLine(row, delimiter);
    const lineNumber = i + 1;

    if (emailColumn !== -1) {
      // A short row (fewer columns than the header) yields undefined here,
      // which the collector treats as empty rather than as a bad address.
      collector.add(cells[emailColumn], lineNumber);
      continue;
    }

    // No named column: take every cell that is an address, and report the row
    // once if it contained none, so a mis-shaped file is visible rather than
    // silently contributing nothing.
    const addresses = cells.filter((cell) => isValidEmail(normalizeEmail(cell)));
    if (addresses.length > 0) {
      addresses.forEach((cell) => collector.add(cell, lineNumber));
    } else {
      collector.add(cells.find((cell) => cell.trim()) || '', lineNumber);
    }
  }

  return collector.result();
};

/**
 * Merge several parse results (a paste plus one or more CSVs) into one
 * recipient list, deduplicating across sources as well as within each.
 */
const mergeParseResults = (...results) => {
  const sources = results.filter(Boolean);
  const collector = createCollector();
  const invalid = [];
  let invalidCount = 0;
  let totalFound = 0;
  let duplicateCount = 0;

  sources.forEach((result) => {
    (result.emails || []).forEach((email) => collector.add(email, null));
    invalid.push(...(result.invalid || []));
    invalidCount += result.invalidCount || 0;
    totalFound += result.totalFound || 0;
    duplicateCount += result.duplicateCount || 0;
  });

  const merged = collector.result();
  return {
    emails: merged.emails,
    invalid: invalid.slice(0, INVALID_SAMPLE_LIMIT),
    invalidCount,
    // Repeats within a single source, plus those found across sources.
    duplicateCount: duplicateCount + merged.duplicateCount,
    totalFound,
  };
};

export {
  MAX_RECIPIENTS,
  MAX_EMAIL_LENGTH,
  INVALID_SAMPLE_LIMIT,
  normalizeEmail,
  isValidEmail,
  parseEmailList,
  parseEmailCsv,
  mergeParseResults,
};

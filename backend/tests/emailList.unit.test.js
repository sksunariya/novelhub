// Parser for the admin marketing audience: a pasted address list or an
// uploaded CSV. Pure functions, no database — the cases below are the ones a
// real paste and a real spreadsheet export actually produce.

const {
  normalizeEmail,
  isValidEmail,
  parseEmailList,
  parseEmailCsv,
  mergeParseResults,
  MAX_RECIPIENTS,
} = require('../src/utils/emailList');

const emailsOf = (result) => result.emails;

describe('normalizeEmail', () => {
  it('lower-cases and trims', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('unwraps the display-name form a mail client pastes', () => {
    expect(normalizeEmail('Ada Lovelace <Ada@Example.com>')).toBe('ada@example.com');
    expect(normalizeEmail('<ada@example.com>')).toBe('ada@example.com');
  });

  it('drops a mailto: prefix', () => {
    expect(normalizeEmail('mailto:ada@example.com')).toBe('ada@example.com');
    expect(normalizeEmail('MAILTO:Ada@Example.com')).toBe('ada@example.com');
  });

  it("strips Excel's text-forcing apostrophe and surrounding quotes", () => {
    expect(normalizeEmail("'ada@example.com")).toBe('ada@example.com');
    expect(normalizeEmail('"ada@example.com"')).toBe('ada@example.com');
  });

  it('strips trailing sentence punctuation', () => {
    expect(normalizeEmail('ada@example.com.')).toBe('ada@example.com');
    expect(normalizeEmail('ada@example.com;')).toBe('ada@example.com');
  });

  it('strips invisible characters that survive a copy-paste', () => {
    expect(normalizeEmail('ada@example.com​')).toBe('ada@example.com');
    expect(normalizeEmail('﻿ada@example.com')).toBe('ada@example.com');
    expect(normalizeEmail('ada@example.com ')).toBe('ada@example.com');
  });

  it('is safe on empty and non-string input', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail('   ')).toBe('');
  });
});

describe('isValidEmail', () => {
  it.each([
    'ada@example.com',
    'ada.lovelace@example.co.uk',
    'ada+news@example.com',
    'a@b.io',
    "o'hara@example.com",
    'ada_lovelace@sub.example.com',
    'ada-99@example-host.com',
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    ['no at sign', 'ada.example.com'],
    ['two at signs', 'ada@@example.com'],
    ['nothing before the at', '@example.com'],
    ['nothing after the at', 'ada@'],
    ['no dot in the domain', 'ada@localhost'],
    ['single-letter TLD', 'ada@example.c'],
    ['numeric TLD', 'ada@1.2.3.4'],
    ['leading dot in local', '.ada@example.com'],
    ['trailing dot in local', 'ada.@example.com'],
    ['consecutive dots', 'ada..lovelace@example.com'],
    ['inner whitespace', 'ada lovelace@example.com'],
    ['underscore in domain', 'ada@exa_mple.com'],
    ['hyphen at a label edge', 'ada@-example.com'],
    ['empty domain label', 'ada@example..com'],
    ['bracketed IP literal', 'ada@[192.168.0.1]'],
  ])('rejects %s', (_label, email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('rejects an address past the RFC 5321 length limit', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
    expect(isValidEmail(`${'a'.repeat(65)}@example.com`)).toBe(false); // local part cap
  });
});

describe('parseEmailList', () => {
  it('splits on a comma, with or without a space', () => {
    expect(emailsOf(parseEmailList('a@abc.com,b@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com, b@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com ,   b@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('splits on new lines, whichever line ending arrives', () => {
    expect(emailsOf(parseEmailList('a@abc.com\nb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com\r\nb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com\rb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('handles a comma followed by a new line, and both together', () => {
    expect(emailsOf(parseEmailList('a@abc.com,\nb@abc.com,\r\nc@abc.com'))).toEqual([
      'a@abc.com',
      'b@abc.com',
      'c@abc.com',
    ]);
  });

  it('also accepts semicolons, tabs and plain spaces as separators', () => {
    expect(emailsOf(parseEmailList('a@abc.com; b@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com\tb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
    expect(emailsOf(parseEmailList('a@abc.com b@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('ignores empty entries from doubled or trailing separators', () => {
    const result = parseEmailList(',,a@abc.com,,\n\n,b@abc.com,\n   \n');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('keeps a display name attached to its address instead of splitting on the space', () => {
    const result = parseEmailList('Ada Lovelace <ada@abc.com>, Grace Hopper <grace@abc.com>');
    expect(emailsOf(result)).toEqual(['ada@abc.com', 'grace@abc.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('deduplicates case-insensitively and counts the repeats', () => {
    const result = parseEmailList('a@abc.com, A@ABC.COM, a@abc.com, b@abc.com');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.duplicateCount).toBe(2);
  });

  it('reports malformed entries with the line they came from', () => {
    const result = parseEmailList('a@abc.com\nnot-an-email\nb@abc.com\nbad@');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.invalidCount).toBe(2);
    expect(result.invalid).toEqual([
      { value: 'not-an-email', line: 2 },
      { value: 'bad@', line: 4 },
    ]);
  });

  it('splits a space-separated line into separate entries, good or bad', () => {
    // The flip side of accepting spaces as a separator: "also bad@" is two
    // entries, not one. Deliberate — a pasted "To:" line is far more common
    // than an address with a space in it, which is invalid anyway.
    const result = parseEmailList('also bad@');
    expect(result.invalidCount).toBe(2);
    expect(result.invalid.map((entry) => entry.value)).toEqual(['also', 'bad@']);
  });

  it('counts every bad entry but only samples the first 50', () => {
    const result = parseEmailList(Array.from({ length: 120 }, (_, i) => `bad-${i}`).join(','));
    expect(result.invalidCount).toBe(120);
    expect(result.invalid).toHaveLength(50);
    expect(emailsOf(result)).toEqual([]);
  });

  it('survives empty, blank and non-string input', () => {
    expect(emailsOf(parseEmailList(''))).toEqual([]);
    expect(emailsOf(parseEmailList('   \n  '))).toEqual([]);
    expect(emailsOf(parseEmailList(null))).toEqual([]);
    expect(emailsOf(parseEmailList(undefined))).toEqual([]);
    expect(emailsOf(parseEmailList(42))).toEqual([]);
  });

  it('parses the messy paste this feature exists for', () => {
    const pasted = [
      'a@abc.com,   b@abc.com',
      '',
      '  c@abc.com ;d@abc.com,',
      'Ada Lovelace <e@abc.com>',
      'mailto:F@ABC.COM',
      'oops',
      'a@abc.com',
    ].join('\n');

    const result = parseEmailList(pasted);
    expect(emailsOf(result)).toEqual([
      'a@abc.com',
      'b@abc.com',
      'c@abc.com',
      'd@abc.com',
      'e@abc.com',
      'f@abc.com',
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.invalidCount).toBe(1);
  });
});

describe('parseEmailCsv', () => {
  it('reads a single column with an email header', () => {
    expect(emailsOf(parseEmailCsv('email\na@abc.com\nb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('reads a bare list with no header at all, keeping the first row', () => {
    expect(emailsOf(parseEmailCsv('a@abc.com\nb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('strips the UTF-8 BOM Excel writes, so the header still matches', () => {
    expect(emailsOf(parseEmailCsv('﻿email\na@abc.com'))).toEqual(['a@abc.com']);
    // And in a headerless file, where the BOM would corrupt the first address.
    expect(emailsOf(parseEmailCsv('﻿a@abc.com\nb@abc.com'))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('handles CRLF line endings', () => {
    expect(emailsOf(parseEmailCsv('email\r\na@abc.com\r\nb@abc.com\r\n'))).toEqual([
      'a@abc.com',
      'b@abc.com',
    ]);
  });

  it.each([['Email'], ['E-mail'], ['email address'], ['EMAIL_ADDRESS'], ['Recipient']])(
    'recognises %s as the address column',
    (header) => {
      expect(emailsOf(parseEmailCsv(`name,${header}\nAda,a@abc.com`))).toEqual(['a@abc.com']);
    }
  );

  it('reads only the named column, so a second address column is not mailed', () => {
    const csv = ['name,email,backup_email', 'Ada,a@abc.com,personal@abc.com'].join('\n');
    expect(emailsOf(parseEmailCsv(csv))).toEqual(['a@abc.com']);
  });

  it('handles a quoted field containing the delimiter', () => {
    const csv = ['name,email', '"Lovelace, Ada",a@abc.com'].join('\n');
    expect(emailsOf(parseEmailCsv(csv))).toEqual(['a@abc.com']);
  });

  it('handles escaped quotes inside a quoted field', () => {
    const csv = ['name,email', '"Ada ""The Countess"" Lovelace",a@abc.com'].join('\n');
    expect(emailsOf(parseEmailCsv(csv))).toEqual(['a@abc.com']);
  });

  it('keeps rows intact when a quoted field spans several lines', () => {
    const csv = ['name,email', '"Ada\nLovelace",a@abc.com', 'Grace,b@abc.com'].join('\n');
    expect(emailsOf(parseEmailCsv(csv))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('detects a semicolon-delimited export', () => {
    expect(emailsOf(parseEmailCsv('name;email\nAda;a@abc.com\nGrace;b@abc.com'))).toEqual([
      'a@abc.com',
      'b@abc.com',
    ]);
  });

  it('detects a tab-delimited export', () => {
    expect(emailsOf(parseEmailCsv('name\temail\nAda\ta@abc.com'))).toEqual(['a@abc.com']);
  });

  it('skips blank rows and a trailing newline without reporting them', () => {
    const result = parseEmailCsv('email\n\na@abc.com\n\n\nb@abc.com\n');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('treats a row with no value in the email column as absent, not malformed', () => {
    const result = parseEmailCsv('name,email\nAda,a@abc.com\nGrace,\nAlan,b@abc.com');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('tolerates a short row with fewer columns than the header', () => {
    const result = parseEmailCsv('name,email,city\nAda,a@abc.com,London\nGrace');
    expect(emailsOf(result)).toEqual(['a@abc.com']);
    expect(result.invalidCount).toBe(0);
  });

  it('falls back to scanning every column when the header names no email column', () => {
    const csv = ['first,contact', 'Ada,a@abc.com', 'Grace,b@abc.com'].join('\n');
    expect(emailsOf(parseEmailCsv(csv))).toEqual(['a@abc.com', 'b@abc.com']);
  });

  it('reports a row that contains no address at all', () => {
    const result = parseEmailCsv('first,contact\nAda,a@abc.com\nGrace,not-an-email');
    expect(emailsOf(result)).toEqual(['a@abc.com']);
    expect(result.invalidCount).toBe(1);
    expect(result.invalid[0]).toEqual({ value: 'Grace', line: 3 });
  });

  it('deduplicates across rows', () => {
    const result = parseEmailCsv('email\na@abc.com\nA@ABC.COM\nb@abc.com');
    expect(emailsOf(result)).toEqual(['a@abc.com', 'b@abc.com']);
    expect(result.duplicateCount).toBe(1);
  });

  it("strips Excel's leading apostrophe from a text-formatted cell", () => {
    expect(emailsOf(parseEmailCsv("email\n'a@abc.com"))).toEqual(['a@abc.com']);
  });

  it('returns nothing for an empty or whitespace-only file', () => {
    expect(emailsOf(parseEmailCsv(''))).toEqual([]);
    expect(emailsOf(parseEmailCsv('\n\n  \n'))).toEqual([]);
    expect(emailsOf(parseEmailCsv(null))).toEqual([]);
  });

  it('returns nothing but reports the rows for a header-only file', () => {
    const result = parseEmailCsv('email\n');
    expect(emailsOf(result)).toEqual([]);
    expect(result.invalidCount).toBe(0);
  });
});

describe('mergeParseResults', () => {
  it('deduplicates across sources and sums what each dropped', () => {
    const pasted = parseEmailList('a@abc.com, b@abc.com, nope');
    const csv = parseEmailCsv('email\nB@ABC.COM\nc@abc.com\nalso-nope');

    const merged = mergeParseResults(pasted, csv);
    expect(merged.emails).toEqual(['a@abc.com', 'b@abc.com', 'c@abc.com']);
    expect(merged.invalidCount).toBe(2);
    // b@abc.com appears in both sources.
    expect(merged.duplicateCount).toBe(1);
  });

  it('ignores missing sources', () => {
    const merged = mergeParseResults(parseEmailList('a@abc.com'), null, undefined);
    expect(merged.emails).toEqual(['a@abc.com']);
  });

  it('returns an empty result when given nothing', () => {
    expect(mergeParseResults().emails).toEqual([]);
  });
});

describe('MAX_RECIPIENTS', () => {
  it('is the cap the controller and the admin portal both enforce', () => {
    expect(MAX_RECIPIENTS).toBe(5000);
  });
});

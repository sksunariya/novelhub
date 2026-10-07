const {
  normaliseSubmission,
  normaliseStatusChange,
  buildQueueFilter,
  CATEGORY_LABELS,
} = require('../src/services/chapterIssueService');
const {
  CHAPTER_ISSUE_CATEGORIES,
  CHAPTER_ISSUE_LIMITS,
  ADMIN_MODULES,
} = require('../src/config/constants');

describe('chapter issue submission', () => {
  it('accepts a known category with no details', () => {
    const out = normaliseSubmission({ category: 'missing_content' });
    expect(out.category).toBe('missing_content');
    expect(out.details).toBe('');
    expect(out.quote).toBe('');
  });

  it('rejects an unknown or missing category', () => {
    expect(() => normaliseSubmission({ category: 'spam' })).toThrow(/kind of problem/);
    expect(() => normaliseSubmission({})).toThrow(/kind of problem/);
  });

  it('requires a description for "other"', () => {
    expect(() => normaliseSubmission({ category: 'other', details: '  ' })).toThrow(/describe/);
    expect(normaliseSubmission({ category: 'other', details: 'Images are missing' }).details).toBe('Images are missing');
  });

  it('trims, strips control characters and caps lengths', () => {
    const out = normaliseSubmission({
      category: 'typos',
      details: `  bad\u0000 text\r\n\n\n\nmore  ${'x'.repeat(5000)}`,
      quote: 'q'.repeat(2000),
    });
    expect(out.details.startsWith('bad text\n\nmore')).toBe(true);
    expect(out.details.length).toBe(CHAPTER_ISSUE_LIMITS.DETAILS_MAX);
    expect(out.quote.length).toBe(CHAPTER_ISSUE_LIMITS.QUOTE_MAX);
  });

  it('clamps and filters the reading context', () => {
    const out = normaliseSubmission({
      category: 'formatting',
      context: { progress: 140.6, fontSize: 'abc', viewport: '390x844', theme: 'sepia', font: 'serif' },
    });
    expect(out.context).toEqual({ progress: 100, theme: 'sepia', font: 'serif', fontSize: null, viewport: '390x844' });
    expect(normaliseSubmission({ category: 'formatting', context: { viewport: '<script>' } }).context.viewport).toBe('');
    expect(normaliseSubmission({ category: 'formatting', context: 'nope' }).context.progress).toBeNull();
  });
});

describe('chapter issue status change', () => {
  it('notifies by default only when closing', () => {
    expect(normaliseStatusChange({ status: 'resolved' }).notify).toBe(true);
    expect(normaliseStatusChange({ status: 'dismissed', notify: false }).notify).toBe(false);
    expect(normaliseStatusChange({ status: 'in_progress' }).notify).toBe(false);
    expect(normaliseStatusChange({ status: 'open' }).notify).toBe(false);
  });

  it('rejects unknown statuses', () => {
    expect(() => normaliseStatusChange({ status: 'deleted' })).toThrow(/Unknown status/);
  });
});

describe('chapter issue queue filter', () => {
  it('treats "all" as no status filter', () => {
    expect(buildQueueFilter({ status: 'all' })).toEqual({});
  });

  it('rejects malformed ids and values instead of passing them to Mongo', () => {
    expect(() => buildQueueFilter({ novel: 'x' })).toThrow(/Invalid novel/);
    expect(() => buildQueueFilter({ category: 'nope' })).toThrow(/Unknown category/);
    expect(() => buildQueueFilter({ status: { $ne: 'x' } })).toThrow(/Unknown status/);
  });

  it('escapes regex characters in search', () => {
    const filter = buildQueueFilter({ search: 'a.b(' });
    expect(filter.$or[0].details.test('a.b(')).toBe(true);
    expect(filter.$or[0].details.test('axb(')).toBe(false);
  });
});

describe('chapter issue registry', () => {
  it('labels every category', () => {
    for (const { key, label } of CHAPTER_ISSUE_CATEGORIES) {
      expect(label).toBeTruthy();
      expect(CATEGORY_LABELS[key]).toBe(label);
    }
  });

  it('has an admin module for the queue', () => {
    const module = ADMIN_MODULES.find((m) => m.id === 'chapter_reports');
    expect(module).toBeTruthy();
    expect(module.superOnly).toBeFalsy();
  });
});

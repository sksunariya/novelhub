const {
  serializeChapter,
  serializeChapterRef,
  serializeChapterListItem,
  serializeNovel,
  serializeNovelRef,
  serializeWallet,
  serializeTransaction,
} = require('../src/utils/serializers');

// Pure whitelists — the layer that stops a new model field leaking by default.
// Every assertion about what is ABSENT is the point of the file.

const rawChapter = {
  _id: 'c1',
  novel: 'n1',
  number: 12,
  title: 'The Descent',
  content: '<p>text</p>',
  views: 40,
  ratingAvg: 4.5,
  ratingCount: 9,
  wordCount: 2200,
  publishedAt: new Date('2026-01-02'),
  createdAt: new Date('2025-11-01'),
  updatedAt: new Date('2026-01-03'),
  // Everything below must never reach a reader.
  sourceFile: { key: 'private/secret.docx', name: 'ch12.docx', size: 100, contentType: 'x' },
  priceCredits: 15,
  accessType: 'paid',
  freeAfterDays: 30,
  earlyAccessUntil: new Date('2026-02-01'),
  revenueLifetimeUsdMicros: 4821000,
  originalNumber: 12,
  deletedAt: null,
};

describe('serializeChapter', () => {
  it('returns only the whitelisted reader fields', () => {
    expect(Object.keys(serializeChapter(rawChapter)).sort()).toEqual(
      [
        'content', 'createdAt', 'id', 'novel', 'number', 'publishedAt',
        'ratingAvg', 'ratingCount', 'title', 'updatedAt', 'views', 'wordCount',
      ].sort()
    );
  });

  it('never exposes the private source file key', () => {
    const json = JSON.stringify(serializeChapter(rawChapter));
    expect(json).not.toContain('private/secret.docx');
    expect(json).not.toContain('sourceFile');
  });

  it('never exposes internal pricing or revenue', () => {
    const out = serializeChapter(rawChapter);
    expect(out.priceCredits).toBeUndefined();
    expect(out.accessType).toBeUndefined();
    expect(out.revenueLifetimeUsdMicros).toBeUndefined();
    expect(out.earlyAccessUntil).toBeUndefined();
  });

  it('omits content when asked, for list contexts', () => {
    expect(serializeChapter(rawChapter, { includeContent: false }).content).toBeUndefined();
    expect(serializeChapter(rawChapter).content).toBe('<p>text</p>');
  });

  it('falls back to createdAt when a chapter predates publishedAt tracking', () => {
    const legacy = { ...rawChapter, publishedAt: null };
    expect(serializeChapter(legacy).publishedAt).toEqual(rawChapter.createdAt);
  });

  it('handles a null chapter', () => {
    expect(serializeChapter(null)).toBeNull();
  });
});

describe('serializeChapterRef', () => {
  it('carries only what a gate payload needs', () => {
    expect(serializeChapterRef(rawChapter)).toEqual({ id: 'c1', number: 12, title: 'The Descent' });
  });

  it('never carries content, even by accident', () => {
    expect(serializeChapterRef(rawChapter).content).toBeUndefined();
  });

  it('handles null', () => {
    expect(serializeChapterRef(null)).toBeNull();
  });
});

describe('serializeChapterListItem', () => {
  it('omits access state when none is supplied', () => {
    const out = serializeChapterListItem(rawChapter);
    expect(out.locked).toBeUndefined();
    expect(out.priceCredits).toBeUndefined();
    expect(out.content).toBeUndefined();
  });

  it('merges access state when supplied', () => {
    const out = serializeChapterListItem(rawChapter, {
      locked: true,
      owned: false,
      free: false,
      priceCredits: 15,
    });
    expect(out).toMatchObject({ number: 12, locked: true, owned: false, free: false, priceCredits: 15 });
  });

  it('defaults price to zero rather than undefined', () => {
    expect(serializeChapterListItem(rawChapter, { free: true }).priceCredits).toBe(0);
  });

  it('includes availableAt only during an early-access window', () => {
    const at = new Date('2026-02-01');
    expect(serializeChapterListItem(rawChapter, { locked: true }).availableAt).toBeUndefined();
    expect(serializeChapterListItem(rawChapter, { locked: true, availableAt: at }).availableAt).toEqual(at);
  });

  it('coerces access flags to booleans', () => {
    const out = serializeChapterListItem(rawChapter, { locked: undefined, owned: null });
    expect(out.locked).toBe(false);
    expect(out.owned).toBe(false);
  });
});

describe('serializeNovel', () => {
  const rawNovel = {
    _id: 'n1',
    title: 'Ashfall',
    slug: 'ashfall',
    author: 'A. Writer',
    synopsis: 'dark things',
    coverUrl: '/c.jpg',
    genres: ['Fantasy'],
    tags: ['magic'],
    status: 'ongoing',
    featured: true,
    views: 900,
    ratingAvg: 4.2,
    ratingCount: 30,
    chapterCount: 80,
    lastChapterAt: new Date('2026-08-01'),
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2026-08-01'),
    revenueLifetimeUsdMicros: 12345678,
    authorUser: 'u9',
    monetization: {
      override: true,
      monetized: true,
      freeChapterCount: 5,
      accessMode: 'permanent',
      defaultChapterPriceCredits: 12,
      revenueShare: { enabled: true, author: 'author1', sharePct: 70 },
    },
  };

  it('never exposes revenue share or lifetime revenue', () => {
    const json = JSON.stringify(serializeNovel(rawNovel));
    expect(json).not.toContain('sharePct');
    expect(json).not.toContain('revenueShare');
    expect(json).not.toContain('12345678');
    expect(json).not.toContain('authorUser');
  });

  it('exposes only reader-relevant monetization', () => {
    const out = serializeNovel(rawNovel);
    expect(out.monetization).toEqual({ monetized: true, freeChapterCount: 5, accessMode: 'permanent' });
    expect(out.monetization.defaultChapterPriceCredits).toBeUndefined();
  });

  it('hides novel-level overrides when the novel does not override', () => {
    const inherited = { ...rawNovel, monetization: { ...rawNovel.monetization, override: false } };
    const out = serializeNovel(inherited);
    expect(out.monetization.freeChapterCount).toBeUndefined();
    expect(out.monetization.accessMode).toBeUndefined();
    expect(out.monetization.monetized).toBe(true);
  });

  it('treats a novel with no monetization block as monetized', () => {
    const out = serializeNovel({ ...rawNovel, monetization: undefined });
    expect(out.monetization).toBeUndefined();
    expect(out.title).toBe('Ashfall');
  });

  it('handles null', () => {
    expect(serializeNovel(null)).toBeNull();
  });
});

describe('serializeNovelRef', () => {
  it('carries only card fields', () => {
    expect(serializeNovelRef({ _id: 'n1', title: 'T', slug: 's', coverUrl: '/c.jpg', synopsis: 'x' })).toEqual({
      id: 'n1',
      title: 'T',
      slug: 's',
      coverUrl: '/c.jpg',
    });
  });

  it('handles null', () => {
    expect(serializeNovelRef(null)).toBeNull();
  });
});

describe('serializeWallet', () => {
  const wallet = {
    balance: 420,
    lifetimePurchased: 1200,
    lifetimeGranted: 100,
    lifetimeSpent: 880,
    lifetimeSpendUsdCents: 733,
    autoUnlock: { enabled: true, maxPriceCredits: 20, novels: [] },
    flags: { negative: false, disputeFrozen: true },
  };

  it('exposes balance and lifetime counters', () => {
    expect(serializeWallet(wallet)).toMatchObject({
      balance: 420,
      lifetimePurchased: 1200,
      lifetimeGranted: 100,
      lifetimeSpent: 880,
    });
  });

  it('never exposes internal flags or cash spend', () => {
    const out = serializeWallet(wallet);
    expect(out.flags).toBeUndefined();
    expect(out.lifetimeSpendUsdCents).toBeUndefined();
  });

  it('uses the configured credit label', () => {
    expect(serializeWallet(wallet, { creditLabel: 'Gems' }).label).toBe('Gems');
    expect(serializeWallet(wallet).label).toBe('Credits');
  });

  it('returns a zero wallet rather than throwing when none exists', () => {
    const out = serializeWallet(null);
    expect(out.balance).toBe(0);
    expect(out.autoUnlock).toEqual({ enabled: false, maxPriceCredits: 0, novels: [] });
  });
});

describe('serializeTransaction', () => {
  const row = {
    _id: 't1',
    type: 'spend',
    amount: -10,
    balanceAfter: 410,
    description: 'Unlocked chapter 12',
    novel: 'n1',
    chapter: 'c1',
    createdAt: new Date('2026-08-01'),
    // Internal accounting must stay internal.
    attributedUsdMicros: 83250,
    bucketBreakdown: [{ bucket: 'b1', credits: 10, costMicros: 83250 }],
    idempotencyKey: 'unlock:u1:c1',
    reason: 'chapter unlock',
    metadata: { secret: true },
  };

  it('exposes the statement fields a reader needs', () => {
    expect(serializeTransaction(row)).toEqual({
      id: 't1',
      type: 'spend',
      amount: -10,
      balanceAfter: 410,
      description: 'Unlocked chapter 12',
      novel: 'n1',
      chapter: 'c1',
      createdAt: row.createdAt,
    });
  });

  it('never exposes cost basis, idempotency keys or admin reasons', () => {
    const json = JSON.stringify(serializeTransaction(row));
    expect(json).not.toContain('83250');
    expect(json).not.toContain('bucketBreakdown');
    expect(json).not.toContain('idempotencyKey');
    expect(json).not.toContain('chapter unlock');
  });
});

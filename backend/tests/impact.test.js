const impactService = require('../src/services/impactService');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const ChapterAccess = require('../src/models/ChapterAccess');
const CreditPack = require('../src/models/CreditPack');
const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');

beforeEach(async () => {
  settingsService.clearCache();
  await settingsService.update({
    'monetization.enabled': true,
    'pricing.defaultChapterCredits': 10,
    'pricing.defaultFreeChapterCount': 5,
  });
  settingsService.clearCache();
});

describe('revalueBalances', () => {
  it('reports nothing when no balances exist', async () => {
    const result = await impactService.preview('credits.perUsd', 50);
    expect(result.severity).toBe('low');
    expect(result.summary).toMatch(/No outstanding balances/);
  });

  it('shows what outstanding credits become worth', async () => {
    const a = await createUser();
    const b = await createUser();
    await creditService.credit({ user: a.user, amount: 1000, idempotencyKey: 'a' });
    await creditService.credit({ user: b.user, amount: 1000, idempotencyKey: 'b' });

    // 2000 credits at 100/USD is $20 of content; halving the rate doubles it.
    const result = await impactService.preview('credits.perUsd', 50);
    expect(result.severity).toBe('high');
    expect(result.summary).toContain('$20.00');
    expect(result.summary).toContain('$40.00');
    expect(result.summary).toContain('increases');

    const facts = Object.fromEntries(result.facts.map((f) => [f.label, f.value]));
    expect(facts['Outstanding credits']).toBe('2,000');
    expect(facts['Holders affected']).toBe('2');
  });

  it('reports a decrease when the rate goes up', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 500, idempotencyKey: 'a' });
    const result = await impactService.preview('credits.perUsd', 200);
    expect(result.summary).toContain('decreases');
  });

  it('makes no claim when the value is unchanged', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 500, idempotencyKey: 'a' });
    expect((await impactService.preview('credits.perUsd', 100)).severity).toBe('low');
  });
});

describe('repriceChapters', () => {
  let novel;

  beforeEach(async () => {
    novel = await createNovel({ slug: 'impact-novel' });
    for (let n = 1; n <= 10; n += 1) await createChapter(novel, { number: n });
  });

  it('counts chapters that become paid when the free run shrinks', async () => {
    // Free run 5 -> 2 paywalls chapters 3, 4 and 5.
    const result = await impactService.preview('pricing.defaultFreeChapterCount', 2);
    expect(result.severity).toBe('high');
    expect(result.summary).toContain('3 chapters become paid');

    const facts = Object.fromEntries(result.facts.map((f) => [f.label, f.value]));
    expect(facts['Becoming paid']).toBe('3');
    expect(facts['Novels affected']).toBe('1');
  });

  it('counts chapters that become free when the run grows', async () => {
    const result = await impactService.preview('pricing.defaultFreeChapterCount', 8);
    expect(result.summary).toContain('3 chapters become free');
    expect(result.severity).toBe('medium');
  });

  it('warns when readers already paid for chapters about to be free', async () => {
    const { user } = await createUser();
    const chapter = await createChapter(novel, { number: 11 });
    await ChapterAccess.create({
      user: user._id, chapter: chapter._id, novel: novel._id, creditsSpent: 10,
    });

    const result = await impactService.preview('pricing.defaultFreeChapterCount', 20);
    const facts = Object.fromEntries(result.facts.map((f) => [f.label, f.value]));
    expect(facts['Existing paid unlocks']).toBe('1');
  });

  it('counts a price change that keeps chapters paid', async () => {
    const result = await impactService.preview('pricing.defaultChapterCredits', 25);
    expect(result.summary).toContain('change price');
    expect(result.severity).toBe('medium');
  });

  it('reports nothing when the value does not move any chapter', async () => {
    const result = await impactService.preview('pricing.defaultChapterCredits', 10);
    expect(result.summary).toMatch(/No chapter changes/);
  });
});

describe('monetizationKillSwitch', () => {
  it('warns that everything becomes free and names the unredeemed value', async () => {
    const { user } = await createUser();
    await creditService.credit({
      user, amount: 1200, type: 'purchase', source: 'purchase', costUsdCents: 999, idempotencyKey: 'p',
    });

    const result = await impactService.preview('monetization.enabled', false);
    expect(result.severity).toBe('high');
    expect(result.summary).toContain('every chapter becomes free'.replace('every', 'Every'));
    expect(result.summary).toContain('$9.99');
  });

  it('warns when switching on with no packs to buy', async () => {
    await settingsService.update({ 'monetization.enabled': false });
    settingsService.clearCache();
    const novel = await createNovel({ slug: 'no-packs' });
    await createChapter(novel, { number: 1 });

    const result = await impactService.preview('monetization.enabled', true);
    expect(result.summary).toMatch(/no credit packs are on sale/);
  });

  it('does not warn about packs when some exist', async () => {
    await settingsService.update({ 'monetization.enabled': false });
    settingsService.clearCache();
    await CreditPack.create({ name: 'P', slug: 'p', credits: 100, priceUsdCents: 199 });

    const result = await impactService.preview('monetization.enabled', true);
    expect(result.summary).not.toMatch(/no credit packs/);
  });
});

describe('preview plumbing', () => {
  it('rejects an unknown setting', async () => {
    await expect(impactService.preview('nope.missing', 1)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a value that fails validation', async () => {
    await expect(impactService.preview('credits.perUsd', 0)).rejects.toMatchObject({ status: 400 });
  });

  it('returns hasPreview false for a setting with no resolver', async () => {
    const result = await impactService.preview('credits.labelPlural', 'Gems');
    expect(result.hasPreview).toBe(false);
  });

  it('writes nothing', async () => {
    const before = await settingsService.get('credits.perUsd');
    await impactService.preview('credits.perUsd', 500);
    settingsService.clearCache();
    expect(await settingsService.get('credits.perUsd')).toBe(before);
  });
});

describe('preview endpoint', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await createAdmin());
  });

  it('previews through the API', async () => {
    const { user } = await createUser();
    await creditService.credit({ user, amount: 1000, idempotencyKey: 'a' });

    const res = await api()
      .post('/api/admin/config/preview-impact')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'credits.perUsd', value: 50 })
      .expect(200);

    expect(res.body).toMatchObject({ key: 'credits.perUsd', hasPreview: true, current: 100, next: 50 });
    expect(res.body.facts.length).toBeGreaterThan(0);
  });

  it('requires a key', async () => {
    await api()
      .post('/api/admin/config/preview-impact')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 1 })
      .expect(400);
  });

  it('requires an admin', async () => {
    const { token: reader } = await createUser();
    await api()
      .post('/api/admin/config/preview-impact')
      .set('Authorization', `Bearer ${reader}`)
      .send({ key: 'credits.perUsd', value: 50 })
      .expect(403);
  });
});

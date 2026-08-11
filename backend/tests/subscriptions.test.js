const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const subscriptionService = require('../src/services/subscriptionService');
const accessService = require('../src/services/accessService');
const creditService = require('../src/services/creditService');
const paypalService = require('../src/services/paypalService');
const SubscriptionPlan = require('../src/models/SubscriptionPlan');
const Subscription = require('../src/models/Subscription');
const ChapterAccess = require('../src/models/ChapterAccess');
const ChapterRead = require('../src/models/ChapterRead');
const Chapter = require('../src/models/Chapter');
const Novel = require('../src/models/Novel');
const CreditTransaction = require('../src/models/CreditTransaction');
const { SUBSCRIPTION_STATUS, PAYPAL_EVENTS, PRICE_REASONS, ACCESS_SOURCES } = require('../src/config/constants');

jest.mock('../src/services/paypalService', () => {
  const actual = jest.requireActual('../src/services/paypalService');
  return {
    ...actual,
    isConfigured: jest.fn().mockResolvedValue(true),
    createProduct: jest.fn(),
    createBillingPlan: jest.fn(),
    deactivateBillingPlan: jest.fn().mockResolvedValue({}),
    createSubscription: jest.fn(),
    getSubscription: jest.fn(),
    cancelSubscription: jest.fn().mockResolvedValue({}),
    verifyWebhookSignature: jest.fn().mockResolvedValue({ verified: true, reason: 'SUCCESS' }),
  };
});

let user;
let token;
let admin;
let adminToken;
let plan;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

let seq = 0;
const makePlan = (overrides = {}) =>
  SubscriptionPlan.create({
    name: overrides.name || 'Gold',
    tier: overrides.tier || `gold${(seq += 1)}`,
    priceUsdCents: 999,
    interval: 'month',
    monthlyCredits: 500,
    paypalProductId: 'PROD-1',
    paypalPlanId: `P-PLAN-${seq}`,
    pricedAtUsdCents: 999,
    ...overrides,
  });

/** An active subscription, bypassing the PayPal round trip. */
const liveSubscription = async (targetPlan, overrides = {}) =>
  Subscription.create({
    user: user._id,
    plan: targetPlan._id,
    planSnapshot: subscriptionService.planSnapshot(targetPlan),
    paypalSubscriptionId: `I-SUB-${(seq += 1)}`,
    status: SUBSCRIPTION_STATUS.ACTIVE,
    currentPeriodStart: new Date(Date.now() - 24 * 3600 * 1000),
    currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    cyclesCompleted: 1,
    lastGrantedCycle: 1,
    cycleNetUsdCents: 999,
    ...overrides,
  });

beforeEach(async () => {
  settingsService.clearCache();
  jest.clearAllMocks();
  seq = 0;

  // Every mock a test might override is re-set here. `jest.clearAllMocks()`
  // clears call history but leaves implementations in place, so anything set
  // inside one test silently persists into the next one.
  paypalService.isConfigured.mockResolvedValue(true);
  paypalService.deactivateBillingPlan.mockResolvedValue({});
  paypalService.cancelSubscription.mockResolvedValue({});
  paypalService.getSubscription.mockReset();
  paypalService.verifyWebhookSignature.mockResolvedValue({ verified: true, reason: 'SUCCESS' });

  paypalService.createProduct.mockResolvedValue({ id: 'PROD-NEW' });
  paypalService.createBillingPlan.mockResolvedValue({ id: 'P-PLAN-NEW' });
  paypalService.createSubscription.mockResolvedValue({
    id: 'I-SUB-NEW',
    status: 'APPROVAL_PENDING',
    links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
  });

  ({ user, token } = await createUser());
  ({ user: admin, token: adminToken } = await createAdmin());

  await settingsService.update({ 'monetization.enabled': true, 'subscriptions.enabled': true });
  settingsService.clearCache();

  plan = await makePlan();
});

// ------------------------------------------------------------ entitlement

describe('entitlement', () => {
  it('treats an active subscription as entitled and a cancelled one as not', async () => {
    const subscription = await liveSubscription(plan);
    expect(subscription.isEntitled()).toBe(true);

    subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
    expect(subscription.isEntitled()).toBe(false);
  });

  it('keeps a past-due subscriber entitled until the grace period ends', async () => {
    const subscription = await liveSubscription(plan, {
      status: SUBSCRIPTION_STATUS.PAST_DUE,
      gracePeriodEndsAt: new Date(Date.now() + 3600 * 1000),
    });
    expect(subscription.isEntitled()).toBe(true);

    subscription.gracePeriodEndsAt = new Date(Date.now() - 1000);
    expect(subscription.isEntitled()).toBe(false);
  });

  it('does not treat a metered allowance as blanket novel coverage', async () => {
    // The distinction matters: if a metered plan reported coverage, the chapter
    // would resolve free on every read and the allowance would never be spent.
    const metered = await makePlan({
      tier: 'metered',
      perks: { freeUnlocks: 'up_to_n_per_cycle', freeUnlockLimit: 3 },
    });
    const subscription = await liveSubscription(metered);

    expect(subscription.coversNovel('64b7f1e2c1a2b3d4e5f60718')).toBe(false);
    expect(subscription.freeUnlocksRemaining()).toBe(3);
  });

  it('reports no allowance left once the limit is used', async () => {
    const metered = await makePlan({
      tier: 'metered2',
      perks: { freeUnlocks: 'up_to_n_per_cycle', freeUnlockLimit: 2 },
    });
    const subscription = await liveSubscription(metered, { freeUnlocksUsedThisCycle: 2 });
    expect(subscription.freeUnlocksRemaining()).toBe(0);
  });
});

// ------------------------------------------------------------- access

describe('subscription access', () => {
  let novel;
  let chapter;

  beforeEach(async () => {
    novel = await createNovel({ slug: `sub-novel-${Date.now()}` });
    // An explicit per-chapter price outranks every rule, so these tests exercise
    // the subscription logic rather than the pricing chain.
    chapter = await createChapter(novel, { number: 5, accessType: 'paid', priceCredits: 10 });
    await settingsService.update({ 'pricing.defaultFreeChapterCount': 0 });
    settingsService.clearCache();
  });

  it('unlocks every novel for an all-access plan without spending credits', async () => {
    const allAccess = await makePlan({ tier: 'all', perks: { freeUnlocks: 'all' } });
    await liveSubscription(allAccess);

    const access = await accessService.resolveAccess({ novel, chapter, user });
    expect(access.locked).toBe(false);
    expect(access.reason).toBe(PRICE_REASONS.SUBSCRIPTION);
    expect(access.viaSubscription).toBe(true);
  });

  it('covers only the listed novels on a selected-novels plan', async () => {
    const other = await createNovel({ slug: `other-novel-${Date.now()}` });
    const selective = await makePlan({
      tier: 'selective',
      perks: { freeUnlocks: 'selected_novels', freeUnlockNovels: [novel._id] },
    });
    await liveSubscription(selective);

    const covered = await accessService.resolveAccess({ novel, chapter, user });
    expect(covered.locked).toBe(false);

    const otherChapter = await createChapter(other, { number: 5, accessType: 'paid', priceCredits: 10 });
    const uncovered = await accessService.resolveAccess({ novel: other, chapter: otherChapter, user });
    expect(uncovered.locked).toBe(true);
  });

  it('respects a novel that opts out of subscription coverage', async () => {
    const allAccess = await makePlan({ tier: 'all2', perks: { freeUnlocks: 'all' } });
    await liveSubscription(allAccess);

    // Per-novel monetization only applies when `override` is set.
    novel.monetization.override = true;
    novel.monetization.subscriptionIncluded = false;
    await novel.save();
    const fresh = await Novel.findById(novel._id);

    const access = await accessService.resolveAccess({ novel: fresh, chapter, user });
    expect(access.locked).toBe(true);
  });

  it('applies the subscriber chapter discount to the resolved price', async () => {
    const discounted = await makePlan({ tier: 'disc', perks: { chapterDiscountPct: 30 } });
    await liveSubscription(discounted);

    const access = await accessService.resolveAccess({ novel, chapter, user });
    expect(access.locked).toBe(true);
    expect(access.priceCredits).toBe(7); // 10 less 30%
    expect(access.subscriberDiscountPct).toBe(30);
  });

  it('treats a 100% chapter discount as free rather than rounding up to 1', async () => {
    const freeForSubs = await makePlan({ tier: 'full', perks: { chapterDiscountPct: 100 } });
    await liveSubscription(freeForSubs);

    const access = await accessService.resolveAccess({ novel, chapter, user });
    expect(access.locked).toBe(false);
    expect(access.priceCredits).toBeUndefined();
  });

  it('opens early access sooner for a subscriber with the perk', async () => {
    const early = await makePlan({ tier: 'early', perks: { earlyAccessHours: 48 } });
    await liveSubscription(early);

    chapter.earlyAccessUntil = new Date(Date.now() + 24 * 3600 * 1000);
    await chapter.save();

    const access = await accessService.resolveAccess({ novel, chapter, user });
    // 24h remaining minus a 48h head start means it is already open.
    expect(access.reason).not.toBe('early_access');

    const { user: outsider } = await createUser();
    const blocked = await accessService.resolveAccess({ novel, chapter, user: outsider });
    expect(blocked.reason).toBe('early_access');
  });

  it('keeps the chapter list consistent with the single-chapter resolver', async () => {
    const discounted = await makePlan({ tier: 'disc2', perks: { chapterDiscountPct: 50 } });
    await liveSubscription(discounted);

    const [row] = await accessService.resolveNovelChapters({ novel, chapters: [chapter], user });
    const single = await accessService.resolveAccess({ novel, chapter, user });

    expect(row.priceCredits).toBe(single.priceCredits);
    expect(row.locked).toBe(single.locked);
  });
});

// ------------------------------------------------- metered free unlocks

describe('metered free unlocks', () => {
  let novel;
  let chapter;
  let metered;

  beforeEach(async () => {
    novel = await createNovel({ slug: `metered-novel-${Date.now()}` });
    chapter = await createChapter(novel, { number: 3, accessType: 'paid', priceCredits: 10 });
    await settingsService.update({ 'pricing.defaultFreeChapterCount': 0 });
    settingsService.clearCache();

    metered = await makePlan({
      tier: 'metered',
      perks: { freeUnlocks: 'up_to_n_per_cycle', freeUnlockLimit: 2 },
    });
  });

  it('spends an allowance instead of credits, and reports what is left', async () => {
    await liveSubscription(metered);

    const result = await accessService.unlockChapter({ user, novel, chapter });
    expect(result.viaSubscription).toBe(true);
    expect(result.spent).toBe(0);
    expect(result.freeUnlocksLeft).toBe(1);

    const row = await ChapterAccess.findOne({ user: user._id, chapter: chapter._id });
    expect(row.source).toBe(ACCESS_SOURCES.SUBSCRIPTION);
    // The cycle paid $9.99 for two unlocks, so each carries half.
    expect(row.attributedUsdMicros).toBe(Math.floor((999 * 10000) / 2));

    // No credits were touched.
    expect(await creditService.getBalance(user)).toBe(0);
  });

  it('falls back to credits once the allowance is exhausted', async () => {
    await liveSubscription(metered, { freeUnlocksUsedThisCycle: 2 });
    await creditService.credit({ user, amount: 50, type: 'grant', source: 'grant', reason: 'test' });

    const result = await accessService.unlockChapter({ user, novel, chapter });
    expect(result.spent).toBe(10);
    expect(await creditService.getBalance(user)).toBe(40);
  });

  it('never spends more allowance than the limit under concurrency', async () => {
    await liveSubscription(metered);
    const chapters = await Promise.all(
      [10, 11, 12, 13].map((number) => createChapter(novel, { number, accessType: 'paid', priceCredits: 10 }))
    );
    await creditService.credit({ user, amount: 100, type: 'grant', source: 'grant', reason: 'test' });

    await Promise.all(chapters.map((c) => accessService.unlockChapter({ user, novel, chapter: c })));

    const subscription = await Subscription.findOne({ user: user._id });
    expect(subscription.freeUnlocksUsedThisCycle).toBe(2);

    const free = await ChapterAccess.countDocuments({ user: user._id, source: ACCESS_SOURCES.SUBSCRIPTION });
    expect(free).toBe(2);
    // The other two were paid for.
    expect(await creditService.getBalance(user)).toBe(80);
  });

  it('refuses a bulk unlock that the subscription already covers', async () => {
    const allAccess = await makePlan({ tier: 'allbulk', perks: { freeUnlocks: 'all' } });
    await liveSubscription(allAccess);

    await expect(accessService.unlockChapters({ user, novel, chapters: [chapter] })).rejects.toThrow(
      /already includes/i
    );
  });
});

// -------------------------------------------------------- cycle grants

describe('cycle credits', () => {
  it('grants the plan credits once per cycle', async () => {
    const subscription = await liveSubscription(plan, { cyclesCompleted: 0, lastGrantedCycle: 0 });

    const first = await subscriptionService.grantCycle(subscription, { cycle: 1, netUsdCents: 999 });
    expect(first.granted).toBe(true);
    expect(await creditService.getBalance(user)).toBe(500);

    const replay = await subscriptionService.grantCycle(subscription, { cycle: 1, netUsdCents: 999 });
    expect(replay.granted).toBe(false);
    expect(await creditService.getBalance(user)).toBe(500);
  });

  it('carries the cycle cash as cost basis so spending recognizes revenue', async () => {
    const subscription = await liveSubscription(plan, { cyclesCompleted: 0, lastGrantedCycle: 0 });
    await subscriptionService.grantCycle(subscription, { cycle: 1, netUsdCents: 999 });

    const transaction = await CreditTransaction.findOne({ user: user._id, type: 'subscription_grant' });
    expect(transaction.costUsdCents).toBe(999);
  });

  it('resets the free-unlock allowance when a new cycle starts', async () => {
    const metered = await makePlan({
      tier: 'meteredcycle',
      perks: { freeUnlocks: 'up_to_n_per_cycle', freeUnlockLimit: 3 },
    });
    const subscription = await liveSubscription(metered, { freeUnlocksUsedThisCycle: 3 });

    await subscriptionService.grantCycle(subscription, { cycle: 2, netUsdCents: 999 });
    expect(subscription.freeUnlocksUsedThisCycle).toBe(0);
  });
});

// ----------------------------------------------------- cycle attribution

describe('unmetered cycle attribution', () => {
  it('splits the cycle cash across the chapters actually read', async () => {
    const allAccess = await makePlan({ tier: 'allattr', perks: { freeUnlocks: 'all' } });
    const subscription = await liveSubscription(allAccess, { cycleNetUsdCents: 900 });

    const novel = await createNovel({ slug: `attr-novel-${Date.now()}` });
    const chapters = await Promise.all(
      [1, 2, 3].map((number) => createChapter(novel, { number, title: `C${number}` }))
    );
    await ChapterRead.insertMany(
      chapters.map((chapter, index) => ({
        readerKey: `u:${user._id}`,
        user: user._id,
        chapter: chapter._id,
        novel: novel._id,
        chapterNumber: index + 1,
        firstReadAt: new Date(),
      }))
    );

    const result = await subscriptionService.attributeCycle(subscription, subscription.cyclesCompleted);
    expect(result.reads).toBe(3);
    // The parts must sum exactly to the cash, with no rounding leak.
    expect(result.attributed).toBe(900 * 10000);

    const refreshed = await Novel.findById(novel._id).select('+revenueLifetimeUsdMicros');
    expect(refreshed.revenueLifetimeUsdMicros).toBe(900 * 10000);
  });

  it('is idempotent, so a redelivered webhook cannot double-post revenue', async () => {
    const allAccess = await makePlan({ tier: 'allattr2', perks: { freeUnlocks: 'all' } });
    const subscription = await liveSubscription(allAccess, { cycleNetUsdCents: 900 });

    const novel = await createNovel({ slug: `attr2-novel-${Date.now()}` });
    const chapter = await createChapter(novel, { number: 1 });
    await ChapterRead.create({
      readerKey: `u:${user._id}`,
      user: user._id,
      chapter: chapter._id,
      novel: novel._id,
      chapterNumber: 1,
      firstReadAt: new Date(),
    });

    await subscriptionService.attributeCycle(subscription, 1);
    const replay = await subscriptionService.attributeCycle(subscription, 1);
    expect(replay.replayed).toBe(true);

    const refreshed = await Chapter.findById(chapter._id).select('+revenueLifetimeUsdMicros');
    expect(refreshed.revenueLifetimeUsdMicros).toBe(900 * 10000);
  });

  it('attributes nothing for a credits-only plan', async () => {
    const subscription = await liveSubscription(plan);
    const result = await subscriptionService.attributeCycle(subscription, 1);
    expect(result.attributed).toBe(0);
  });
});

// ------------------------------------------------------------- webhooks

describe('subscription webhooks', () => {
  const send = (eventType, resource, id = `EV-${Date.now()}${Math.random()}`) =>
    api()
      .post('/webhooks/paypal')
      .set('paypal-transmission-id', 'T1')
      .set('paypal-transmission-sig', 'S1')
      .send({ id, event_type: eventType, resource });

  it('grants credits on a renewal sale and ignores the redelivery', async () => {
    const subscription = await liveSubscription(plan, { cyclesCompleted: 0, lastGrantedCycle: 0 });

    await send(PAYPAL_EVENTS.SALE_COMPLETED, {
      billing_agreement_id: subscription.paypalSubscriptionId,
      amount: { value: '9.99', currency_code: 'USD' },
    }).expect(200);

    // Processing continues after the response.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await creditService.getBalance(user)).toBe(500);

    await send(PAYPAL_EVENTS.SALE_COMPLETED, {
      billing_agreement_id: subscription.paypalSubscriptionId,
      amount: { value: '9.99', currency_code: 'USD' },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // A second distinct event for the same cycle must not pay twice.
    const refreshed = await Subscription.findById(subscription._id);
    expect(refreshed.cyclesCompleted).toBe(2);
    expect(await creditService.getBalance(user)).toBe(1000);
  });

  it('moves a subscription to past due on a failed payment', async () => {
    const subscription = await liveSubscription(plan);

    await send(PAYPAL_EVENTS.SUBSCRIPTION_PAYMENT_FAILED, {
      id: subscription.paypalSubscriptionId,
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const refreshed = await Subscription.findById(subscription._id);
    expect(refreshed.status).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
    expect(refreshed.gracePeriodEndsAt).toBeTruthy();
    expect(refreshed.isEntitled()).toBe(true);
  });

  it('cancels on the cancellation event', async () => {
    const subscription = await liveSubscription(plan);

    await send(PAYPAL_EVENTS.SUBSCRIPTION_CANCELLED, { id: subscription.paypalSubscriptionId }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const refreshed = await Subscription.findById(subscription._id);
    expect(refreshed.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
  });

  it('cancels a second approval rather than letting PayPal bill twice', async () => {
    // Pending rows no longer hold the uniqueness slot, so two checkouts can be
    // outstanding at once. Only one of them may end up billing.
    const live = await liveSubscription(plan);
    const second = await Subscription.create({
      user: user._id,
      plan: plan._id,
      planSnapshot: subscriptionService.planSnapshot(plan),
      paypalSubscriptionId: 'I-SUB-DUPLICATE',
      status: SUBSCRIPTION_STATUS.APPROVAL_PENDING,
    });

    await send(PAYPAL_EVENTS.SUBSCRIPTION_ACTIVATED, {
      id: 'I-SUB-DUPLICATE',
      billing_info: { last_payment: { amount: { value: '9.99' } } },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const refreshed = await Subscription.findById(second._id);
    expect(refreshed.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
    expect(paypalService.cancelSubscription).toHaveBeenCalledWith('I-SUB-DUPLICATE', 'Duplicate subscription');

    // The original is untouched and no extra credits were granted.
    expect((await Subscription.findById(live._id)).status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(await creditService.getBalance(user)).toBe(0);
  });

  it('replays a failed subscription event from the admin portal', async () => {
    const subscription = await liveSubscription(plan, { cyclesCompleted: 0, lastGrantedCycle: 0 });

    const WebhookEvent = require('../src/models/WebhookEvent');
    const record = await WebhookEvent.create({
      eventId: 'EV-REPLAY-SUB',
      eventType: PAYPAL_EVENTS.SALE_COMPLETED,
      resourceId: subscription.paypalSubscriptionId,
      status: 'failed',
      payload: {
        resource: {
          billing_agreement_id: subscription.paypalSubscriptionId,
          amount: { value: '9.99', currency_code: 'USD' },
        },
      },
    });

    await asAdmin(api().post(`/api/admin/webhooks/${record._id}/replay`)).expect(200);
    expect(await creditService.getBalance(user)).toBe(500);
  });

  it('resolves by custom_id when PayPal sends it', async () => {
    const subscription = await liveSubscription(plan);

    await send(PAYPAL_EVENTS.SUBSCRIPTION_SUSPENDED, { custom_id: String(subscription._id) }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const refreshed = await Subscription.findById(subscription._id);
    expect(refreshed.status).toBe(SUBSCRIPTION_STATUS.SUSPENDED);
  });
});

// --------------------------------------------------------------- routes

describe('subscription routes', () => {
  it('lists plans and folds in the reader’s current subscription', async () => {
    await liveSubscription(plan);
    const res = await auth(api().get('/api/subscriptions/plans')).expect(200);

    expect(res.body.enabled).toBe(true);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.current.plan.name).toBe('Gold');
    expect(res.body.current.entitled).toBe(true);
  });

  it('reports subscriptions as unavailable when the feature is off', async () => {
    await settingsService.update({ 'subscriptions.enabled': false });
    settingsService.clearCache();

    const res = await api().get('/api/subscriptions/plans').expect(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.plans).toHaveLength(0);
  });

  it('starts a subscription and returns the approval link', async () => {
    const res = await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(201);
    expect(res.body.approveUrl).toBe('https://paypal.test/approve');

    const created = await Subscription.findById(res.body.subscriptionId);
    expect(created.status).toBe(SUBSCRIPTION_STATUS.APPROVAL_PENDING);
    expect(created.paypalSubscriptionId).toBe('I-SUB-NEW');
  });

  it('refuses a second subscription while one is live', async () => {
    await liveSubscription(plan);
    await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(409);
  });

  it('lets a reader retry after abandoning an approval', async () => {
    // The one-live-subscription index would otherwise strand anyone who closed
    // the PayPal tab.
    await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(201);
    paypalService.createSubscription.mockResolvedValue({
      id: 'I-SUB-SECOND',
      links: [{ rel: 'approve', href: 'https://paypal.test/approve2' }],
    });
    await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(201);
  });

  it('confirms on return from PayPal without waiting for the webhook', async () => {
    const start = await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(201);
    paypalService.getSubscription.mockResolvedValue({
      status: 'ACTIVE',
      billing_info: {
        last_payment: { amount: { value: '9.99', currency_code: 'USD' } },
        next_billing_time: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
    });

    const res = await auth(api().post(`/api/subscriptions/${start.body.subscriptionId}/confirm`)).expect(200);
    expect(res.body.subscription.entitled).toBe(true);
    expect(await creditService.getBalance(user)).toBe(500);
  });

  it('says so plainly when PayPal has not activated yet', async () => {
    const start = await auth(api().post('/api/subscriptions')).send({ planId: plan._id }).expect(201);
    paypalService.getSubscription.mockResolvedValue({ status: 'APPROVAL_PENDING' });

    const res = await auth(api().post(`/api/subscriptions/${start.body.subscriptionId}/confirm`)).expect(202);
    expect(res.body.paypalStatus).toBe('APPROVAL_PENDING');
  });

  it('will not confirm someone else’s subscription', async () => {
    const subscription = await liveSubscription(plan);
    const { token: otherToken } = await createUser();

    await api()
      .post(`/api/subscriptions/${subscription._id}/confirm`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('cancels at period end by default', async () => {
    await liveSubscription(plan);
    const res = await auth(api().delete('/api/subscriptions')).send({ reason: 'too expensive' }).expect(200);

    expect(res.body.subscription.cancelAtPeriodEnd).toBe(true);
    // Access continues through what was already paid for.
    expect(res.body.subscription.entitled).toBe(true);
  });

  it('cancels immediately when the setting says so', async () => {
    await settingsService.update({ 'subscriptions.cancelAtPeriodEnd': false });
    settingsService.clearCache();
    await liveSubscription(plan);

    const res = await auth(api().delete('/api/subscriptions')).expect(200);
    expect(res.body.subscription.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
  });

  it('requires a signed-in reader to subscribe', async () => {
    await api().post('/api/subscriptions').send({ planId: plan._id }).expect(401);
  });
});

// ---------------------------------------------------------- admin routes

describe('admin plan management', () => {
  it('creates a plan and reports it as unsynced', async () => {
    const res = await asAdmin(api().post('/api/admin/monetization/plans'))
      .send({ name: 'Silver', tier: 'silver', priceUsdCents: 499, monthlyCredits: 200 })
      .expect(201);

    expect(res.body.needsResync).toBe(true);
  });

  it('warns that a live plan cannot be repriced', async () => {
    const res = await asAdmin(api().put(`/api/admin/monetization/plans/${plan._id}`))
      .send({ priceUsdCents: 1499 })
      .expect(200);

    expect(res.body.warning).toMatch(/cannot reprice/i);
    expect(res.body.needsResync).toBe(true);
  });

  it('creates a replacement PayPal plan when the price changed', async () => {
    plan.priceUsdCents = 1499;
    await plan.save();

    const res = await asAdmin(api().post(`/api/admin/monetization/plans/${plan._id}/sync`)).expect(200);

    expect(paypalService.deactivateBillingPlan).toHaveBeenCalled();
    expect(paypalService.createBillingPlan).toHaveBeenCalled();
    expect(res.body.notes.join(' ')).toMatch(/stay on the old price/i);
    expect(res.body.plan.pricedAtUsdCents).toBe(1499);
    expect(res.body.needsResync).toBe(false);
  });

  it('refuses to delete a plan people are paying for', async () => {
    await liveSubscription(plan);
    const res = await asAdmin(api().delete(`/api/admin/monetization/plans/${plan._id}`)).expect(409);
    expect(res.body.subscribers).toBe(1);
  });

  it('deletes an unsubscribed plan', async () => {
    await asAdmin(api().delete(`/api/admin/monetization/plans/${plan._id}`)).expect(200);
  });

  it('normalises annual plans into monthly MRR', async () => {
    const annual = await makePlan({ tier: 'annual', interval: 'year', priceUsdCents: 12000 });
    await liveSubscription(annual);

    const res = await asAdmin(api().get('/api/admin/monetization/subscriptions/summary')).expect(200);
    // $120/year is $10/month, not $120.
    expect(res.body.mrrUsdCents).toBe(1000);
    expect(res.body.arrUsdCents).toBe(12000);
    expect(res.body.subscribers).toBe(1);
  });

  it('keeps plan management off limits to ordinary readers', async () => {
    await auth(api().get('/api/admin/monetization/plans')).expect(403);
  });
});

// -------------------------------------------------------------- lifecycle

describe('lifecycle sweep', () => {
  it('expires a subscription whose cancelled period has ended', async () => {
    await liveSubscription(plan, {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() - 1000),
    });

    const result = await subscriptionService.expireLapsed();
    expect(result.expired).toBe(1);

    const refreshed = await Subscription.findOne({ user: user._id });
    expect(refreshed.status).toBe(SUBSCRIPTION_STATUS.EXPIRED);
  });

  it('suspends a past-due subscription once the grace period lapses', async () => {
    await liveSubscription(plan, {
      status: SUBSCRIPTION_STATUS.PAST_DUE,
      gracePeriodEndsAt: new Date(Date.now() - 1000),
    });

    const result = await subscriptionService.expireLapsed();
    expect(result.suspended).toBe(1);

    const refreshed = await Subscription.findOne({ user: user._id });
    expect(refreshed.isEntitled()).toBe(false);
  });

  it('leaves a live subscription alone', async () => {
    await liveSubscription(plan);
    const result = await subscriptionService.expireLapsed();
    expect(result).toEqual({ expired: 0, suspended: 0 });
  });
});

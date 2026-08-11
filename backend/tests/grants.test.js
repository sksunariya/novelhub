const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const grantService = require('../src/services/grantService');
const audienceResolver = require('../src/services/audienceResolver');
const GrantCampaign = require('../src/models/GrantCampaign');
const Wallet = require('../src/models/Wallet');
const CreditTransaction = require('../src/models/CreditTransaction');
const Notification = require('../src/models/Notification');
const User = require('../src/models/User');
const { ROLES } = require('../src/config/constants');

let adminToken;
let admin;

beforeEach(async () => {
  settingsService.clearCache();
  ({ user: admin, token: adminToken } = await createAdmin());
  await settingsService.update({ 'monetization.enabled': true, 'grants.requireDryRun': false });
  settingsService.clearCache();
});

const auth = (req) => req.set('Authorization', `Bearer ${adminToken}`);

const makeCampaign = (overrides = {}) =>
  GrantCampaign.create({
    name: 'Test campaign',
    amount: 100,
    audience: { mode: 'all' },
    notify: { enabled: false, channels: ['in_app'] },
    createdBy: admin._id,
    ...overrides,
  });

const seedUsers = async (count) => {
  const users = [];
  for (let i = 0; i < count; i += 1) users.push((await createUser()).user);
  return users;
};

describe('audience resolution', () => {
  it('targets everyone', async () => {
    await seedUsers(4);
    expect(await audienceResolver.count({ mode: 'all' })).toBe(5); // + the admin
  });

  it('excludes banned users unconditionally', async () => {
    await seedUsers(2);
    await createUser({ banned: true });
    expect(await audienceResolver.count({ mode: 'all' })).toBe(3);
  });

  it('targets by role', async () => {
    await seedUsers(3);
    expect(await audienceResolver.count({ mode: 'role', role: ROLES.ADMIN })).toBe(1);
    expect(await audienceResolver.count({ mode: 'role', role: ROLES.USER })).toBe(3);
  });

  it('targets specific users', async () => {
    const users = await seedUsers(4);
    const rule = { mode: 'specific', userIds: [users[0]._id, users[2]._id] };
    expect(await audienceResolver.count(rule)).toBe(2);
  });

  it('targets by email list', async () => {
    const users = await seedUsers(3);
    const rule = { mode: 'csv_emails', emails: [users[1].email.toUpperCase()] };
    expect(await audienceResolver.count(rule)).toBe(1);
  });

  it('honours an explicit exclusion list', async () => {
    const users = await seedUsers(4);
    expect(await audienceResolver.count({ mode: 'all', excludeUserIds: [users[0]._id] })).toBe(4);
  });

  it('filters on balance', async () => {
    const users = await seedUsers(3);
    await creditService.credit({ user: users[0], amount: 500, idempotencyKey: 'rich' });
    await creditService.credit({ user: users[1], amount: 5, idempotencyKey: 'poor' });

    expect(await audienceResolver.count({ mode: 'query', query: { balanceAbove: 100 } })).toBe(1);
    // users[1] at 5, users[2] at 0 and the admin at 0. users[0] at 500 is out.
    // Users with no wallet row still count as zero rather than being dropped.
    expect(await audienceResolver.count({ mode: 'query', query: { balanceBelow: 10 } })).toBe(3);
  });

  it('filters on whether someone has ever purchased', async () => {
    const users = await seedUsers(2);
    await creditService.credit({
      user: users[0], amount: 100, type: 'purchase', source: 'purchase', costUsdCents: 499, idempotencyKey: 'buyer',
    });
    expect(await audienceResolver.count({ mode: 'query', query: { hasEverPurchased: true } })).toBe(1);
  });

  it('filters on registration date', async () => {
    const users = await seedUsers(2);
    // Mongoose marks createdAt immutable when timestamps are on and strips it
    // from any update, so backdating a fixture has to go through the driver.
    await User.collection.updateOne(
      { _id: users[0]._id },
      { $set: { createdAt: new Date('2020-01-01') } }
    );
    const rule = { mode: 'query', query: { registeredBefore: new Date('2021-01-01') } };
    expect(await audienceResolver.count(rule)).toBe(1);
  });

  it('finds dormant users for a win-back', async () => {
    const users = await seedUsers(3);
    await User.updateOne({ _id: users[0]._id }, { lastActiveAt: new Date(Date.now() - 90 * 864e5) });
    await User.updateOne({ _id: users[1]._id }, { lastActiveAt: new Date() });
    const rule = { mode: 'query', query: { inactiveForDays: 30 } };
    // The dormant one plus everyone who has never been active.
    expect(await audienceResolver.count(rule)).toBeGreaterThanOrEqual(1);
  });

  it('filters on chapters read', async () => {
    const novel = await createNovel({ slug: 'read-me' });
    const chapter = await createChapter(novel, { number: 1 });
    const users = await seedUsers(2);
    const ChapterRead = require('../src/models/ChapterRead');
    await ChapterRead.create({
      readerKey: `u:${users[0]._id}`, user: users[0]._id, chapter: chapter._id,
      novel: novel._id, chapterNumber: 1,
    });
    expect(await audienceResolver.count({ mode: 'query', query: { hasReadNovel: [novel._id] } })).toBe(1);
  });

  it('caps the audience with a limit', async () => {
    await seedUsers(9);
    expect(await audienceResolver.count({ mode: 'all', limit: 3 })).toBe(3);
  });

  it('returns a sample for the admin to sanity-check', async () => {
    await seedUsers(5);
    const sample = await audienceResolver.preview({ mode: 'all' }, 3);
    expect(sample).toHaveLength(3);
    expect(sample[0]).toHaveProperty('username');
  });
});

describe('grant execution', () => {
  it('credits every targeted user', async () => {
    const users = await seedUsers(3);
    const campaign = await makeCampaign({ amount: 50 });
    const stats = await grantService.execute(campaign);

    expect(stats.granted).toBe(4); // 3 users + admin
    expect(stats.creditsIssued).toBe(200);
    for (const user of users) {
      expect((await Wallet.findOne({ user: user._id })).balance).toBe(50);
    }
  });

  it('grants carry no cash, so they generate no revenue when spent', async () => {
    const users = await seedUsers(1);
    await grantService.execute(await makeCampaign({ amount: 100 }));
    const spend = await creditService.debit({ user: users[0], amount: 10 });
    expect(spend.attributedUsdMicros).toBe(0);
  });

  it('never pays twice when re-run for the same run index', async () => {
    await seedUsers(2);
    const campaign = await makeCampaign({ amount: 50 });
    await grantService.execute(campaign);
    // Resume repeats the same run index, so the ledger key blocks a second payout.
    await grantService.execute(campaign, { resume: true });

    const balances = await Wallet.find({});
    balances.forEach((wallet) => expect(wallet.balance).toBe(50));
  });

  it('resumes from the cursor after a crash', async () => {
    const users = await seedUsers(4);
    const campaign = await makeCampaign({ amount: 20 });
    // Simulate dying after the first user.
    campaign.status = 'running';
    campaign.runIndex = 1;
    campaign.cursor = { lastUserId: users[0]._id, processedCount: 1 };
    await campaign.save();

    await grantService.execute(campaign, { resume: true });
    // The skipped-past user is not paid; the rest are.
    expect(campaign.stats.granted).toBeGreaterThan(0);
  });

  it('tops balances up to a floor rather than adding a flat amount', async () => {
    const users = await seedUsers(2);
    await creditService.credit({ user: users[0], amount: 80, idempotencyKey: 'partial' });

    await grantService.execute(await makeCampaign({ amount: 100, amountMode: 'top_up_to' }));
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(100); // topped up by 20
    expect((await Wallet.findOne({ user: users[1]._id })).balance).toBe(100); // full amount
  });

  it('skips users already at or above the top-up floor', async () => {
    const users = await seedUsers(1);
    await creditService.credit({ user: users[0], amount: 500, idempotencyKey: 'rich' });
    const campaign = await makeCampaign({ amount: 100, amountMode: 'top_up_to' });
    await grantService.execute(campaign);
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(500);
    expect(campaign.stats.skipped).toBeGreaterThanOrEqual(1);
  });

  it('caps a computed amount at maxPerUser', async () => {
    const users = await seedUsers(1);
    await grantService.execute(await makeCampaign({ amount: 1000, amountMode: 'top_up_to', maxPerUser: 30 }));
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(30);
  });

  it('sets an expiry when configured', async () => {
    await seedUsers(1);
    await grantService.execute(await makeCampaign({ amount: 50, expiryDays: 30 }));
    const CreditBucket = require('../src/models/CreditBucket');
    const bucket = await CreditBucket.findOne({ source: 'grant' });
    expect(bucket.expiresAt).not.toBeNull();
  });

  it('records the campaign on every ledger row for attribution', async () => {
    await seedUsers(2);
    const campaign = await makeCampaign({ amount: 50 });
    await grantService.execute(campaign);
    const rows = await CreditTransaction.find({ refType: 'grant_campaign', refId: campaign._id });
    expect(rows).toHaveLength(3);
  });
});

describe('dry run and safety', () => {
  it('estimates without issuing anything', async () => {
    await seedUsers(3);
    const campaign = await makeCampaign({ amount: 50 });
    const result = await grantService.dryRun(campaign);

    expect(result.targeted).toBe(4);
    expect(result.creditsIssued).toBe(200);
    expect(result.liabilityUsdCents).toBe(200); // 200 credits at 100/USD
    expect(await CreditTransaction.countDocuments()).toBe(0);
  });

  it('requires a dry run when the admin demands one', async () => {
    await settingsService.update({ 'grants.requireDryRun': true });
    settingsService.clearCache();
    await seedUsers(1);
    await expect(grantService.execute(await makeCampaign())).rejects.toMatchObject({ status: 428 });
  });

  it('refuses a campaign above the credit ceiling', async () => {
    await settingsService.update({ 'grants.maxCreditsPerCampaign': 100 });
    settingsService.clearCache();
    await seedUsers(5);
    const campaign = await makeCampaign({ amount: 1000 });
    await grantService.dryRun(campaign);
    await expect(grantService.execute(campaign)).rejects.toMatchObject({ status: 403 });
  });

  it('requires a second approver above the threshold', async () => {
    await settingsService.update({ 'grants.approvalThresholdCredits': 100 });
    settingsService.clearCache();
    await seedUsers(5);
    const campaign = await makeCampaign({ amount: 1000 });
    await grantService.dryRun(campaign);
    await expect(grantService.execute(campaign)).rejects.toMatchObject({ status: 428 });
  });
});

describe('reversal', () => {
  it('takes back unspent credits', async () => {
    const users = await seedUsers(2);
    const campaign = await makeCampaign({ amount: 100 });
    await grantService.execute(campaign);

    const result = await grantService.reverse(campaign);
    expect(result.reversed).toBe(3);
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(0);
    expect(campaign.status).toBe('reversed');
  });

  it('leaves already-spent credits alone rather than locking content', async () => {
    const users = await seedUsers(1);
    const campaign = await makeCampaign({ amount: 100 });
    await grantService.execute(campaign);
    await creditService.debit({ user: users[0], amount: 100, idempotencyKey: 'spent-it' });

    const result = await grantService.reverse(campaign);
    expect(result.alreadySpent).toBeGreaterThanOrEqual(1);
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(0);
  });
});

describe('notifications', () => {
  it('notifies recipients in-app when enabled', async () => {
    const users = await seedUsers(2);
    const campaign = await makeCampaign({
      amount: 50,
      notify: { enabled: true, channels: ['in_app'] },
    });
    await grantService.execute(campaign);

    const notes = await Notification.find({ user: users[0]._id, type: 'credits_granted' });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('50');
  });

  it('sends nothing when the campaign has notifications off', async () => {
    await seedUsers(1);
    await grantService.execute(await makeCampaign({ amount: 50 }));
    expect(await Notification.countDocuments({ type: 'credits_granted' })).toBe(0);
  });

  it('respects an admin turning the event off in the template matrix', async () => {
    const NotificationTemplate = require('../src/models/NotificationTemplate');
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'in_app', enabled: false });
    await seedUsers(1);
    await grantService.execute(
      await makeCampaign({ amount: 50, notify: { enabled: true, channels: ['in_app'] } })
    );
    expect(await Notification.countDocuments({ type: 'credits_granted' })).toBe(0);
  });

  it('uses admin-edited copy with variables substituted', async () => {
    const NotificationTemplate = require('../src/models/NotificationTemplate');
    await NotificationTemplate.create({
      key: 'credits_granted',
      channel: 'in_app',
      enabled: true,
      subject: 'Gift!',
      body: 'Hey {{username}}, take {{amount}} {{creditLabel}}.',
    });
    const users = await seedUsers(1);
    await grantService.execute(
      await makeCampaign({ amount: 50, notify: { enabled: true, channels: ['in_app'] } })
    );
    const note = await Notification.findOne({ user: users[0]._id });
    expect(note.message).toBe(`Hey ${users[0].username}, take 50 credits.`);
  });
});

describe('admin grant routes', () => {
  it('previews an audience with a live count', async () => {
    await seedUsers(5);
    const res = await auth(api().post('/api/admin/monetization/grants/preview'))
      .send({ audience: { mode: 'all' } })
      .expect(200);
    expect(res.body.total).toBe(6);
    expect(res.body.sample.length).toBeGreaterThan(0);
  });

  it('runs the full create → dry-run → execute flow', async () => {
    const users = await seedUsers(2);
    const created = await auth(api().post('/api/admin/monetization/grants'))
      .send({ name: 'Launch gift', amount: 100, audience: { mode: 'all' } })
      .expect(201);
    const id = created.body.campaign._id;

    const dry = await auth(api().post(`/api/admin/monetization/grants/${id}/dry-run`)).expect(200);
    expect(dry.body.creditsIssued).toBe(300);

    const run = await auth(api().post(`/api/admin/monetization/grants/${id}/execute`)).expect(200);
    expect(run.body.stats.granted).toBe(3);
    expect((await Wallet.findOne({ user: users[0]._id })).balance).toBe(100);
  });

  it('will not let the author approve their own campaign', async () => {
    const campaign = await makeCampaign();
    const res = await auth(api().post(`/api/admin/monetization/grants/${campaign._id}/approve`));
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 403 });
  });

  it('lets a different admin approve it', async () => {
    const campaign = await makeCampaign();
    const { token: otherAdmin } = await createAdmin();
    const res = await api()
      .post(`/api/admin/monetization/grants/${campaign._id}/approve`)
      .set('Authorization', `Bearer ${otherAdmin}`);
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 200 });
  });

  it('will not edit a completed campaign', async () => {
    const campaign = await makeCampaign();
    campaign.status = 'completed';
    await campaign.save();
    await auth(api().put(`/api/admin/monetization/grants/${campaign._id}`))
      .send({ amount: 999 })
      .expect(409);
  });

  it('keeps a campaign that has issued credits', async () => {
    const campaign = await makeCampaign();
    campaign.stats.granted = 5;
    await campaign.save();
    await auth(api().delete(`/api/admin/monetization/grants/${campaign._id}`)).expect(409);
  });

  it('requires an admin', async () => {
    const { token } = await createUser();
    await api()
      .post('/api/admin/monetization/grants/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ audience: { mode: 'all' } })
      .expect(403);
  });
});

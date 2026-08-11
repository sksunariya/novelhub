// Stage 1: the Phase 0 stragglers — user deletion guard, notification
// consolidation, email queue, and the indexes those depend on.

const mongoose = require('mongoose');
const contentGuard = require('../src/services/contentGuardService');
const emailQueue = require('../src/services/emailQueue');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const Wallet = require('../src/models/Wallet');
const Notification = require('../src/models/Notification');
const CreditTransaction = require('../src/models/CreditTransaction');
const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const { ORDER_STATUS } = require('../src/config/constants');

beforeEach(async () => {
  settingsService.clearCache();
  emailQueue.reset();
});

describe('indexes that were missing', () => {
  it('indexes User.library, which every chapter publish queries', async () => {
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => i.key && i.key.library === 1)).toBe(true);
  });

  it('indexes lastActiveAt for audience targeting', async () => {
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => i.key && i.key.lastActiveAt === -1)).toBe(true);
  });
});

describe('deleting a user who has transacted', () => {
  let adminToken;

  const givePurchaseHistory = async (user) => {
    await creditService.credit({
      user,
      amount: 1200,
      type: 'purchase',
      source: 'purchase',
      costUsdCents: 999,
      idempotencyKey: `hist:${user._id}`,
    });
    await Order.create({
      orderNumber: `NH-2026-${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      user: user._id,
      credits: 1200,
      totalCredits: 1200,
      baseUsdCents: 999,
      netUsdCents: 999,
      chargeCurrency: 'USD',
      chargeAmountMinor: 999,
      status: ORDER_STATUS.CAPTURED,
      creditedAt: new Date(),
    });
  };

  beforeEach(async () => {
    ({ token: adminToken } = await createAdmin());
  });

  const del = (id, qs = '') =>
    api().delete(`/api/admin/users/${id}${qs}`).set('Authorization', `Bearer ${adminToken}`);

  it('summarises what a user has transacted', async () => {
    const { user } = await createUser();
    expect(await contentGuard.transactionSummary(user._id)).toMatchObject({ hasHistory: false, orders: 0 });

    await givePurchaseHistory(user);
    const summary = await contentGuard.transactionSummary(user._id);
    expect(summary).toMatchObject({ hasHistory: true, orders: 1, balance: 1200 });
    expect(summary.ledgerRows).toBeGreaterThan(0);
  });

  it('deletes a user with no history normally', async () => {
    const { user } = await createUser();
    const res = await del(user._id).expect(200);
    expect(res.body.transactionGuard.action).toBe('none');
    expect(await User.findById(user._id)).toBeNull();
  });

  it('anonymizes rather than deletes a user who has paid', async () => {
    await settingsService.update({ 'safety.onTransactedUserDelete': 'anonymize' });
    settingsService.clearCache();
    const { user } = await createUser();
    await givePurchaseHistory(user);

    const res = await del(user._id).expect(200);
    expect(res.body.transactionGuard.action).toBe('anonymized');

    const raw = await User.findById(user._id).setOptions({ withDeleted: true });
    expect(raw.username).toMatch(/^deleted_/);
    expect(raw.email).toMatch(/@removed\.invalid$/);
    expect(raw.fullName).toBe('');
    expect(raw.anonymizedAt).toBeInstanceOf(Date);
    expect(raw.deletedAt).toBeInstanceOf(Date);
  });

  it('keeps the financial trail after anonymizing', async () => {
    await settingsService.update({ 'safety.onTransactedUserDelete': 'anonymize' });
    settingsService.clearCache();
    const { user } = await createUser();
    await givePurchaseHistory(user);
    await del(user._id).expect(200);

    // Tax and accounting records must survive an erasure request.
    expect(await Order.countDocuments({ user: user._id })).toBe(1);
    expect(await CreditTransaction.countDocuments({ user: user._id })).toBeGreaterThan(0);
    expect(await Wallet.countDocuments({ user: user._id })).toBe(1);
  });

  it('refuses the delete when the policy is to block', async () => {
    await settingsService.update({ 'safety.onTransactedUserDelete': 'block' });
    settingsService.clearCache();
    const { user } = await createUser();
    await givePurchaseHistory(user);

    const res = await del(user._id).expect(409);
    expect(res.body.message).toMatch(/1 completed order/);
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it('lets an admin force past a block', async () => {
    await settingsService.update({ 'safety.onTransactedUserDelete': 'block' });
    settingsService.clearCache();
    const { user } = await createUser();
    await givePurchaseHistory(user);

    const res = await del(user._id, '?force=true').expect(200);
    expect(res.body.transactionGuard.action).toBe('deleted_with_records_retained');
    // Even forced, the ledger stays — removing it would break reconciliation.
    expect(await CreditTransaction.countDocuments({ user: user._id })).toBeGreaterThan(0);
  });

  it('anonymizes two users without colliding on the unique indexes', async () => {
    await settingsService.update({ 'safety.onTransactedUserDelete': 'anonymize' });
    settingsService.clearCache();
    const a = await createUser();
    const b = await createUser();
    await givePurchaseHistory(a.user);
    await givePurchaseHistory(b.user);

    await del(a.user._id).expect(200);
    await del(b.user._id).expect(200);

    const rows = await User.find({ anonymizedAt: { $ne: null } }).setOptions({ withDeleted: true });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.username)).size).toBe(2);
  });
});

describe('new-chapter notifications', () => {
  let adminToken;
  let novel;

  beforeEach(async () => {
    ({ token: adminToken } = await createAdmin());
    novel = await createNovel({ slug: 'notify-me' });
  });

  const addToLibrary = async (token) =>
    api().post(`/api/library/${novel._id}`).set('Authorization', `Bearer ${token}`);

  const publishChapter = () =>
    api()
      .post(`/api/admin/novels/${novel._id}/chapters`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Fresh', content: '<p>new words</p>' });

  it('notifies readers who have the novel in their library', async () => {
    const { user, token } = await createUser();
    await addToLibrary(token);
    await publishChapter().expect(201);

    const notes = await Notification.find({ user: user._id, type: 'new_chapter' });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain('Fresh');
  });

  it('respects the global chapter-notification toggle', async () => {
    // Previously this wrote Notification rows directly and no setting could
    // stop it — the notification users get most often was the one setting
    // could not control.
    const SiteSettings = require('../src/models/SiteSettings');
    const settings = await SiteSettings.getSettings();
    settings.enableChapterNotifications = false;
    await settings.save();

    const { user, token } = await createUser();
    await addToLibrary(token);
    await publishChapter().expect(201);

    expect(await Notification.countDocuments({ user: user._id })).toBe(0);
  });

  it('skips a banned reader', async () => {
    const { user, token } = await createUser();
    await addToLibrary(token);
    await User.updateOne({ _id: user._id }, { banned: true });
    await publishChapter().expect(201);

    expect(await Notification.countDocuments({ user: user._id })).toBe(0);
  });

  it('does not notify readers who have not added the novel', async () => {
    const { user } = await createUser();
    await publishChapter().expect(201);
    expect(await Notification.countDocuments({ user: user._id })).toBe(0);
  });
});

describe('email queue', () => {
  const collect = () => {
    const sent = [];
    emailQueue.setSender(async (message) => {
      sent.push(message);
    });
    return sent;
  };

  afterEach(() => {
    // Restore the real sender so other suites are unaffected.
    emailQueue.setSender(require('../src/utils/mailer').deliverNotificationEmail);
  });

  it('delivers a queued message', async () => {
    const sent = collect();
    emailQueue.enqueue({ to: 'a@test.com', title: 'Hi', message: 'there' });
    await emailQueue.flush();

    expect(sent).toHaveLength(1);
    expect(emailQueue.getStats()).toMatchObject({ sent: 1, failed: 0 });
  });

  it('never opens more connections than the configured concurrency', async () => {
    await settingsService.update({ 'notifications.emailConcurrency': 2 });
    settingsService.clearCache();

    let active = 0;
    let peak = 0;
    emailQueue.setSender(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    });

    for (let i = 0; i < 10; i += 1) emailQueue.enqueue({ to: `u${i}@test.com`, title: 'x', message: 'y' });
    await emailQueue.flush();

    // The old code fired 250 of these at once.
    expect(peak).toBeLessThanOrEqual(2);
    expect(emailQueue.getStats().sent).toBe(10);
  });

  it('retries a transient failure', async () => {
    let attempts = 0;
    emailQueue.setSender(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('greylisted');
    });

    emailQueue.enqueue({ to: 'a@test.com', title: 'x', message: 'y' });
    await emailQueue.flush(8000);

    expect(attempts).toBe(3);
    expect(emailQueue.getStats().sent).toBe(1);
  });

  it('gives up after the retry limit and records the failure', async () => {
    emailQueue.setSender(async () => {
      throw new Error('mailbox full');
    });
    emailQueue.enqueue({ to: 'a@test.com', title: 'x', message: 'y' });
    await emailQueue.flush(8000);

    expect(emailQueue.getStats().failed).toBe(1);
  });

  it('enforces the per-user daily cap', async () => {
    await settingsService.update({ 'notifications.maxEmailsPerUserPerDay': 2 });
    settingsService.clearCache();
    const sent = collect();

    for (let i = 0; i < 5; i += 1) emailQueue.enqueue({ to: 'same@test.com', title: 'x', message: 'y' });
    await emailQueue.flush();

    expect(sent).toHaveLength(2);
    expect(emailQueue.getStats().skippedByCap).toBe(3);
  });

  it('caps per recipient, not globally', async () => {
    await settingsService.update({ 'notifications.maxEmailsPerUserPerDay': 1 });
    settingsService.clearCache();
    const sent = collect();

    emailQueue.enqueue({ to: 'a@test.com', title: 'x', message: 'y' });
    emailQueue.enqueue({ to: 'b@test.com', title: 'x', message: 'y' });
    await emailQueue.flush();

    expect(sent).toHaveLength(2);
  });

  it('ignores a message with no recipient', async () => {
    collect();
    expect(emailQueue.enqueue({ title: 'x' })).toBe(false);
    expect(emailQueue.enqueue(null)).toBe(false);
  });

  it('reports pending work', async () => {
    emailQueue.setSender(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    emailQueue.enqueue({ to: 'a@test.com', title: 'x', message: 'y' });
    expect(emailQueue.getStats().queued).toBe(1);
    await emailQueue.flush();
    expect(emailQueue.getStats().pending).toBe(0);
  });
});

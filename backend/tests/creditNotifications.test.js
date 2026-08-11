const creditNotifications = require('../src/services/creditNotificationService');
const settingsService = require('../src/services/settingsService');
const creditService = require('../src/services/creditService');
const NotificationTemplate = require('../src/models/NotificationTemplate');
const Notification = require('../src/models/Notification');
const Wallet = require('../src/models/Wallet');
const User = require('../src/models/User');
const { createUser } = require('./helpers');
const { NOTIFICATION_TYPES } = require('../src/config/constants');

let user;

beforeEach(async () => {
  settingsService.clearCache();
  await settingsService.update({ 'monetization.enabled': true });
  settingsService.clearCache();
  ({ user } = await createUser());
});

const notesFor = (type) => Notification.find({ user: user._id, type });

describe('channel resolution', () => {
  it('uses the shipped defaults when no template row exists', async () => {
    const granted = await creditNotifications.resolveChannels(NOTIFICATION_TYPES.CREDITS_GRANTED);
    expect(granted.channels).toEqual(['in_app', 'email']);

    const lowBalance = await creditNotifications.resolveChannels(NOTIFICATION_TYPES.LOW_BALANCE);
    expect(lowBalance.channels).toEqual(['in_app']);

    const unlocked = await creditNotifications.resolveChannels(NOTIFICATION_TYPES.CHAPTER_UNLOCKED);
    expect(unlocked.channels).toEqual([]);
  });

  it('lets an admin switch a single channel off', async () => {
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'email', enabled: false });
    const { channels } = await creditNotifications.resolveChannels(NOTIFICATION_TYPES.CREDITS_GRANTED);
    expect(channels).toEqual(['in_app']);
  });

  it('lets an admin switch a channel on that ships off', async () => {
    await NotificationTemplate.create({ key: 'chapter_unlocked', channel: 'in_app', enabled: true });
    const { channels } = await creditNotifications.resolveChannels(NOTIFICATION_TYPES.CHAPTER_UNLOCKED);
    expect(channels).toEqual(['in_app']);
  });

  it('falls back safely for an unknown event key', async () => {
    const { channels } = await creditNotifications.resolveChannels('not_a_real_event');
    expect(channels).toEqual(['in_app']);
  });
});

describe('dispatch', () => {
  it('sends nothing while monetization is off', async () => {
    await settingsService.update({ 'monetization.enabled': false });
    settingsService.clearCache();
    await creditNotifications.creditsGranted(user, { amount: 50 });
    expect(await notesFor('credits_granted')).toHaveLength(0);
  });

  it('sends nothing when every channel is disabled', async () => {
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'in_app', enabled: false });
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'email', enabled: false });
    await creditNotifications.creditsGranted(user, { amount: 50 });
    expect(await notesFor('credits_granted')).toHaveLength(0);
  });

  it('never throws, so a notification failure cannot undo a credit', async () => {
    // A recipient that cannot be resolved must fail quietly.
    await expect(creditNotifications.creditsGranted({ _id: user._id }, { amount: 1 })).resolves.not.toThrow();
  });

  it('substitutes the live balance into the message', async () => {
    await creditService.credit({ user, amount: 250, idempotencyKey: 'seed' });
    await creditNotifications.creditsGranted(user, { amount: 250 });
    const [note] = await notesFor('credits_granted');
    expect(note.message).toContain('250');
  });

  it('uses the configured credit label', async () => {
    await settingsService.update({ 'credits.labelPlural': 'Gems' });
    settingsService.clearCache();
    await creditNotifications.creditsGranted(user, { amount: 10 });
    const [note] = await notesFor('credits_granted');
    expect(note.message).toContain('gems');
  });

  it('mentions the expiry date when the grant expires', async () => {
    const expiresAt = new Date(Date.now() + 30 * 864e5);
    await creditNotifications.creditsGranted(user, { amount: 10, expiresAt });
    const [note] = await notesFor('credits_granted');
    expect(note.message).toContain(expiresAt.toDateString());
  });

  it('omits the expiry sentence when credits never expire', async () => {
    await creditNotifications.creditsGranted(user, { amount: 10 });
    const [note] = await notesFor('credits_granted');
    expect(note.message).not.toMatch(/expire/i);
  });
});

describe('each event type', () => {
  it('credits purchased carries the order number', async () => {
    await creditNotifications.creditsPurchased(user, { amount: 1200, orderNumber: 'NH-2026-0000042' });
    const [note] = await notesFor('credits_purchased');
    expect(note.message).toContain('NH-2026-0000042');
    expect(note.message).toContain('1200');
  });

  it('purchase failed reassures that nothing was charged', async () => {
    await creditNotifications.purchaseFailed(user, { orderNumber: 'NH-1' });
    const [note] = await notesFor('purchase_failed');
    expect(note.message).toMatch(/not been charged/i);
  });

  it('refund processed names the order', async () => {
    await creditNotifications.refundProcessed(user, { amount: 500, orderNumber: 'NH-9' });
    const [note] = await notesFor('refund_processed');
    expect(note.message).toContain('NH-9');
  });

  it('credits expiring states the date', async () => {
    const expiresAt = new Date('2026-12-01');
    await creditNotifications.creditsExpiring(user, { amount: 40, expiresAt });
    const [note] = await notesFor('credits_expiring');
    expect(note.message).toContain(expiresAt.toDateString());
  });

  it('credits expired reports the amount lost', async () => {
    await creditNotifications.creditsExpired(user, { amount: 40 });
    const [note] = await notesFor('credits_expired');
    expect(note.message).toContain('40');
  });
});

describe('low balance nudge', () => {
  beforeEach(async () => {
    await settingsService.update({ 'credits.lowBalanceThreshold': 20, 'pricing.defaultChapterCredits': 10 });
    settingsService.clearCache();
  });

  it('fires when the balance drops to the threshold', async () => {
    await creditService.credit({ user, amount: 15, idempotencyKey: 'seed' });
    await creditNotifications.maybeLowBalance(user, 15);
    const [note] = await notesFor('low_balance');
    expect(note.message).toContain('15');
    // 15 credits at 10 per chapter is one more chapter.
    expect(note.message).toContain('1');
  });

  it('stays quiet above the threshold', async () => {
    await creditService.credit({ user, amount: 500, idempotencyKey: 'seed' });
    await creditNotifications.maybeLowBalance(user, 500);
    expect(await notesFor('low_balance')).toHaveLength(0);
  });

  it('stays quiet when the threshold is disabled', async () => {
    await settingsService.update({ 'credits.lowBalanceThreshold': 0 });
    settingsService.clearCache();
    await creditService.credit({ user, amount: 1, idempotencyKey: 'seed' });
    await creditNotifications.maybeLowBalance(user, 1);
    expect(await notesFor('low_balance')).toHaveLength(0);
  });

  it('debounces so a reader is not nagged on every chapter', async () => {
    await creditService.credit({ user, amount: 15, idempotencyKey: 'seed' });
    await creditNotifications.maybeLowBalance(user, 15);
    await creditNotifications.maybeLowBalance(user, 14);
    await creditNotifications.maybeLowBalance(user, 13);
    expect(await notesFor('low_balance')).toHaveLength(1);
  });

  it('nudges again once the debounce window has passed', async () => {
    await creditService.credit({ user, amount: 15, idempotencyKey: 'seed' });
    await creditNotifications.maybeLowBalance(user, 15);
    await Wallet.updateOne(
      { user: user._id },
      { $set: { lowBalanceNotifiedAt: new Date(Date.now() - 8 * 864e5) } }
    );
    await creditNotifications.maybeLowBalance(user, 15);
    expect(await notesFor('low_balance')).toHaveLength(2);
  });

  it('does nothing for a user with no wallet', async () => {
    const ghost = await User.create({ username: 'ghost1', email: 'g1@t.com', password: 'password123' });
    await Wallet.deleteMany({ user: ghost._id });
    await expect(creditNotifications.maybeLowBalance(ghost, 1)).resolves.toBeNull();
  });
});

describe('template listing for the admin editor', () => {
  it('lists every credit event with both channels', async () => {
    const templates = await creditNotifications.listTemplates();
    expect(templates.length).toBe(Object.keys(creditNotifications.DEFAULTS).length);

    const granted = templates.find((t) => t.key === 'credits_granted');
    expect(granted.channels.map((c) => c.channel)).toEqual(['in_app', 'email']);
    expect(granted.channels.every((c) => c.isDefault)).toBe(true);
    expect(granted.channels[0].subject).toContain('{{amount}}');
  });

  it('reflects a saved override and marks it non-default', async () => {
    await NotificationTemplate.create({
      key: 'credits_granted', channel: 'in_app', enabled: true, subject: 'Mine', body: 'Body',
    });
    const templates = await creditNotifications.listTemplates();
    const inApp = templates.find((t) => t.key === 'credits_granted').channels.find((c) => c.channel === 'in_app');
    expect(inApp).toMatchObject({ subject: 'Mine', body: 'Body', isDefault: false });
  });

  it('falls back to the default body when an override saves only a subject', async () => {
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'in_app', subject: 'Only subject' });
    const templates = await creditNotifications.listTemplates();
    const inApp = templates.find((t) => t.key === 'credits_granted').channels.find((c) => c.channel === 'in_app');
    expect(inApp.subject).toBe('Only subject');
    expect(inApp.body).toBe(creditNotifications.DEFAULTS.credits_granted.body);
  });

  it('keeps one row per event and channel', async () => {
    await NotificationTemplate.create({ key: 'credits_granted', channel: 'in_app', subject: 'a' });
    await expect(
      NotificationTemplate.create({ key: 'credits_granted', channel: 'in_app', subject: 'b' })
    ).rejects.toMatchObject({ code: 11000 });
  });
});

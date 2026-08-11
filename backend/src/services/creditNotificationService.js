// Credit event notifications.
//
// Routes through the existing dispatchNotification so global toggles, per-user
// preferences and the banned check all still apply — this is not a parallel
// notification system. What it adds is admin-editable copy and a per-event
// channel matrix on top.

const NotificationTemplate = require('../models/NotificationTemplate');
const Wallet = require('../models/Wallet');
const settingsService = require('./settingsService');
const { dispatchNotification } = require('./notificationService');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  CREDIT_NOTIFICATION_DEFAULTS,
} = require('../config/constants');

// Fallback copy. An admin can override any of these; these are what ships.
const DEFAULTS = {
  [NOTIFICATION_TYPES.CREDITS_GRANTED]: {
    subject: 'You received {{amount}} {{creditLabel}}',
    body: 'Hi {{username}}, {{amount}} {{creditLabel}} have been added to your account. Your balance is now {{balance}}.{{expiryNote}}',
  },
  [NOTIFICATION_TYPES.CREDITS_PURCHASED]: {
    subject: 'Your {{amount}} {{creditLabel}} are ready',
    body: 'Thanks {{username}}! Order {{orderNumber}} is complete and {{amount}} {{creditLabel}} have been added. Your balance is now {{balance}}.',
  },
  [NOTIFICATION_TYPES.PURCHASE_FAILED]: {
    subject: 'Your purchase could not be completed',
    body: 'Hi {{username}}, order {{orderNumber}} did not go through and you have not been charged. You can try again from the store.',
  },
  [NOTIFICATION_TYPES.CREDITS_EXPIRING]: {
    subject: '{{amount}} {{creditLabel}} expire soon',
    body: 'Hi {{username}}, {{amount}} of your {{creditLabel}} expire on {{expiresAt}}. Spend them before then to avoid losing them.',
  },
  [NOTIFICATION_TYPES.CREDITS_EXPIRED]: {
    subject: '{{amount}} {{creditLabel}} have expired',
    body: 'Hi {{username}}, {{amount}} {{creditLabel}} expired. Your balance is now {{balance}}.',
  },
  [NOTIFICATION_TYPES.LOW_BALANCE]: {
    subject: 'Your balance is running low',
    body: 'Hi {{username}}, you have {{balance}} {{creditLabel}} left — enough for about {{chaptersLeft}} more chapter(s).',
  },
  [NOTIFICATION_TYPES.CHAPTER_UNLOCKED]: {
    subject: 'Chapter unlocked',
    body: 'You unlocked chapter {{chapterNumber}} of {{novelTitle}} for {{amount}} {{creditLabel}}.',
  },
  [NOTIFICATION_TYPES.REFUND_PROCESSED]: {
    subject: 'Your refund has been processed',
    body: 'Hi {{username}}, order {{orderNumber}} has been refunded. {{amount}} {{creditLabel}} were removed from your balance.',
  },
  [NOTIFICATION_TYPES.RENTAL_EXPIRING]: {
    subject: 'Your access to chapter {{chapterNumber}} expires soon',
    body: 'Hi {{username}}, your rental of chapter {{chapterNumber}} of {{novelTitle}} expires {{expiresAt}}.',
  },
};

/**
 * Which channels this event should use.
 *
 * A template row with `enabled: false` switches a channel off for that event —
 * that is the admin matrix in docs/admin-portal-spec.md §4.16.
 */
const resolveChannels = async (type) => {
  const defaults = CREDIT_NOTIFICATION_DEFAULTS[type] || { in_app: true, email: false };
  const rows = await NotificationTemplate.find({ key: type });
  const byChannel = new Map(rows.map((row) => [row.channel, row]));

  const channels = [];
  for (const channel of [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL]) {
    const override = byChannel.get(channel);
    const on = override ? override.enabled : defaults[channel];
    if (on) channels.push(channel);
  }
  return { channels, templates: byChannel };
};

const copyFor = (type, templates, channel, vars) => {
  const template = templates.get(channel);
  const fallback = DEFAULTS[type] || { subject: 'Account update', body: '' };
  return {
    subject: NotificationTemplate.render(template && template.subject ? template.subject : fallback.subject, vars),
    body: NotificationTemplate.render(template && template.body ? template.body : fallback.body, vars),
  };
};

/**
 * Send a credit notification.
 *
 * Best-effort by design: a failed notification must never roll back a credit
 * that has already been granted.
 */
const notify = async (type, { user, vars = {}, link = '', metadata = {} }) => {
  try {
    const snapshot = await settingsService.snapshot();
    if (!snapshot.get('monetization.enabled')) return null;

    const { channels, templates } = await resolveChannels(type);
    if (!channels.length) return null;

    const userId = user._id || user;
    const wallet = await Wallet.findOne({ user: userId });
    const merged = {
      username: user.username || 'there',
      creditLabel: snapshot.get('credits.labelPlural').toLowerCase(),
      balance: wallet ? wallet.balance : 0,
      ...vars,
    };

    // In-app and email can carry different copy; the in-app record uses the
    // in-app template where one exists.
    const primary = copyFor(type, templates, channels[0], merged);

    return await dispatchNotification({
      recipient: user,
      type,
      title: primary.subject,
      message: primary.body,
      link,
      channels,
      metadata,
    });
  } catch (error) {
    console.error(`[creditNotifications] ${type} failed:`, error.message);
    return null;
  }
};

const creditsGranted = (user, { amount, reason = '', expiresAt = null, campaignName = '' }) =>
  notify(NOTIFICATION_TYPES.CREDITS_GRANTED, {
    user,
    vars: {
      amount,
      reason,
      campaignName,
      expiresAt: expiresAt ? new Date(expiresAt).toDateString() : '',
      expiryNote: expiresAt ? ` They expire on ${new Date(expiresAt).toDateString()}.` : '',
    },
    link: '/profile',
    metadata: { amount, campaignName },
  });

const creditsPurchased = (user, { amount, orderNumber }) =>
  notify(NOTIFICATION_TYPES.CREDITS_PURCHASED, {
    user,
    vars: { amount, orderNumber },
    link: '/profile',
    metadata: { orderNumber },
  });

const purchaseFailed = (user, { orderNumber, reason = '' }) =>
  notify(NOTIFICATION_TYPES.PURCHASE_FAILED, { user, vars: { orderNumber, reason }, link: '/store' });

const refundProcessed = (user, { amount, orderNumber }) =>
  notify(NOTIFICATION_TYPES.REFUND_PROCESSED, { user, vars: { amount, orderNumber }, link: '/profile' });

const creditsExpiring = (user, { amount, expiresAt }) =>
  notify(NOTIFICATION_TYPES.CREDITS_EXPIRING, {
    user,
    vars: { amount, expiresAt: new Date(expiresAt).toDateString() },
    link: '/profile',
  });

const creditsExpired = (user, { amount }) =>
  notify(NOTIFICATION_TYPES.CREDITS_EXPIRED, { user, vars: { amount }, link: '/profile' });

/**
 * Nudge a reader whose balance just dropped below the threshold.
 *
 * Debounced on the wallet so it fires on the crossing, not on every spend
 * afterwards.
 */
const maybeLowBalance = async (user, balance) => {
  try {
    const snapshot = await settingsService.snapshot();
    const threshold = snapshot.get('credits.lowBalanceThreshold');
    if (!threshold || balance > threshold) return null;

    const userId = user._id || user;
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) return null;
    // Once a week at most, however many chapters they read.
    if (wallet.lowBalanceNotifiedAt && Date.now() - wallet.lowBalanceNotifiedAt.getTime() < 7 * 24 * 3600 * 1000) {
      return null;
    }

    const perChapter = snapshot.get('pricing.defaultChapterCredits') || 1;
    await Wallet.updateOne({ _id: wallet._id }, { $set: { lowBalanceNotifiedAt: new Date() } });
    return notify(NOTIFICATION_TYPES.LOW_BALANCE, {
      user,
      vars: { balance, chaptersLeft: Math.floor(balance / perChapter) },
      link: '/store',
    });
  } catch (error) {
    console.error('[creditNotifications] low balance check failed:', error.message);
    return null;
  }
};

/** Template metadata for the admin editor. */
const listTemplates = async () => {
  const saved = await NotificationTemplate.find({});
  const byKey = new Map(saved.map((row) => [`${row.key}:${row.channel}`, row]));

  return Object.keys(CREDIT_NOTIFICATION_DEFAULTS).map((key) => ({
    key,
    variables: Object.keys(DEFAULTS[key] ? { username: 1, amount: 1, balance: 1, creditLabel: 1 } : {}),
    channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL].map((channel) => {
      const row = byKey.get(`${key}:${channel}`);
      return {
        channel,
        enabled: row ? row.enabled : CREDIT_NOTIFICATION_DEFAULTS[key][channel],
        subject: row && row.subject ? row.subject : DEFAULTS[key].subject,
        body: row && row.body ? row.body : DEFAULTS[key].body,
        isDefault: !row,
      };
    }),
  }));
};

module.exports = {
  notify,
  creditsGranted,
  creditsPurchased,
  purchaseFailed,
  refundProcessed,
  creditsExpiring,
  creditsExpired,
  maybeLowBalance,
  listTemplates,
  resolveChannels,
  DEFAULTS,
};

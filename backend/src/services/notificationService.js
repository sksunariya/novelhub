const User = require('../models/User');
const Notification = require('../models/Notification');
const SiteSettings = require('../models/SiteSettings');
const Campaign = require('../models/Campaign');
const { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } = require('../config/constants');
const { sendNotificationEmail } = require('../utils/mailer');

const escapeRegex = (string) => string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * Single entry-point for dispatching notifications to recipients over configured channels (In-App, Email).
 */
const dispatchNotification = async ({
  recipient,
  actor = null,
  type,
  title,
  message,
  link = '',
  channels = [NOTIFICATION_CHANNELS.IN_APP],
  metadata = {},
  settings: providedSettings = null,
}) => {
  if (!recipient) return null;

  const recipientId = recipient?._id || recipient;
  const recipientUser =
    recipient && typeof recipient === 'object' && recipient.email && recipient.notificationPreferences
      ? recipient
      : await User.findById(recipientId);
  if (!recipientUser || recipientUser.banned) return null;

  const recipientIdStr = recipientUser._id.toString();
  const actorIdStr = actor ? (actor._id ? actor._id.toString() : actor.toString()) : null;

  // 1. Prevent self-notifications for non-campaign/announcement events
  const isCampaignOrAnnouncement =
    type === NOTIFICATION_TYPES.CAMPAIGN ||
    type === NOTIFICATION_TYPES.ANNOUNCEMENT ||
    type === NOTIFICATION_TYPES.CUSTOM;

  if (actorIdStr && recipientIdStr === actorIdStr && !isCampaignOrAnnouncement) {
    return null;
  }

  // 2. Global SiteSettings for the admin-controlled switches. A bulk caller
  // passes its own snapshot: getSettings() is an uncached findOne, and a
  // 5,000-recipient campaign has no business issuing 5,000 of them.
  const settings = providedSettings || (await SiteSettings.getSettings());

  // Check global toggles
  if (type === NOTIFICATION_TYPES.REPLY && !settings.enableReplyNotifications) return null;
  if (type === NOTIFICATION_TYPES.MENTION && !settings.enableMentionNotifications) return null;
  if (type === NOTIFICATION_TYPES.NEW_CHAPTER && !settings.enableChapterNotifications) return null;

  const userPrefs = recipientUser.notificationPreferences || {};
  const activeChannels = [];

  // Determine In-App channel delivery
  if (settings.enableInAppNotifications) {
    const inAppAllowed =
      type === NOTIFICATION_TYPES.MENTION ? userPrefs.inAppMentions !== false :
      type === NOTIFICATION_TYPES.REPLY ? userPrefs.inAppReplies !== false : true;

    if (inAppAllowed && channels.includes(NOTIFICATION_CHANNELS.IN_APP)) {
      activeChannels.push(NOTIFICATION_CHANNELS.IN_APP);
    }
  }

  // Determine Email channel delivery
  if (settings.enableEmailNotifications) {
    const emailAllowed =
      type === NOTIFICATION_TYPES.MENTION ? userPrefs.emailMentions !== false :
      type === NOTIFICATION_TYPES.REPLY ? userPrefs.emailReplies !== false :
      type === NOTIFICATION_TYPES.NEW_CHAPTER ? userPrefs.emailChapters !== false :
      type === NOTIFICATION_TYPES.ANNOUNCEMENT || type === NOTIFICATION_TYPES.CAMPAIGN ? userPrefs.emailAnnouncements !== false : true;

    if (emailAllowed && channels.includes(NOTIFICATION_CHANNELS.EMAIL)) {
      activeChannels.push(NOTIFICATION_CHANNELS.EMAIL);
    }
  }

  if (activeChannels.length === 0) return null;

  let notificationRecord = null;

  // Dispatch In-App Notification
  if (activeChannels.includes(NOTIFICATION_CHANNELS.IN_APP)) {
    notificationRecord = await Notification.create({
      user: recipientUser._id,
      type,
      message: message.slice(0, 500),
      link,
      channels: activeChannels,
      metadata,
    });
  }

  // Dispatch Email Notification (Asynchronously without blocking)
  if (activeChannels.includes(NOTIFICATION_CHANNELS.EMAIL) && recipientUser.email) {
    sendNotificationEmail({
      to: recipientUser.email,
      title: title || message,
      message,
      link,
    }).catch((err) => console.error('[NotificationService] Email dispatch failed:', err.message));
  }

  return notificationRecord;
};

/**
 * Processes comment or review activity to notify the parent author and any @username mentions.
 */
const notifyCommentActivity = async ({
  parentAuthor,
  actor,
  content,
  link,
  commentContext = 'comment',
}) => {
  const actorUser = typeof actor === 'object' && actor.username ? actor : await User.findById(actor);
  if (!actorUser) return;

  const actorUsername = actorUser.username || 'Someone';
  const notifiedUserIds = new Set();
  notifiedUserIds.add(actorUser._id.toString());

  // 1. Notify the original commenter/reviewer if present
  if (parentAuthor) {
    const parentAuthorIdStr = parentAuthor._id ? parentAuthor._id.toString() : parentAuthor.toString();
    if (!notifiedUserIds.has(parentAuthorIdStr)) {
      await dispatchNotification({
        recipient: parentAuthor,
        actor: actorUser,
        type: NOTIFICATION_TYPES.REPLY,
        title: `New reply from ${actorUsername}`,
        message: `${actorUsername} replied to your ${commentContext}`,
        link: link || '',
        channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      });
      notifiedUserIds.add(parentAuthorIdStr);
    }
  }

  // 2. Parse @username mentions (up to 10 mentions max)
  if (content && typeof content === 'string') {
    const mentionRegex = /(?:^|\s)@([a-zA-Z0-9_.-]+)/g;
    let match;
    const rawUsernames = [];
    while ((match = mentionRegex.exec(content)) !== null) {
      const cleanUsername = match[1].replace(/[.-]+$/, '');
      if (cleanUsername) {
        rawUsernames.push(cleanUsername);
      }
      if (rawUsernames.length >= 10) break;
    }

    if (rawUsernames.length > 0) {
      const uniqueUsernames = [...new Set(rawUsernames)];
      const regexPatterns = uniqueUsernames.map((u) => new RegExp(`^${escapeRegex(u)}$`, 'i'));
      const mentionedUsers = await User.find({
        username: { $in: regexPatterns },
        deletedAt: null,
      }).select('_id username email notificationPreferences banned');

      for (const mentionedUser of mentionedUsers) {
        const mentionedIdStr = mentionedUser._id.toString();
        if (!notifiedUserIds.has(mentionedIdStr)) {
          await dispatchNotification({
            recipient: mentionedUser,
            actor: actorUser,
            type: NOTIFICATION_TYPES.MENTION,
            title: `${actorUsername} mentioned you`,
            message: `${actorUsername} tagged you in a ${commentContext}`,
            link: link || '',
            channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
          });
          notifiedUserIds.add(mentionedIdStr);
        }
      }
    }
  }
};

// ---------------------------------------------------------------- campaigns

const mongoose = require('mongoose');
const settingsService = require('./settingsService');
const { normalizeEmail, isValidEmail, MAX_RECIPIENTS } = require('../utils/emailList');

const DEFAULT_BATCH_SIZE = 250;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * Recipients per batch, from settings. The setting has always existed; this is
 * what reads it. Falling back rather than throwing keeps a campaign sendable
 * when the settings collection is briefly unreachable.
 */
const resolveBatchSize = async () => {
  try {
    const configured = Number(await settingsService.get('notifications.batchSize'));
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_BATCH_SIZE;
  } catch (error) {
    console.error('[dispatchCampaign] batch size lookup failed, using default:', error.message);
    return DEFAULT_BATCH_SIZE;
  }
};

/**
 * Sort an explicit address list into the three groups that get different
 * treatment.
 *
 *   members    - the address belongs to a live account, so it goes through
 *                dispatchNotification and that account's own
 *                emailAnnouncements preference decides. A member who turned
 *                announcement email off does not receive marketing just
 *                because an admin pasted their address.
 *   suppressed - the address belongs to a banned or closed account. Counted
 *                and reported, never sent to: a ban or a deletion is an
 *                opt-out no matter who typed the address back in.
 *   external   - nobody we know. There is no account to hold a preference, so
 *                it is sent directly through the email queue.
 */
const resolveEmailRecipients = async (emails) => {
  // Live accounts. The soft-delete plugin adds `deletedAt: null` to any find
  // that does not mention deletedAt itself, which is exactly right here: it
  // makes this query eligible for the partial unique index on email.
  const live = await User.find({ email: { $in: emails } })
    .select('_id email notificationPreferences banned')
    .lean();

  const liveByEmail = new Map(live.map((user) => [(user.email || '').toLowerCase(), user]));

  // Of the addresses with no live account, some belong to a closed one. A user
  // who deleted an account with no financial history keeps their real address
  // in the row (only anonymization scrubs it), so without this check a closed
  // account's address would be treated as a stranger's and mailed.
  //
  // Naming deletedAt explicitly opts out of the plugin's filter, and its bounds
  // keep the scan to the deleted rows in the deletedAt index rather than the
  // whole users collection.
  const unmatched = emails.filter((email) => !liveByEmail.has(email));
  const closed = unmatched.length
    ? await User.find({ email: { $in: unmatched }, deletedAt: { $ne: null } })
        .select('email')
        .lean()
    : [];
  const closedEmails = new Set(closed.map((user) => (user.email || '').toLowerCase()));

  const members = [];
  const suppressed = [];
  const external = [];

  emails.forEach((email) => {
    const user = liveByEmail.get(email);
    if (user) {
      // A ban is an opt-out as much as a preference is.
      if (user.banned) suppressed.push(email);
      else members.push(user);
      return;
    }
    if (closedEmails.has(email)) suppressed.push(email);
    else external.push(email);
  });

  return { members, suppressed, external };
};

/**
 * Campaign to an explicit address list — the marketing path, and the only one
 * that can reach somebody who has never registered.
 *
 * Email-only by design. In-app has no meaning for an address with no account,
 * and delivering it to the registered half of a list would make the same
 * campaign mean two different things depending on who received it.
 */
const dispatchEmailListCampaign = async ({
  title,
  message,
  link,
  emails,
  recipientSource,
  adminUser,
  type,
}) => {
  // Re-normalize rather than trust the caller. The admin portal parses the same
  // list client-side to preview it, and this is the parse that counts.
  const seen = new Set();
  const list = [];
  (Array.isArray(emails) ? emails : []).forEach((raw) => {
    const email = normalizeEmail(raw);
    if (!isValidEmail(email) || seen.has(email)) return;
    seen.add(email);
    list.push(email);
  });

  if (!list.length) throw badRequest('Add at least one valid email address.');
  if (list.length > MAX_RECIPIENTS) {
    throw badRequest(
      `A campaign can target at most ${MAX_RECIPIENTS.toLocaleString('en-US')} addresses at once ` +
        `(this list has ${list.length.toLocaleString('en-US')}). Split it into smaller sends.`
    );
  }

  // Checked once, up front. dispatchNotification checks it per member anyway,
  // but external addresses bypass that — without this, a campaign sent while
  // email is globally off would reach every stranger and no member.
  const settings = await SiteSettings.getSettings();
  if (!settings.enableEmailNotifications) {
    throw Object.assign(
      new Error('Email notifications are switched off in site settings, so this campaign would reach nobody.'),
      { status: 409 }
    );
  }

  const { members, suppressed, external } = await resolveEmailRecipients(list);
  const recipientCount = members.length + external.length;

  if (!recipientCount) {
    throw badRequest(
      `None of the ${list.length} address(es) can be mailed — every one belongs to a banned or closed account.`
    );
  }

  const campaignRecord = await Campaign.create({
    title,
    message,
    link,
    targetAudience: 'emails',
    targetUser: null,
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    recipientCount,
    recipientSource: recipientSource || 'manual',
    recipientEmails: list,
    matchedUserCount: members.length,
    externalCount: external.length,
    suppressedCount: suppressed.length,
    createdBy: adminUser._id,
  });

  const batchSize = await resolveBatchSize();

  setImmediate(async () => {
    try {
      // Members are batched because each dispatchNotification does its own
      // database work; `settings` is handed down so the whole campaign costs
      // one settings read instead of one per recipient.
      for (let i = 0; i < members.length; i += batchSize) {
        const chunk = members.slice(i, i + batchSize);
        await Promise.all(
          chunk.map((recipient) =>
            dispatchNotification({
              recipient,
              actor: adminUser,
              type,
              title,
              message,
              link,
              channels: [NOTIFICATION_CHANNELS.EMAIL],
              metadata: { campaignId: campaignRecord._id, audience: 'emails' },
              settings,
            }).catch((err) =>
              console.error('[dispatchEmailListCampaign] member dispatch error:', err.message)
            )
          )
        );
      }

      // External addresses are enqueued in one pass, deliberately not batched:
      // enqueue() returns immediately and the email queue is already what
      // bounds concurrency, applies the per-address daily cap and retries.
      // Chunking here would only delay handing it the work.
      external.forEach((to) => {
        sendNotificationEmail({ to, title, message, link }).catch((err) =>
          console.error('[dispatchEmailListCampaign] external send error:', err.message)
        );
      });
    } catch (err) {
      console.error('[dispatchEmailListCampaign] batch processing failed:', err.message);
    }
  });

  return campaignRecord;
};

/**
 * Dispatches a bulk campaign / custom notification from Admin Portal.
 */
const dispatchCampaign = async ({
  title,
  message,
  link = '',
  targetAudience = 'all',
  targetUserId = null,
  emails = null,
  recipientSource = null,
  channels = [NOTIFICATION_CHANNELS.IN_APP],
  adminUser,
  type = NOTIFICATION_TYPES.CAMPAIGN,
}) => {
  // The address-list audience resolves recipients from what the admin typed
  // rather than from a User query, so it takes its own path.
  if (targetAudience === 'emails') {
    return dispatchEmailListCampaign({
      title,
      message,
      link,
      emails,
      recipientSource,
      adminUser,
      type: type || NOTIFICATION_TYPES.CAMPAIGN,
    });
  }

  let filter = { banned: false, deletedAt: null };

  if (targetAudience === 'specific') {
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return null;
    }
    filter = { _id: targetUserId, banned: false, deletedAt: null };
  } else if (targetAudience === 'user' || targetAudience === 'admin') {
    filter.role = targetAudience;
  }

  const recipients = await User.find(filter).select('_id email notificationPreferences banned');
  if (!recipients.length) return null;

  // Log campaign creation in Campaign collection
  const campaignRecord = await Campaign.create({
    title,
    message,
    link,
    targetAudience,
    targetUser: targetUserId || null,
    channels,
    recipientCount: recipients.length,
    createdBy: adminUser._id,
  });

  const batchSize = await resolveBatchSize();
  const settings = await SiteSettings.getSettings();

  // Batch process dispatches with error resilience
  setImmediate(async () => {
    try {
      for (let i = 0; i < recipients.length; i += batchSize) {
        const chunk = recipients.slice(i, i + batchSize);
        await Promise.all(
          chunk.map((recipient) =>
            dispatchNotification({
              recipient,
              actor: adminUser,
              type: type || NOTIFICATION_TYPES.CAMPAIGN,
              title,
              message,
              link,
              channels,
              metadata: { campaignId: campaignRecord._id },
              settings,
            }).catch((err) => console.error('[dispatchCampaign] Recipient dispatch error:', err.message))
          )
        );
      }
    } catch (err) {
      console.error('[dispatchCampaign] Batch processing failed:', err.message);
    }
  });

  return campaignRecord;
};

module.exports = {
  dispatchNotification,
  notifyCommentActivity,
  dispatchCampaign,
  resolveEmailRecipients,
};

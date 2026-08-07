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

  // 2. Fetch global SiteSettings for admin-controlled switches
  const settings = await SiteSettings.getSettings();

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

/**
 * Dispatches a bulk campaign / custom notification from Admin Portal.
 */
const mongoose = require('mongoose');

const dispatchCampaign = async ({
  title,
  message,
  link = '',
  targetAudience = 'all',
  targetUserId = null,
  channels = [NOTIFICATION_CHANNELS.IN_APP],
  adminUser,
}) => {
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

  // Batch process dispatches in chunks of 250 with error resilience
  const BATCH_SIZE = 250;
  setImmediate(async () => {
    try {
      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const chunk = recipients.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map((recipient) =>
            dispatchNotification({
              recipient,
              actor: adminUser,
              type: NOTIFICATION_TYPES.CAMPAIGN,
              title,
              message,
              link,
              channels,
              metadata: { campaignId: campaignRecord._id },
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
};

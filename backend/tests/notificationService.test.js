const { api, createAdmin, createUser } = require('./helpers');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const Campaign = require('../src/models/Campaign');
const SiteSettings = require('../src/models/SiteSettings');
const { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } = require('../src/config/constants');
const { notifyCommentActivity, dispatchNotification, dispatchCampaign } = require('../src/services/notificationService');

describe('Notification Engine & Service', () => {
  it('creates in-app notifications and filters out self-notifications', async () => {
    const { user: sender } = await createUser();
    const { user: recipient } = await createUser();

    const notif = await dispatchNotification({
      recipient,
      actor: sender,
      type: NOTIFICATION_TYPES.REPLY,
      title: 'Reply Test',
      message: 'Someone replied to your comment',
      link: '/novel/test',
      channels: [NOTIFICATION_CHANNELS.IN_APP],
    });

    expect(notif).not.toBeNull();
    expect(notif.user.toString()).toBe(recipient._id.toString());
    expect(notif.type).toBe(NOTIFICATION_TYPES.REPLY);

    // Self notification should return null
    const selfNotif = await dispatchNotification({
      recipient: sender,
      actor: sender,
      type: NOTIFICATION_TYPES.REPLY,
      title: 'Self Reply',
      message: 'I replied to myself',
      channels: [NOTIFICATION_CHANNELS.IN_APP],
    });
    expect(selfNotif).toBeNull();
  });

  it('parses mentions and deduplicates notifications between parent author and tagged users', async () => {
    const { user: author } = await createUser({ username: 'original_author' });
    const { user: taggedUser } = await createUser({ username: 'tagged_user' });
    const { user: commenter } = await createUser({ username: 'commenter' });

    // Commenter replies to author and tags tagged_user AND author in content (with email boundary check)
    const content = 'Hey @tagged_user and @original_author check out test@email.com!';

    await notifyCommentActivity({
      parentAuthor: author,
      actor: commenter,
      content,
      link: '/novel/test-novel/chapter/1#comment-123',
      commentContext: 'comment',
    });

    // Author should receive 1 notification (the reply notification)
    const authorNotifs = await Notification.find({ user: author._id });
    expect(authorNotifs).toHaveLength(1);
    expect(authorNotifs[0].type).toBe(NOTIFICATION_TYPES.REPLY);
    expect(authorNotifs[0].message).toContain('replied to your comment');

    // Tagged user should receive 1 notification (the mention notification)
    const taggedNotifs = await Notification.find({ user: taggedUser._id });
    expect(taggedNotifs).toHaveLength(1);
    expect(taggedNotifs[0].type).toBe(NOTIFICATION_TYPES.MENTION);
    expect(taggedNotifs[0].message).toContain('tagged you in a comment');

    // Email domain 'email.com' should NOT receive any notifications
    const emailUser = await User.findOne({ username: 'email.com' });
    expect(emailUser).toBeNull();
  });

  it('respects site-wide global settings switches', async () => {
    const { user: recipient } = await createUser();
    const { user: actor } = await createUser();

    const settings = await SiteSettings.getSettings();
    settings.enableReplyNotifications = false;
    await settings.save();

    const res = await dispatchNotification({
      recipient,
      actor,
      type: NOTIFICATION_TYPES.REPLY,
      title: 'Disabled Reply',
      message: 'Should not deliver',
      channels: [NOTIFICATION_CHANNELS.IN_APP],
    });

    expect(res).toBeNull();

    // Re-enable
    settings.enableReplyNotifications = true;
    await settings.save();
  });

  it('dispatches admin campaign notifications to target audiences', async () => {
    const { admin, token } = await createAdmin();
    const { user: targetUser } = await createUser();

    const res = await api()
      .post('/api/admin/notifications/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Campaign Title',
        message: 'Campaign Message',
        link: '/browse',
        targetAudience: 'specific',
        targetUserId: targetUser._id,
        channels: ['in_app'],
      });

    expect(res.status).toBe(201);
    expect(res.body.campaign).toBeDefined();
    expect(res.body.campaign.title).toBe('Campaign Title');

    const campaignsRes = await api()
      .get('/api/admin/notifications/campaigns')
      .set('Authorization', `Bearer ${token}`);

    expect(campaignsRes.status).toBe(200);
    expect(campaignsRes.body.campaigns.length).toBeGreaterThan(0);
  });
});

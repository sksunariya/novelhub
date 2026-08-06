const Notification = require('../models/Notification');
const { NOTIFICATION_TYPES } = require('../config/constants');

// Notifies the author of a comment/review that someone replied. Replying to your
// own thread never produces a notification.
const notifyReply = async ({ recipient, actor, message, link }) => {
  if (!recipient || !actor || recipient.toString() === actor.toString()) {
    return null;
  }
  return Notification.create({
    user: recipient,
    type: NOTIFICATION_TYPES.REPLY,
    message,
    link: link || '',
  });
};

module.exports = { notifyReply };

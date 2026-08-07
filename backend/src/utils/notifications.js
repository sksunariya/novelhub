const { notifyCommentActivity, dispatchNotification } = require('../services/notificationService');

module.exports = {
  notifyReply: notifyCommentActivity,
  notifyCommentActivity,
  dispatchNotification,
};

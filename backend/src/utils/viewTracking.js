const ViewEvent = require('../models/ViewEvent');

const getViewerKey = (req) => (req.user ? `user:${req.user._id}` : `ip:${req.ip}`);

const registerView = async (targetType, targetId, viewerKey) => {
  try {
    await ViewEvent.create({ targetType, targetId, viewerKey });
    return true;
  } catch (error) {
    if (error.code === 11000) {
      return false;
    }
    throw error;
  }
};

module.exports = { getViewerKey, registerView };

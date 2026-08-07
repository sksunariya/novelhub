export const ANCHORS = {
  COMMENT: 'comment',
  REVIEW: 'review',
};

export const anchorId = (prefix, id) => `${prefix}-${id}`;

export const anchorLink = (path, prefix, id) => `${path}#${anchorId(prefix, id)}`;

// Reads the id out of a `#<prefix>-<id>` deep link, ignoring hashes meant for
// anything else.
export const readHashTarget = (hash, prefix) => {
  const marker = `#${prefix}-`;
  return hash && hash.startsWith(marker) ? hash.slice(marker.length) : '';
};

// Checks if a targetId exists either as a top-level item or as a reply within items.
export const isTargetInItems = (targetId, items) => {
  if (!targetId || !Array.isArray(items)) return false;
  return items.some((item) => {
    if (String(item._id) === String(targetId)) return true;
    if (Array.isArray(item.replies)) {
      return item.replies.some((reply) => String(reply._id) === String(targetId));
    }
    return false;
  });
};

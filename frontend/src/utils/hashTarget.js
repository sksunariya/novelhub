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

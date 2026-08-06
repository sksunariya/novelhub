const REACTIONS = {
  LIKE: 'likes',
  DISLIKE: 'dislikes',
};

const hasReaction = (list, userId) => (list || []).some((id) => id.toString() === userId.toString());

const withoutUser = (list, userId) => (list || []).filter((id) => id.toString() !== userId.toString());

// Toggles `field` for the user and clears the opposite reaction, so a document is
// never both liked and disliked by the same person.
const toggleReaction = (doc, field, userId) => {
  const opposite = field === REACTIONS.LIKE ? REACTIONS.DISLIKE : REACTIONS.LIKE;
  const wasActive = hasReaction(doc[field], userId);
  doc[field] = wasActive ? withoutUser(doc[field], userId) : [...(doc[field] || []), userId];
  if (!wasActive) {
    doc[opposite] = withoutUser(doc[opposite], userId);
  }
  return {
    liked: hasReaction(doc[REACTIONS.LIKE], userId),
    disliked: hasReaction(doc[REACTIONS.DISLIKE], userId),
    likeCount: (doc[REACTIONS.LIKE] || []).length,
    dislikeCount: (doc[REACTIONS.DISLIKE] || []).length,
  };
};

module.exports = { REACTIONS, toggleReaction };

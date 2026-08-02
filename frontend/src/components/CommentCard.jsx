import { useState } from 'react';
import { Heart, CornerDownRight, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import StarRating from './StarRating';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';

const checkUserMatch = (userRef, currentUser) => {
  if (!userRef || !currentUser) return false;
  const currentId = (currentUser.id || currentUser._id)?.toString();
  const refId = (userRef._id || userRef.id || userRef)?.toString();
  return Boolean(currentId && refId && currentId === refId);
};

const checkIsLiked = (likesArray, currentUser) => {
  if (!likesArray || !currentUser) return false;
  const currentId = (currentUser.id || currentUser._id)?.toString();
  return likesArray.some((id) => (id._id || id.id || id)?.toString() === currentId);
};

const CommentCard = ({
  item,
  currentUser,
  isAdmin,
  onLike,
  onDelete,
  onReplySubmit,
  onLikeReply,
  onDeleteReply,
}) => {
  const [showReplies, setShowReplies] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState('');

  const replies = item.replies || [];
  const liked = checkIsLiked(item.likes, currentUser);
  const isOwner = checkUserMatch(item.user, currentUser) || isAdmin;

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || submittingReply) return;
    setSubmittingReply(true);
    setReplyError('');
    try {
      await onReplySubmit(item._id, replyText);
      setReplyText('');
      setIsReplying(false);
      setShowReplies(true);
    } catch (err) {
      setReplyError(err.response?.data?.message || 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-night-surface p-4 shadow-sm transition-colors hover:border-line/80 space-y-3">
      {/* Header: User avatar, username, timestamp, rating (if review) & delete */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-crimson/20 text-xs font-bold uppercase text-crimson-soft">
            {item.user?.username?.slice(0, 2) || '??'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-silver">{item.user?.username || 'Deleted user'}</p>
            <p className="text-[11px] text-silver-muted" title={formatExactDateTime(item.createdAt)}>
              {formatRelativeTime(item.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {item.rating != null && <StarRating value={item.rating} size="h-3.5 w-3.5" />}
          {isOwner && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item._id)}
              className="flex cursor-pointer items-center justify-center p-1 text-silver-muted transition-colors hover:text-crimson-soft"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {item.content && (
        <p className="text-sm leading-relaxed text-silver-muted/90 whitespace-pre-line break-words">{item.content}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 text-xs text-silver-muted pt-1">
        {currentUser && onLike && (
          <button
            type="button"
            onClick={() => onLike(item._id)}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-crimson-soft"
          >
            <Heart
              className={`h-3.5 w-3.5 ${liked ? 'fill-crimson text-crimson' : ''}`}
              aria-hidden="true"
            />
            <span>{item.likes?.length || 0}</span>
          </button>
        )}

        {currentUser && onReplySubmit && (
          <button
            type="button"
            onClick={() => setIsReplying((v) => !v)}
            className="flex cursor-pointer items-center gap-1 transition-colors hover:text-crimson-soft"
          >
            <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reply</span>
          </button>
        )}

        {replies.length > 0 && (
          <button
            type="button"
            onClick={() => setShowReplies((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 font-medium text-crimson-soft transition-colors hover:underline"
          >
            {showReplies ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span>{showReplies ? 'Hide replies' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}</span>
          </button>
        )}
      </div>

      {/* Inline Reply Input */}
      {isReplying && (
        <form onSubmit={handleSendReply} className="mt-3 space-y-2 border-l-2 border-crimson/50 pl-3 pt-1">
          <div className="flex items-center justify-between text-xs text-silver-muted">
            <span>Replying to <strong className="text-crimson-soft">@{item.user?.username || 'User'}</strong></span>
            <button type="button" onClick={() => setIsReplying(false)} className="hover:underline">Cancel</button>
          </div>
          {replyError && <p className="text-xs text-crimson-soft">{replyError}</p>}
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={`Write a reply to @${item.user?.username || 'User'}...`}
            rows={2}
            className="w-full rounded-xl border border-line bg-night px-3 py-2 text-xs text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsReplying(false)}
              className="rounded-full border border-line px-3 py-1 text-xs text-silver-muted hover:text-silver"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!replyText.trim() || submittingReply}
              className="rounded-full bg-crimson px-4 py-1 text-xs font-semibold text-white transition-opacity hover:bg-crimson-soft disabled:opacity-50"
            >
              {submittingReply ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </form>
      )}

      {/* Collapsible Replies List */}
      {showReplies && replies.length > 0 && (
        <div className="mt-3 border-l-2 border-crimson/30 pl-3.5 space-y-2.5">
          {replies.map((reply) => {
            const replyLiked = checkIsLiked(reply.likes, currentUser);
            const isReplyOwner = checkUserMatch(reply.user, currentUser) || isAdmin;
            return (
              <div key={reply._id} className="rounded-xl border border-line/60 bg-night p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-crimson/20 text-[10px] font-bold uppercase text-crimson-soft">
                      {reply.user?.username?.slice(0, 2) || '??'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-silver">{reply.user?.username || 'Deleted user'}</p>
                      <p className="text-[10px] text-silver-muted" title={formatExactDateTime(reply.createdAt)}>
                        {formatRelativeTime(reply.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {currentUser && onLikeReply && (
                      <button
                        type="button"
                        onClick={() => onLikeReply(item._id, reply._id)}
                        className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted transition-colors hover:text-crimson-soft"
                        aria-label="Like reply"
                      >
                        <Heart
                          className={`h-3.5 w-3.5 ${replyLiked ? 'fill-crimson text-crimson' : ''}`}
                          aria-hidden="true"
                        />
                        <span>{reply.likes?.length || 0}</span>
                      </button>
                    )}
                    {isReplyOwner && onDeleteReply && (
                      <button
                        type="button"
                        onClick={() => onDeleteReply(item._id, reply._id)}
                        className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted transition-colors hover:text-crimson-soft"
                        aria-label="Delete reply"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-silver-muted/90 whitespace-pre-line break-words">{reply.content}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CommentCard;

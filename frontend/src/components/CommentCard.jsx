import { useState, useRef, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import StarRating from './StarRating';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';
import { anchorId } from '../utils/hashTarget';

const ADMIN_ROLE = 'admin';
const MENTION_PATTERN = /(@[a-zA-Z0-9_.-]+)/g;
const HIGHLIGHT_CLASS = 'ring-2 ring-crimson ring-offset-2 ring-offset-night';

const checkUserMatch = (userRef, currentUser) => {
  if (!userRef || !currentUser) return false;
  const currentId = (currentUser.id || currentUser._id)?.toString();
  const refId = (userRef._id || userRef.id || userRef)?.toString();
  return Boolean(currentId && refId && currentId === refId);
};

const checkHasReacted = (reactions, currentUser) => {
  if (!reactions || !currentUser) return false;
  const currentId = (currentUser.id || currentUser._id)?.toString();
  return reactions.some((id) => (id._id || id.id || id)?.toString() === currentId);
};

const renderContent = (content) => {
  if (!content) return null;
  return content.split(MENTION_PATTERN).map((part, index) => {
    if (part.startsWith('@')) {
      return (
        <span key={index} className="font-medium text-blue-400">
          {part}
        </span>
      );
    }
    return part;
  });
};

const StaffBadge = () => (
  <span className="rounded-full bg-crimson/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-crimson-soft">
    Staff
  </span>
);

const EditedMark = ({ editedAt }) =>
  editedAt ? (
    <span className="text-[10px] italic text-silver-muted" title={formatExactDateTime(editedAt)}>
      (edited)
    </span>
  ) : null;

const Avatar = ({ user, size }) =>
  user?.avatarUrl ? (
    <img
      src={user.avatarUrl}
      alt={user.username || ''}
      className={`${size} shrink-0 rounded-full border border-line object-cover shadow-sm`}
    />
  ) : (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-full border border-crimson/30 bg-crimson/20 font-bold uppercase text-crimson-soft shadow-sm`}
    >
      {user?.username?.slice(0, 2) || '??'}
    </span>
  );

const CommentCard = ({
  item,
  currentUser,
  isAdmin,
  anchorPrefix,
  targetId,
  onLike,
  onDislike,
  onDelete,
  onReplySubmit,
  onLikeReply,
  onDislikeReply,
  onDeleteReply,
}) => {
  const [showReplies, setShowReplies] = useState(false);
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState('');

  const textareaRef = useRef(null);
  const scrolledTargetRef = useRef('');

  const replies = item.replies || [];
  const liked = checkHasReacted(item.likes, currentUser);
  const disliked = checkHasReacted(item.dislikes, currentUser);
  const isOwner = checkUserMatch(item.user, currentUser) || isAdmin;
  const targetIsReply = Boolean(targetId) && replies.some((reply) => reply._id === targetId);
  const targetIsMine = targetId === item._id || targetIsReply;

  useEffect(() => {
    if (replyingToId && textareaRef.current) {
      const element = textareaRef.current;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [replyingToId]);

  // A deep-linked reply lives in a collapsed thread, so open it first and scroll
  // on the render that follows. Runs once per target, leaving the reader free to
  // collapse the thread again afterwards.
  useEffect(() => {
    if (!anchorPrefix || !targetIsMine || scrolledTargetRef.current === targetId) return;
    if (targetIsReply && !showReplies) {
      setShowReplies(true);
      return;
    }
    const element = document.getElementById(anchorId(anchorPrefix, targetId));
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledTargetRef.current = targetId;
    }
  }, [anchorPrefix, targetId, targetIsMine, targetIsReply, showReplies]);

  const elementId = (id) => (anchorPrefix ? anchorId(anchorPrefix, id) : undefined);

  const highlightClass = (id) => (anchorPrefix && targetId === id ? HIGHLIGHT_CLASS : '');

  const openReplyForm = (targetId, targetUsername) => {
    if (replyingToId === targetId) {
      setReplyingToId(null);
      setReplyText('');
      return;
    }
    setReplyingToId(targetId);
    setReplyText(`@${targetUsername} `);
    setReplyError('');
  };

  // Threads are two levels deep, so every reply is submitted against the
  // top-level item; the @mention records who was being answered.
  const handleSendReply = async (event) => {
    event.preventDefault();
    if (!replyText.trim() || submittingReply) return;
    setSubmittingReply(true);
    setReplyError('');
    try {
      await onReplySubmit(item._id, replyText);
      setReplyText('');
      setReplyingToId(null);
      setShowReplies(true);
    } catch (error) {
      setReplyError(error.response?.data?.message || 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const renderReplyForm = (targetUsername) => (
    <div className="mt-3 flex items-start gap-3 pl-1">
      <Avatar user={currentUser} size="h-8 w-8 text-xs" />
      <form onSubmit={handleSendReply} className="flex-1 space-y-2">
        <div className="flex items-center justify-between text-xs text-silver-muted">
          <span>
            Replying to <strong className="text-blue-400">@{targetUsername}</strong>
          </span>
        </div>
        {replyError && <p className="text-xs text-crimson-soft">{replyError}</p>}
        <div className="group relative">
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Add a reply..."
            rows={2}
            className="w-full resize-none border-b border-line bg-transparent py-2 text-sm text-silver transition-colors duration-200 placeholder:text-silver-muted focus:border-crimson focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                handleSendReply(e);
              }
            }}
          />
          <div className="absolute bottom-0 left-1/2 h-[2px] w-0 bg-crimson transition-all duration-300 group-focus-within:left-0 group-focus-within:w-full" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setReplyingToId(null);
              setReplyText('');
            }}
            className="rounded-full px-4 py-1.5 text-xs font-semibold text-silver transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!replyText.trim() || submittingReply}
            className="rounded-full bg-crimson px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submittingReply ? 'Replying...' : 'Reply'}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div
      id={elementId(item._id)}
      className={`flex scroll-mt-24 items-start gap-3.5 rounded-xl border border-line bg-night-surface p-4 shadow-sm transition-colors hover:border-line/80 ${highlightClass(
        item._id
      )}`}
    >
      <Avatar user={item.user} size="h-10 w-10 text-sm" />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="truncate text-sm font-semibold text-blue-400">{item.user?.username || 'Deleted user'}</span>
            {item.user?.role === ADMIN_ROLE && <StaffBadge />}
            <span className="text-[11px] text-silver-muted" title={formatExactDateTime(item.createdAt)}>
              {formatRelativeTime(item.createdAt)}
            </span>
            <EditedMark editedAt={item.editedAt} />
          </div>

          <div className="flex shrink-0 items-center gap-2">
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

        {item.content && (
          <p className="whitespace-pre-line break-words pt-0.5 text-sm leading-relaxed text-silver">
            {renderContent(item.content)}
          </p>
        )}

        <div className="flex items-center gap-1 pt-1 text-xs text-silver-muted">
          {currentUser && onLike && (
            <button
              type="button"
              onClick={() => onLike(item._id)}
              className="flex h-8 w-11 cursor-pointer items-center justify-center gap-1 rounded-full transition-colors hover:bg-white/10"
              aria-label="Like"
            >
              <ThumbsUp className={`h-4 w-4 ${liked ? 'fill-crimson text-crimson' : ''}`} aria-hidden="true" />
              <span className="text-[11px]">{item.likes?.length || ''}</span>
            </button>
          )}

          {currentUser && onDislike && (
            <button
              type="button"
              onClick={() => onDislike(item._id)}
              className="flex h-8 w-11 cursor-pointer items-center justify-center gap-1 rounded-full transition-colors hover:bg-white/10"
              aria-label="Dislike"
            >
              <ThumbsDown className={`h-4 w-4 ${disliked ? 'fill-silver text-silver' : ''}`} aria-hidden="true" />
              <span className="text-[11px]">{item.dislikes?.length || ''}</span>
            </button>
          )}

          {currentUser && onReplySubmit && (
            <button
              type="button"
              onClick={() => openReplyForm(item._id, item.user?.username || 'User')}
              className="ml-1 cursor-pointer rounded-full px-3 py-1.5 font-semibold transition-colors hover:bg-white/10"
            >
              Reply
            </button>
          )}
        </div>

        {replyingToId === item._id && renderReplyForm(item.user?.username || 'User')}

        {replies.length > 0 && (
          <div className="pt-1.5">
            <button
              type="button"
              onClick={() => setShowReplies((v) => !v)}
              className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-crimson-soft transition-all duration-200 hover:bg-crimson/10"
            >
              {showReplies ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>
                {showReplies
                  ? 'Hide replies'
                  : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </span>
            </button>
          </div>
        )}

        {showReplies && replies.length > 0 && (
          <div className="mt-3 space-y-4 pl-1">
            {replies.map((reply) => {
              const replyLiked = checkHasReacted(reply.likes, currentUser);
              const replyDisliked = checkHasReacted(reply.dislikes, currentUser);
              const isReplyOwner = checkUserMatch(reply.user, currentUser) || isAdmin;

              return (
                <div
                  key={reply._id}
                  id={elementId(reply._id)}
                  className={`scroll-mt-24 space-y-2 rounded-lg ${highlightClass(reply._id)}`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar user={reply.user} size="h-8 w-8 text-xs" />

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-semibold text-blue-400">
                            {reply.user?.username || 'Deleted user'}
                          </span>
                          {reply.user?.role === ADMIN_ROLE && <StaffBadge />}
                          <span className="text-[10px] text-silver-muted" title={formatExactDateTime(reply.createdAt)}>
                            {formatRelativeTime(reply.createdAt)}
                          </span>
                          <EditedMark editedAt={reply.editedAt} />
                        </div>

                        {isReplyOwner && onDeleteReply && (
                          <button
                            type="button"
                            onClick={() => onDeleteReply(item._id, reply._id)}
                            className="flex cursor-pointer items-center justify-center p-1 text-silver-muted transition-colors hover:text-crimson-soft"
                            aria-label="Delete reply"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      <p className="whitespace-pre-line break-words pt-0.5 text-xs leading-relaxed text-silver">
                        {renderContent(reply.content)}
                      </p>

                      <div className="flex items-center gap-1 pt-1 text-[10px] text-silver-muted">
                        {currentUser && onLikeReply && (
                          <button
                            type="button"
                            onClick={() => onLikeReply(item._id, reply._id)}
                            className="flex h-7 w-10 cursor-pointer items-center justify-center gap-1 rounded-full transition-colors hover:bg-white/10"
                            aria-label="Like reply"
                          >
                            <ThumbsUp
                              className={`h-3.5 w-3.5 ${replyLiked ? 'fill-crimson text-crimson' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="text-[10px]">{reply.likes?.length || ''}</span>
                          </button>
                        )}

                        {currentUser && onDislikeReply && (
                          <button
                            type="button"
                            onClick={() => onDislikeReply(item._id, reply._id)}
                            className="flex h-7 w-10 cursor-pointer items-center justify-center gap-1 rounded-full transition-colors hover:bg-white/10"
                            aria-label="Dislike reply"
                          >
                            <ThumbsDown
                              className={`h-3.5 w-3.5 ${replyDisliked ? 'fill-silver text-silver' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="text-[10px]">{reply.dislikes?.length || ''}</span>
                          </button>
                        )}

                        {currentUser && onReplySubmit && (
                          <button
                            type="button"
                            onClick={() => openReplyForm(reply._id, reply.user?.username || 'User')}
                            className="ml-1 cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
                          >
                            Reply
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {replyingToId === reply._id && renderReplyForm(reply.user?.username || 'User')}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentCard;

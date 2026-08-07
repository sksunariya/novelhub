import { useState } from 'react';
import { Ban, CornerDownRight, ExternalLink, Pencil, RotateCcw, ShieldOff, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import StarRating from '../../components/StarRating';
import { formatRelativeTime, formatExactDateTime } from '../../utils/dateUtils';
import { ADMIN_ROLE } from './constants';

const IconButton = ({ icon: Icon, label, onClick, danger }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised ${
      danger ? 'hover:text-crimson-soft' : 'hover:text-silver'
    }`}
  >
    <Icon className="h-4 w-4" aria-hidden="true" />
  </button>
);

const AuthorLine = ({ user, createdAt, editedAt, deletedAt }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-silver-muted">
    <span className="font-semibold text-silver" title={user?.username ? `@${user.username}` : ''}>
      {user?.fullName || user?.username || 'Deleted user'}
    </span>
    {user?.role === ADMIN_ROLE && (
      <span className="rounded-full bg-crimson/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-crimson-soft">
        Staff
      </span>
    )}
    {user?.banned && (
      <span className="rounded-full bg-crimson/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-crimson-soft">
        Banned
      </span>
    )}
    <span title={formatExactDateTime(createdAt)}>{formatRelativeTime(createdAt)}</span>
    {editedAt && <span className="italic">edited</span>}
    {deletedAt && (
      <span className="rounded-full bg-night-raised px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-silver-muted">
        Deleted
      </span>
    )}
  </div>
);

const ViewOnSiteLink = ({ link }) =>
  link ? (
    <Link
      to={link}
      className="flex items-center gap-1 text-xs text-crimson-soft hover:underline"
      target="_blank"
      rel="noreferrer"
    >
      <ExternalLink className="h-3 w-3" aria-hidden="true" /> View on site
    </Link>
  ) : null;

const ReactionCounts = ({ likes, dislikes }) => (
  <div className="flex items-center gap-3 text-xs text-silver-muted">
    <span className="flex items-center gap-1">
      <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" /> {likes?.length || 0}
    </span>
    <span className="flex items-center gap-1">
      <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" /> {dislikes?.length || 0}
    </span>
  </div>
);

const EditForm = ({ initialContent, initialRating, onCancel, onSave }) => {
  const [content, setContent] = useState(initialContent || '');
  const [rating, setRating] = useState(initialRating || 0);
  const [saving, setSaving] = useState(false);
  const ratingEditable = initialRating != null;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(ratingEditable ? { content, rating } : { content });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {ratingEditable && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-silver-muted">Rating</span>
          <StarRating value={rating} onChange={setRating} size="h-4 w-4" />
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        aria-label="Edit content"
        className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-1.5 text-xs font-semibold text-silver transition-colors hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || (!ratingEditable && !content.trim())}
          className="rounded-full bg-crimson px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};

const ReplyForm = ({ username, onCancel, onSend }) => {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!content.trim()) return;
    setSending(true);
    try {
      await onSend(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-l-2 border-crimson/50 pl-3">
      <p className="text-xs text-silver-muted">
        Replying as staff to <strong className="text-silver">{username || 'this user'}</strong>
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Write an official reply..."
        aria-label="Reply content"
        className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-1.5 text-xs font-semibold text-silver transition-colors hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={send}
          disabled={sending || !content.trim()}
          className="rounded-full bg-crimson px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send reply'}
        </button>
      </div>
    </div>
  );
};

const ModerationEntry = ({ entry, currentUserId, actions }) => {
  const [editingId, setEditingId] = useState(null);
  const [replying, setReplying] = useState(false);

  const renderActions = (target, isReply) => (
    <div className="flex shrink-0 items-center gap-0.5">
      {!target.deletedAt && (
        <IconButton
          icon={Pencil}
          label="Edit content"
          onClick={() => setEditingId(editingId === target.id ? null : target.id)}
        />
      )}
      {target.deletedAt ? (
        <IconButton icon={RotateCcw} label="Restore" onClick={() => actions.onRestore(target, isReply)} />
      ) : (
        <IconButton icon={Trash2} label="Delete" danger onClick={() => actions.onDelete(target, isReply)} />
      )}
      {target.user?._id && target.user._id !== currentUserId && (
        <IconButton
          icon={target.user.banned ? ShieldOff : Ban}
          label={target.user.banned ? `Unban ${target.user.username}` : `Ban ${target.user.username}`}
          danger={!target.user.banned}
          onClick={() => actions.onToggleBan(target.user)}
        />
      )}
    </div>
  );

  return (
    <div
      className={`rounded-xl border bg-night-surface p-4 ${
        entry.deletedAt ? 'border-crimson/30 opacity-75' : 'border-line'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AuthorLine
            user={entry.user}
            createdAt={entry.createdAt}
            editedAt={entry.editedAt}
            deletedAt={entry.deletedAt}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {entry.rating != null && <StarRating value={entry.rating} size="h-3.5 w-3.5" />}
            <p className="text-xs text-silver-muted">{entry.context}</p>
            {!entry.deletedAt && <ViewOnSiteLink link={entry.link} />}
          </div>
          {editingId === entry.id ? (
            <EditForm
              initialContent={entry.content}
              initialRating={entry.rating}
              onCancel={() => setEditingId(null)}
              onSave={async (payload) => {
                await actions.onEdit(entry, payload, false);
                setEditingId(null);
              }}
            />
          ) : (
            <p className="mt-2 whitespace-pre-line break-words text-sm text-silver">{entry.content || '—'}</p>
          )}
          <div className="mt-2 flex items-center gap-4">
            <ReactionCounts likes={entry.likes} dislikes={entry.dislikes} />
            {!entry.deletedAt && entry.canReply && (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-crimson-soft transition-colors hover:underline"
              >
                <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" /> Reply
              </button>
            )}
          </div>
        </div>
        {renderActions(entry, false)}
      </div>

      {replying && (
        <ReplyForm
          username={entry.user?.username}
          onCancel={() => setReplying(false)}
          onSend={async (content) => {
            await actions.onReply(entry, content);
            setReplying(false);
          }}
        />
      )}

      {entry.replies.length > 0 && (
        <div className="mt-3 space-y-3 border-l-2 border-line pl-3.5">
          {entry.replies.map((reply) => (
            <div key={reply.id} className={`flex items-start justify-between gap-3 ${reply.deletedAt ? 'opacity-75' : ''}`}>
              <div className="min-w-0 flex-1">
                <AuthorLine
                  user={reply.user}
                  createdAt={reply.createdAt}
                  editedAt={reply.editedAt}
                  deletedAt={reply.deletedAt}
                />
                {editingId === reply.id ? (
                  <EditForm
                    initialContent={reply.content}
                    onCancel={() => setEditingId(null)}
                    onSave={async (payload) => {
                      await actions.onEdit(reply, payload, true);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-silver">{reply.content}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-4">
                  <ReactionCounts likes={reply.likes} dislikes={reply.dislikes} />
                  {!reply.deletedAt && <ViewOnSiteLink link={reply.link} />}
                </div>
              </div>
              {renderActions(reply, true)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModerationEntry;

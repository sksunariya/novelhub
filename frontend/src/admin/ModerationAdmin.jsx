import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Search, Star } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';
import ModerationEntry from './moderation/ModerationEntry';
import { ANCHORS, anchorLink } from '../utils/hashTarget';
import { MODERATION_TABS, MODERATION_STATUS, NOVEL_FILTER_LIMIT, SEARCH_DEBOUNCE_MS } from './moderation/constants';

const TABS = [
  { key: MODERATION_TABS.COMMENTS, label: 'Comments', icon: MessageSquare },
  { key: MODERATION_TABS.REVIEWS, label: 'Reviews', icon: Star },
];

const STATUSES = [
  { key: MODERATION_STATUS.ACTIVE, label: 'Active' },
  { key: MODERATION_STATUS.DELETED, label: 'Deleted' },
];

// Every row deep-links to its own anchor so "View on site" lands on the exact
// comment or reply instead of the top of the page.
const toReply = (reply, parentId, page, prefix) => ({
  id: reply._id,
  parentId,
  user: reply.user,
  content: reply.content,
  createdAt: reply.createdAt,
  editedAt: reply.editedAt,
  deletedAt: reply.deletedAt,
  likes: reply.likes || [],
  dislikes: reply.dislikes || [],
  link: page ? anchorLink(page, prefix, reply._id) : null,
});

const commentToEntry = (comment) => {
  const page =
    comment.novel?.slug && comment.chapter ? `/novel/${comment.novel.slug}/chapter/${comment.chapter.number}` : null;
  return {
    id: comment._id,
    user: comment.user,
    content: comment.content,
    rating: null,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    deletedAt: comment.deletedAt,
    isPinned: comment.isPinned,
    likes: comment.likes || [],
    dislikes: comment.dislikes || [],
    chapterId: comment.chapter?._id || null,
    canReply: Boolean(comment.chapter?._id),
    context: `${comment.novel?.title || 'Deleted novel'}${comment.chapter ? ` · Ch. ${comment.chapter.number}` : ''}`,
    link: page ? anchorLink(page, ANCHORS.COMMENT, comment._id) : null,
    replies: (comment.replies || []).map((reply) => toReply(reply, comment._id, page, ANCHORS.COMMENT)),
  };
};

const reviewToEntry = (review) => {
  // A chapter review has no public thread of its own yet, so it links to its chapter
  // page rather than to an anchor.
  const novelPage = review.novel?.slug ? `/novel/${review.novel.slug}` : null;
  const page = review.chapter && novelPage ? `${novelPage}/chapter/${review.chapter.number}` : novelPage;
  return {
    id: review._id,
    user: review.user,
    content: review.content,
    rating: review.rating,
    createdAt: review.createdAt,
    editedAt: review.editedAt,
    deletedAt: review.deletedAt,
    isPinned: review.isPinned,
    likes: review.likes || [],
    dislikes: review.dislikes || [],
    canReply: true,
    context: `${review.novel?.title || 'Deleted novel'}${
      review.chapter ? ` · Ch. ${review.chapter.number} review` : ' · novel review'
    }`,
    link: page && !review.chapter ? anchorLink(page, ANCHORS.REVIEW, review._id) : page,
    replies: (review.replies || []).map((reply) =>
      toReply(reply, review._id, review.chapter ? null : page, ANCHORS.REVIEW)
    ),
  };
};

const ModerationAdmin = () => {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState(MODERATION_TABS.COMMENTS);
  const [status, setStatus] = useState(MODERATION_STATUS.ACTIVE);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [novelId, setNovelId] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState(null);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [novels, setNovels] = useState([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    client
      .get('/admin/novels', { params: { limit: NOVEL_FILTER_LIMIT } })
      .then(({ data }) => setNovels(data.novels))
      .catch(() => setNovels([]));
  }, []);

  // Typing should not fire a request per keystroke, nor blank the list while typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setEntries(null);
    const params = { page, status };
    if (search.trim()) params.search = search.trim();
    if (novelId) params.novel = novelId;
    try {
      const { data } = await client.get(`/admin/${tab}`, { params });
      const items = tab === MODERATION_TABS.COMMENTS ? data.comments.map(commentToEntry) : data.reviews.map(reviewToEntry);
      setEntries(items);
      setMeta({ pages: data.pages, total: data.total });
      setMessage('');
      // A delete can empty the last page; step back rather than show an empty view.
      if (!items.length && page > 1 && page > data.pages) {
        setPage(Math.max(data.pages, 1));
      }
    } catch (error) {
      setMessage(error.response?.data?.message || 'Failed to load moderation queue');
      setEntries([]);
    }
  }, [tab, status, search, novelId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action) => {
    setMessage('');
    try {
      await action();
      await load(false);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Action failed');
    }
  };

  const isComments = tab === MODERATION_TABS.COMMENTS;

  const actions = {
    onReply: (entry, content) =>
      run(() =>
        isComments
          ? client.post(`/community/chapters/${entry.chapterId}/comments`, { content, parentComment: entry.id })
          : client.post(`/community/reviews/${entry.id}/replies`, { content })
      ),
    onEdit: (target, payload, isReply) =>
      run(() => {
        if (isComments) {
          return client.put(`/admin/comments/${target.id}`, payload);
        }
        return isReply
          ? client.put(`/admin/reviews/${target.parentId}/replies/${target.id}`, { content: payload.content })
          : client.put(`/admin/reviews/${target.id}`, payload);
      }),
    onDelete: (target, isReply) => {
      if (!window.confirm(`Delete this ${isReply ? 'reply' : tab.slice(0, -1)}?`)) return undefined;
      return run(() => {
        if (isComments) {
          return client.delete(`/community/comments/${target.id}`);
        }
        return isReply
          ? client.delete(`/community/reviews/${target.parentId}/replies/${target.id}`)
          : client.delete(`/community/reviews/${target.id}`);
      });
    },
    onRestore: (target, isReply) =>
      run(() => {
        if (isComments) {
          return client.post(`/admin/comments/${target.id}/restore`);
        }
        return isReply
          ? client.post(`/admin/reviews/${target.parentId}/replies/${target.id}/restore`)
          : client.post(`/admin/reviews/${target.id}/restore`);
      }),
    onPin: (target) =>
      run(() =>
        isComments
          ? client.post(`/community/comments/${target.id}/pin`)
          : client.post(`/community/reviews/${target.id}/pin`)
      ),
    onLike: (target, isReply) =>
      run(() => {
        if (isComments) {
          return client.post(`/community/comments/${target.id}/like`);
        }
        return isReply
          ? client.post(`/community/reviews/${target.parentId}/replies/${target.id}/like`)
          : client.post(`/community/reviews/${target.id}/like`);
      }),
    onDislike: (target, isReply) =>
      run(() => {
        if (isComments) {
          return client.post(`/community/comments/${target.id}/dislike`);
        }
        return isReply
          ? client.post(`/community/reviews/${target.parentId}/replies/${target.id}/dislike`)
          : client.post(`/community/reviews/${target.id}/dislike`);
      }),
    onToggleBan: (author) => {
      if (!window.confirm(`${author.banned ? 'Unban' : 'Ban'} "${author.username}"?`)) return undefined;
      return run(() => client.put(`/admin/users/${author._id}`, { banned: !author.banned }));
    },
  };

  const changeFilter = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  const filterClass =
    'rounded-full border border-line bg-night-surface px-4 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">Moderation</h1>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Moderation type">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => changeFilter(setTab)(item.key)}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.key ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
            }`}
          >
            <item.icon className="h-4 w-4" aria-hidden="true" /> {item.label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border border-line p-1">
          {STATUSES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => changeFilter(setStatus)(item.key)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                status === item.key ? 'bg-crimson text-white' : 'text-silver-muted hover:text-silver'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search content or author..."
            aria-label="Search moderation queue"
            className={`${filterClass} w-full pl-10`}
          />
        </div>

        <select
          value={novelId}
          onChange={(e) => changeFilter(setNovelId)(e.target.value)}
          aria-label="Filter by novel"
          className={filterClass}
        >
          <option value="">All novels</option>
          {novels.map((novel) => (
            <option key={novel._id} value={novel._id}>
              {novel.title}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <p className="mb-4 rounded-lg border border-crimson/40 bg-crimson/10 px-4 py-2 text-sm text-crimson-soft">{message}</p>
      )}

      {entries === null ? (
        <Spinner full />
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">
          No {status === MODERATION_STATUS.DELETED ? 'deleted ' : ''}
          {tab} found.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <ModerationEntry key={entry.id} entry={entry} currentUserId={currentUser?.id || currentUser?._id} actions={actions} />
          ))}
        </div>
      )}

      <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </div>
  );
};

export default ModerationAdmin;

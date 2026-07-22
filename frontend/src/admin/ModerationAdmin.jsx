import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Star, Trash2 } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import StarRating from '../components/StarRating';

const ModerationAdmin = () => {
  const [tab, setTab] = useState('comments');
  const [comments, setComments] = useState(null);
  const [reviews, setReviews] = useState(null);

  const load = useCallback(() => {
    if (tab === 'comments') {
      client.get('/admin/comments').then(({ data }) => setComments(data.comments)).catch(() => setComments([]));
    } else {
      client.get('/admin/reviews').then(({ data }) => setReviews(data.reviews)).catch(() => setReviews([]));
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const removeComment = async (id) => {
    if (!window.confirm('Delete this comment?')) return;
    await client.delete(`/community/comments/${id}`);
    load();
  };

  const removeReview = async (id) => {
    if (!window.confirm('Delete this review?')) return;
    await client.delete(`/community/reviews/${id}`);
    load();
  };

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">Moderation</h1>
      <div className="mb-6 flex gap-2" role="tablist" aria-label="Moderation type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'comments'}
          onClick={() => setTab('comments')}
          className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'comments' ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
          }`}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" /> Comments
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reviews'}
          onClick={() => setTab('reviews')}
          className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'reviews' ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
          }`}
        >
          <Star className="h-4 w-4" aria-hidden="true" /> Reviews
        </button>
      </div>

      {tab === 'comments' &&
        (comments === null ? (
          <Spinner full />
        ) : comments.length === 0 ? (
          <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">No comments.</p>
        ) : (
          <div className="space-y-2">
            {comments.map((comment) => (
              <div key={comment._id} className="flex items-start gap-3 rounded-xl border border-line bg-night-surface p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-silver">{comment.content}</p>
                  <p className="mt-1.5 text-xs text-silver-muted">
                    {comment.user?.username || 'Deleted user'} · {comment.novel?.title || 'Deleted novel'}
                    {comment.chapter ? ` · Ch. ${comment.chapter.number}` : ''} · {new Date(comment.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeComment(comment._id)}
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft"
                  aria-label="Delete comment"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ))}

      {tab === 'reviews' &&
        (reviews === null ? (
          <Spinner full />
        ) : reviews.length === 0 ? (
          <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">No reviews.</p>
        ) : (
          <div className="space-y-2">
            {reviews.map((review) => (
              <div key={review._id} className="flex items-start gap-3 rounded-xl border border-line bg-night-surface p-4">
                <div className="min-w-0 flex-1">
                  <StarRating value={review.rating} size="h-3.5 w-3.5" />
                  {review.content && <p className="mt-1.5 text-sm text-silver">{review.content}</p>}
                  <p className="mt-1.5 text-xs text-silver-muted">
                    {review.user?.username || 'Deleted user'} · {review.novel?.title || 'Deleted novel'} · {new Date(review.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeReview(review._id)}
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft"
                  aria-label="Delete review"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
};

export default ModerationAdmin;

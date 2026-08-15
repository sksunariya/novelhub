// Layout-stable loading state.
//
// The dimensions match a real PostCard, so content replacing a skeleton does
// not shift the page. A skeleton that is the wrong size is worse than a
// spinner — it causes the exact layout shift it is meant to prevent.

const FeedSkeleton = ({ count = 5 }) => (
  <div aria-busy="true" aria-live="polite" className="space-y-3">
    <span className="sr-only">Loading posts</span>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="flex gap-3 rounded-xl border border-line bg-night-surface p-3">
        <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1">
          <div className="h-5 w-5 animate-pulse rounded bg-night-raised" />
          <div className="h-3 w-6 animate-pulse rounded bg-night-raised" />
          <div className="h-5 w-5 animate-pulse rounded bg-night-raised" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="h-3 w-40 animate-pulse rounded bg-night-raised" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-night-raised" />
          <div className="h-3 w-full animate-pulse rounded bg-night-raised" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-night-raised" />
        </div>
      </div>
    ))}
  </div>
);

export default FeedSkeleton;

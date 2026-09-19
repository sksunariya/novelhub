import { Link } from 'react-router-dom';
import { BookOpen, History, Play } from 'lucide-react';
import { formatRelativeTime } from '../../utils/dateUtils';

// "Pick up where you left off" for signed-in readers: the single most useful
// thing a returning reader can see first. Built from the reading history the
// library page already uses, newest first.

const MAX_ITEMS = 6;

const ContinueReading = ({ history }) => {
  const items = (history || []).filter((entry) => entry.novel?.slug).slice(0, MAX_ITEMS);
  if (!items.length) return null;

  return (
    <section aria-labelledby="continue-title">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-crimson/15 text-crimson-soft ring-1 ring-inset ring-white/[0.06] sm:grid" aria-hidden="true">
            <History className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="continue-title" className="section-title truncate">Continue reading</h2>
            <p className="mt-0.5 truncate text-sm text-silver-muted">Pick up right where you left off</p>
          </div>
        </div>
        <Link to="/library?tab=history" className="shrink-0 rounded-full px-2 py-1 text-sm font-semibold text-crimson-soft transition-colors hover:text-silver">
          History
        </Link>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {items.map((entry) => {
          const { novel } = entry;
          const total = novel.chapterCount || 0;
          const progress = total ? Math.min(100, Math.round((entry.chapterNumber / total) * 100)) : 0;
          return (
            <Link
              key={entry._id || novel.slug}
              to={`/novel/${novel.slug}/chapter/${entry.chapterNumber}`}
              className="group flex w-[82%] shrink-0 snap-start items-center gap-4 rounded-2xl border border-line bg-night-surface/80 p-3 pr-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-crimson-soft/40 sm:w-auto"
            >
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-night-raised ring-1 ring-white/10">
                {novel.coverUrl ? (
                  <img src={novel.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <BookOpen className="h-5 w-5 text-silver-muted" aria-hidden="true" />
                  </div>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
                  <Play className="h-6 w-6 fill-white text-white" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-silver transition-colors group-hover:text-crimson-soft">{novel.title}</p>
                <p className="mt-0.5 truncate text-xs text-silver-muted">
                  Chapter {entry.chapterNumber}
                  {entry.chapter?.title ? ` · ${entry.chapter.title}` : ''}
                </p>
                {total > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-night-raised">
                      <div className="h-full rounded-full bg-gradient-to-r from-crimson to-crimson-alt" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-1.5 flex justify-between text-[11px] text-silver-muted">
                      <span>{progress}% read</span>
                      {entry.updatedAt && <span>{formatRelativeTime(entry.updatedAt)}</span>}
                    </p>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default ContinueReading;

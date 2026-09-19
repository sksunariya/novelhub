import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Library as LibraryIcon, History, BookOpen, ChevronRight, Compass, Play } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import { formatRelativeTime } from '../utils/dateUtils';

const TABS = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'history', label: 'History', icon: History },
];

const Cover = ({ novel, className = '' }) => (
  <div className={`shrink-0 overflow-hidden rounded-lg bg-night-raised ring-1 ring-white/10 ${className}`}>
    {novel?.coverUrl ? (
      <img src={novel.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full items-center justify-center">
        <BookOpen className="h-5 w-5 text-silver-muted" aria-hidden="true" />
      </div>
    )}
  </div>
);

const EmptyState = ({ icon: Icon, title, body, action }) => (
  <div className="panel flex flex-col items-center px-6 py-16 text-center">
    <span className="grid h-14 w-14 place-items-center rounded-2xl bg-crimson/15 text-crimson-soft">
      <Icon className="h-7 w-7" aria-hidden="true" />
    </span>
    <p className="mt-4 font-display text-lg font-bold text-silver">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-silver-muted">{body}</p>
    {action}
  </div>
);

const ListSkeleton = ({ rows = 4, tall = false }) => (
  <div className={tall ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2.5'} aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={`skeleton rounded-2xl ${tall ? 'h-36' : 'h-20'}`} />
    ))}
  </div>
);

const Library = () => {
  const { user, updateUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'library';
  const [library, setLibrary] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (tab === 'library' && library === null) {
      client.get('/library').then(({ data }) => setLibrary(data.novels)).catch(() => setLibrary([]));
    }
    if (tab === 'history' && history === null) {
      client.get('/library/history/list').then(({ data }) => setHistory(data.history)).catch(() => setHistory([]));
    }
  }, [tab, library, history]);

  const removeFromLibrary = async (novelId) => {
    const { data } = await client.post(`/library/${novelId}`);
    updateUser({ ...user, library: data.library });
    setLibrary((items) => items.filter((item) => item.novel._id !== novelId));
  };

  return (
    <PageTransition>
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow"><LibraryIcon className="h-3.5 w-3.5" aria-hidden="true" /> Your shelf</p>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-silver sm:text-4xl">My Library</h1>
          <p className="mt-2 text-sm text-silver-muted">Everything you are reading, saved and synced to your account.</p>
        </div>
        <div className="segmented self-start sm:self-auto" role="tablist" aria-label="Library sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams({ tab: t.id })}
              className={`segment ${tab === t.id ? 'segment-active' : ''}`}
            >
              <t.icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'library' &&
        (library === null ? (
          <ListSkeleton rows={6} tall />
        ) : library.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Your library is empty"
            body="Add novels from their page and they will wait for you here, with your place saved."
            action={
              <Link to="/browse" className="btn btn-primary btn-md mt-6">
                <Compass className="h-4 w-4" aria-hidden="true" /> Find something to read
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {library.map(({ novel, progress }) => {
              const total = novel.chapterCount || 0;
              const readTo = progress?.chapterNumber || 0;
              const pct = total ? Math.min(100, Math.round((readTo / total) * 100)) : 0;
              return (
                <div key={novel._id} className="panel flex gap-4 p-4 transition-colors hover:border-crimson-soft/30">
                  <Link to={`/novel/${novel.slug}`} className="h-32 w-[5.25rem] shrink-0">
                    <Cover novel={novel} className="h-full w-full" />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link to={`/novel/${novel.slug}`} className="line-clamp-2 font-semibold leading-snug text-silver transition-colors hover:text-crimson-soft">
                      {novel.title}
                    </Link>
                    <p className="mt-1 text-xs text-silver-muted">
                      {progress ? `Read up to Ch. ${progress.chapterNumber}` : 'Not started'} · {total} chapters
                    </p>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-night-raised" aria-hidden="true">
                      <div className="h-full rounded-full bg-gradient-to-r from-crimson to-crimson-alt" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-3">
                      <Link
                        to={`/novel/${novel.slug}/chapter/${progress ? progress.chapterNumber : 1}`}
                        className="btn btn-primary btn-sm"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                        {progress ? 'Continue' : 'Start'}
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeFromLibrary(novel._id)}
                        className="btn btn-ghost btn-sm hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {tab === 'history' &&
        (history === null ? (
          <ListSkeleton rows={6} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={History}
            title="No reading history yet"
            body="Chapters you open are remembered here, so you can always jump back in."
            action={
              <Link to="/browse" className="btn btn-secondary btn-md mt-6">Browse novels</Link>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {history.map((entry) => (
              <li key={entry._id}>
                <Link
                  to={`/novel/${entry.novel.slug}/chapter/${entry.chapterNumber}`}
                  className="group flex items-center gap-4 rounded-2xl border border-line bg-night-surface/70 p-3 pr-4 transition-colors hover:border-crimson-soft/40 hover:bg-night-surface"
                >
                  <Cover novel={entry.novel} className="h-16 w-11" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-silver transition-colors group-hover:text-crimson-soft">{entry.novel.title}</p>
                    <p className="truncate text-sm text-silver-muted">
                      Chapter {entry.chapterNumber}
                      {entry.chapter?.title ? `: ${entry.chapter.title}` : ''}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-xs text-silver-muted sm:block" title={new Date(entry.updatedAt).toLocaleString()}>
                    {formatRelativeTime(entry.updatedAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-silver-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </PageTransition>
  );
};

export default Library;

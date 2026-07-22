import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Library as LibraryIcon, History, BookOpen } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

const TABS = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'history', label: 'History', icon: History },
];

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
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">My Library</h1>
      <div className="mb-6 flex gap-2" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
            }`}
          >
            <t.icon className="h-4 w-4" aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'library' &&
        (library === null ? (
          <Spinner full />
        ) : library.length === 0 ? (
          <div className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">
            <BookOpen className="mx-auto mb-2 h-8 w-8" aria-hidden="true" />
            <p>Your library is empty.</p>
            <Link to="/browse" className="mt-1 inline-block text-sm text-crimson-soft hover:underline">Find something to read</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {library.map(({ novel, progress }) => (
              <div key={novel._id} className="flex flex-col gap-3 rounded-xl border border-line bg-night-surface p-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-4 sm:contents">
                  <Link to={`/novel/${novel.slug}`} className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-night-raised">
                    {novel.coverUrl && <img src={novel.coverUrl} alt="" className="h-full w-full object-cover" />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/novel/${novel.slug}`} className="truncate font-semibold text-silver hover:text-crimson-soft">
                      {novel.title}
                    </Link>
                    <p className="text-sm text-silver-muted">
                      {progress ? `Read up to Ch. ${progress.chapterNumber}` : 'Not started'} · {novel.chapterCount} chapters
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/novel/${novel.slug}/chapter/${progress ? progress.chapterNumber : 1}`}
                    className="flex-1 rounded-full bg-crimson px-4 py-2 text-center text-xs font-semibold text-white transition-colors hover:bg-crimson-soft sm:flex-none sm:py-1.5"
                  >
                    {progress ? 'Continue' : 'Start'}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeFromLibrary(novel._id)}
                    className="flex-1 cursor-pointer rounded-full border border-line px-4 py-2 text-xs text-silver-muted transition-colors hover:border-crimson/60 hover:text-crimson-soft sm:flex-none sm:py-1.5"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'history' &&
        (history === null ? (
          <Spinner full />
        ) : history.length === 0 ? (
          <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">No reading history yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <Link
                key={entry._id}
                to={`/novel/${entry.novel.slug}/chapter/${entry.chapterNumber}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-night-surface px-4 py-3 transition-colors hover:border-crimson/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-silver">{entry.novel.title}</p>
                  <p className="text-sm text-silver-muted">
                    Chapter {entry.chapterNumber}
                    {entry.chapter?.title ? `: ${entry.chapter.title}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-silver-muted">{new Date(entry.updatedAt).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        ))}
    </PageTransition>
  );
};

export default Library;

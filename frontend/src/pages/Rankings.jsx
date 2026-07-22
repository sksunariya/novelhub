import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, Trophy, Star, Clock, BookOpen } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

const TABS = [
  { type: 'trending', label: 'Trending', icon: Flame },
  { type: 'popular', label: 'All-Time', icon: Trophy },
  { type: 'rating', label: 'Top Rated', icon: Star },
  { type: 'new', label: 'New', icon: Clock },
];

const Rankings = () => {
  const [type, setType] = useState('trending');
  const [novels, setNovels] = useState(null);

  useEffect(() => {
    setNovels(null);
    client
      .get(`/novels/rankings?type=${type}&limit=20`)
      .then(({ data }) => setNovels(data.novels))
      .catch(() => setNovels([]));
  }, [type]);

  return (
    <PageTransition>
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">Rankings</h1>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Ranking type">
        {TABS.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={type === tab.type}
            onClick={() => setType(tab.type)}
            className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              type === tab.type ? 'bg-crimson text-white shadow-glow' : 'border border-line text-silver-muted hover:text-silver'
            }`}
          >
            <tab.icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      {!novels ? (
        <Spinner full />
      ) : (
        <ol className="space-y-3">
          {novels.map((novel, index) => (
            <motion.li
              key={novel._id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.5) }}
            >
              <Link
                to={`/novel/${novel.slug}`}
                className="flex items-center gap-4 rounded-xl border border-line bg-night-surface p-3 transition-colors duration-200 hover:border-crimson/50"
              >
                <span
                  className={`w-10 shrink-0 text-center font-display text-2xl font-black ${
                    index < 3 ? 'text-crimson' : 'text-silver-muted'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-night-raised">
                  {novel.coverUrl ? (
                    <img src={novel.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <BookOpen className="h-5 w-5 text-silver-muted" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold text-silver">{novel.title}</h2>
                  <p className="truncate text-sm text-silver-muted">{novel.author}</p>
                </div>
                <div className="hidden shrink-0 text-right text-sm text-silver-muted sm:block">
                  <p className="flex items-center justify-end gap-1">
                    <Star className="h-3.5 w-3.5 fill-crimson text-crimson" aria-hidden="true" />
                    {novel.ratingAvg ? novel.ratingAvg.toFixed(1) : '—'}
                  </p>
                  <p className="mt-0.5">{(novel.views || 0).toLocaleString()} views</p>
                </div>
              </Link>
            </motion.li>
          ))}
        </ol>
      )}
    </PageTransition>
  );
};

export default Rankings;

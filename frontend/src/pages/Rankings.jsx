import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, Trophy, Star, Clock, BookOpen, Eye } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';

const TABS = [
  { type: 'trending', label: 'Trending', icon: Flame, blurb: 'Climbing fastest this week' },
  { type: 'popular', label: 'All-Time', icon: Trophy, blurb: 'The most-read stories ever' },
  { type: 'rating', label: 'Top Rated', icon: Star, blurb: 'Loved most by readers' },
  { type: 'new', label: 'New', icon: Clock, blurb: 'Fresh arrivals worth a look' },
];

// Gold, silver, bronze for the podium.
const MEDALS = [
  { text: 'from-amber-200 via-yellow-400 to-amber-600', ring: 'ring-amber-300/40', glow: 'bg-amber-400/20' },
  { text: 'from-slate-100 via-slate-300 to-slate-500', ring: 'ring-slate-300/30', glow: 'bg-slate-300/10' },
  { text: 'from-orange-200 via-orange-400 to-amber-800', ring: 'ring-orange-300/30', glow: 'bg-orange-400/10' },
];

const Cover = ({ novel, className }) => (
  <div className={`shrink-0 overflow-hidden rounded-lg bg-night-raised ring-1 ring-white/10 ${className}`}>
    {novel.coverUrl ? (
      <img src={novel.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full items-center justify-center">
        <BookOpen className="h-5 w-5 text-silver-muted" aria-hidden="true" />
      </div>
    )}
  </div>
);

const Stats = ({ novel }) => (
  <div className="flex items-center gap-3 text-xs text-silver-muted">
    <span className="flex items-center gap-1 font-semibold text-amber-300">
      <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
      {novel.ratingAvg ? novel.ratingAvg.toFixed(1) : '—'}
    </span>
    <span className="flex items-center gap-1">
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      {(novel.views || 0).toLocaleString()}
    </span>
  </div>
);

const PodiumCard = ({ novel, rank, index }) => {
  const medal = MEDALS[rank - 1];
  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
    >
      <Link
        to={`/novel/${novel.slug}`}
        className={`group relative flex h-full items-center gap-4 overflow-hidden rounded-2xl border border-line bg-night-surface/80 p-4 shadow-card ring-1 ring-inset transition duration-200 hover:-translate-y-0.5 hover:border-crimson-soft/40 sm:p-5 ${medal.ring}`}
      >
        <span className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl ${medal.glow}`} aria-hidden="true" />
        <Cover novel={novel} className="h-28 w-[4.75rem]" />
        <div className="relative min-w-0 flex-1">
          <span className={`bg-gradient-to-b bg-clip-text font-display text-4xl font-extrabold leading-none text-transparent ${medal.text}`}>
            #{rank}
          </span>
          <h2 className="mt-2 line-clamp-2 font-semibold leading-snug text-silver transition-colors group-hover:text-crimson-soft">
            {novel.title}
          </h2>
          <p className="mt-0.5 truncate text-sm text-silver-muted">{novel.author}</p>
          <div className="mt-2.5">
            <Stats novel={novel} />
          </div>
        </div>
      </Link>
    </motion.li>
  );
};

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

  const activeTab = TABS.find((tab) => tab.type === type);
  const podium = (novels || []).slice(0, 3);
  const rest = (novels || []).slice(3);

  return (
    <PageTransition>
      <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow"><Trophy className="h-3.5 w-3.5" aria-hidden="true" /> Leaderboard</p>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-silver sm:text-4xl">Rankings</h1>
          <p className="mt-2 text-sm text-silver-muted">{activeTab?.blurb}</p>
        </div>
        <div className="segmented no-scrollbar max-w-full self-start overflow-x-auto md:self-auto" role="tablist" aria-label="Ranking type">
          {TABS.map((tab) => (
            <button
              key={tab.type}
              type="button"
              role="tab"
              aria-selected={type === tab.type}
              onClick={() => setType(tab.type)}
              className={`segment ${type === tab.type ? 'segment-active' : ''}`}
            >
              <tab.icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {!novels ? (
        <div className="space-y-6" aria-hidden="true">
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-2xl" />)}
          </div>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
        </div>
      ) : novels.length === 0 ? (
        <p className="panel py-16 text-center text-sm text-silver-muted">No rankings yet — check back soon.</p>
      ) : (
        <>
          <ol className="grid gap-4 md:grid-cols-3" aria-label="Top three">
            {podium.map((novel, index) => (
              <PodiumCard key={novel._id} novel={novel} rank={index + 1} index={index} />
            ))}
          </ol>

          {rest.length > 0 && (
            <ol className="mt-6 space-y-2.5" start={4}>
              {rest.map((novel, index) => (
                <motion.li
                  key={novel._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(index * 0.035, 0.5) }}
                >
                  <Link
                    to={`/novel/${novel.slug}`}
                    className="group flex items-center gap-4 rounded-2xl border border-line bg-night-surface/70 p-3 pr-4 transition duration-200 hover:border-crimson-soft/40 hover:bg-night-surface sm:gap-5"
                  >
                    <span className="w-9 shrink-0 text-center font-display text-xl font-extrabold tabular-nums text-silver-muted/80 sm:w-12 sm:text-2xl">
                      {index + 4}
                    </span>
                    <Cover novel={novel} className="h-[4.5rem] w-12" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold text-silver transition-colors group-hover:text-crimson-soft">{novel.title}</h2>
                      <p className="truncate text-sm text-silver-muted">{novel.author}</p>
                      <div className="mt-1.5 sm:hidden">
                        <Stats novel={novel} />
                      </div>
                    </div>
                    <div className="hidden shrink-0 sm:block">
                      <Stats novel={novel} />
                    </div>
                  </Link>
                </motion.li>
              ))}
            </ol>
          )}
        </>
      )}
    </PageTransition>
  );
};

export default Rankings;

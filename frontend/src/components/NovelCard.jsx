import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, BookOpen } from 'lucide-react';

// Status as a coloured dot on a glass pill: readable over any cover art, and
// the colour is never the only signal because the word is always there too.
const STATUS_DOT = {
  ongoing: 'bg-sky-400',
  completed: 'bg-emerald-400',
  hiatus: 'bg-amber-400',
};

const NovelCard = ({ novel, index = 0 }) => {
  if (!novel) return null;
  const rating = novel.ratingAvg ? novel.ratingAvg.toFixed(1) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4), ease: 'easeOut' }}
      className="h-full"
    >
      <Link to={`/novel/${novel.slug}`} className="group block rounded-xl focus-visible:outline-none" title={novel.title}>
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-night-raised shadow-card ring-1 ring-white/[0.08] transition duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-lift group-hover:ring-crimson-soft/40 group-focus-visible:ring-2 group-focus-visible:ring-crimson-soft">
          {novel.coverUrl ? (
            <img
              src={novel.coverUrl}
              alt={`Cover of ${novel.title}`}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-night-raised via-night-surface to-crimson/20 p-3 text-center">
              <BookOpen className="h-8 w-8 text-silver-muted/70" aria-hidden="true" />
              <span className="line-clamp-3 font-display text-xs font-bold text-silver/80">{novel.title}</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
          {novel.status && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold capitalize text-white/90 backdrop-blur-md">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[novel.status] || 'bg-white/70'}`} aria-hidden="true" />
              {novel.status}
            </span>
          )}
          {rating && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              {rating}
              <span className="sr-only"> out of 5</span>
            </span>
          )}
        </div>
        <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-silver transition-colors group-hover:text-crimson-soft">
          {novel.title}
        </h3>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-silver-muted">
          <span className="truncate">{novel.author}</span>
          {novel.chapterCount > 0 && (
            <>
              <span aria-hidden="true" className="text-silver-muted/50">•</span>
              <span className="shrink-0">{novel.chapterCount} ch</span>
            </>
          )}
        </p>
      </Link>
    </motion.div>
  );
};

export default NovelCard;

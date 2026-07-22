import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, BookOpen } from 'lucide-react';

const NovelCard = ({ novel, index = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4), ease: 'easeOut' }}
    whileHover={{ y: -6 }}
  >
    <Link
      to={`/novel/${novel.slug}`}
      className="group block overflow-hidden rounded-xl border border-line bg-night-surface shadow-card transition-colors duration-200 hover:border-crimson/50 hover:shadow-glow"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-night-raised">
        {novel.coverUrl ? (
          <img
            src={novel.coverUrl}
            alt={`Cover of ${novel.title}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <BookOpen className="h-10 w-10 text-silver-muted" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium capitalize text-silver backdrop-blur">
          {novel.status}
        </span>
      </div>
      <div className="p-3">
        <h3 className="truncate font-semibold text-silver group-hover:text-crimson-soft" title={novel.title}>
          {novel.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-silver-muted">{novel.author}</p>
        <div className="mt-2 flex items-center justify-between text-xs text-silver-muted">
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-crimson text-crimson" aria-hidden="true" />
            {novel.ratingAvg ? novel.ratingAvg.toFixed(1) : '—'}
          </span>
          <span>{novel.chapterCount || 0} ch</span>
        </div>
      </div>
    </Link>
  </motion.div>
);

export default NovelCard;

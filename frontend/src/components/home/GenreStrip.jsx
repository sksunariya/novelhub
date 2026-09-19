import { Link } from 'react-router-dom';
import { ArrowRight, Shapes } from 'lucide-react';

// Genre shortcuts under the hero: one tap from the homepage to a filtered
// catalogue, which is how most readers actually start ("something fantasy").
// Renders nothing until the genre list arrives, and nothing on an empty site.

const GenreStrip = ({ genres }) => {
  if (!genres?.length) return null;

  return (
    <section aria-labelledby="genre-strip-title" className="relative">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="genre-strip-title" className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-silver-muted">
          <Shapes className="h-4 w-4 text-crimson-soft" aria-hidden="true" />
          Explore by genre
        </h2>
        <Link to="/browse" className="group/va flex items-center gap-1 text-sm font-semibold text-crimson-soft transition-colors hover:text-silver">
          All novels
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/va:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="relative">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {genres.map((genre) => (
            <Link key={genre} to={`/browse?genre=${encodeURIComponent(genre)}`} className="chip">
              {genre}
            </Link>
          ))}
        </div>
        {/* Fade the scroll edge on phones so the row reads as scrollable. */}
        <div className="pointer-events-none absolute inset-y-0 -right-4 w-10 bg-gradient-to-l from-night to-transparent sm:hidden" aria-hidden="true" />
      </div>
    </section>
  );
};

export default GenreStrip;

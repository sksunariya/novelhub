import { useRef, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import NovelCard from './NovelCard';

const SCROLL_STEP = 640;

const HorizontalSection = ({ icon: Icon, title, link, novels }) => {
  const scrollRef = useRef(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScroll({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    updateScrollState();
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [updateScrollState, novels]);

  const scrollBy = (direction) => {
    scrollRef.current?.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' });
  };

  if (!novels?.length) return null;

  return (
    <section className="mt-12" aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 truncate font-display text-xl font-bold text-silver">
          <Icon className="h-5 w-5 shrink-0 text-crimson" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link to={link} className="mr-1 flex items-center gap-1 whitespace-nowrap text-sm text-silver-muted transition-colors hover:text-crimson-soft">
            View all
          </Link>
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={!canScroll.left}
            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line text-silver-muted transition-colors hover:border-crimson/60 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30 sm:flex"
            aria-label={`Scroll ${title} left`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={!canScroll.right}
            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line text-silver-muted transition-colors hover:border-crimson/60 hover:text-silver disabled:cursor-not-allowed disabled:opacity-30 sm:flex"
            aria-label={`Scroll ${title} right`}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {novels.map((novel, index) => (
          <div key={novel._id} className="w-36 shrink-0 snap-start sm:w-40 md:w-44">
            <NovelCard novel={novel} index={index} />
          </div>
        ))}
      </div>
    </section>
  );
};

export default HorizontalSection;

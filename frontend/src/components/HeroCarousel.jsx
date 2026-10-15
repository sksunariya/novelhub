import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles, Star, Layers } from 'lucide-react';
import client from '../api/client';

/**
 * Cover-flow hero: the current cover sits large in the middle with its rating
 * and title over the art, its neighbours peek in smaller on either side, and
 * the whole band is washed in a blurred copy of the current cover.
 *
 * Props are unchanged from the previous carousel, so the admin live preview
 * (slidesProp) and the public /carousel fetch both still work.
 */

const SIDE_SCALE = 0.78; // neighbours relative to the centre card
const GAP = 14; // px between the centre card and a neighbour
const ASPECT = 1.45; // cover height / width

// Signed shortest distance from `current` to `index` on a ring of `count`.
const ringOffset = (index, current, count) => {
  let d = index - current;
  if (d > count / 2) d -= count;
  if (d < -count / 2) d += count;
  return d;
};

const SlideLink = ({ url, className, children, ...rest }) =>
  url?.startsWith('/') ? (
    <Link to={url} className={className} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={url || '#'} className={className} {...rest}>
      {children}
    </a>
  );

const Cover = ({ slide, active }) => {
  const [broken, setBroken] = useState(false);
  return (
    <>
      {slide.imageUrl && !broken ? (
        <img
          src={slide.imageUrl}
          alt={active ? '' : slide.title}
          onError={() => setBroken(true)}
          draggable={false}
          className="h-full w-full select-none object-cover"
          loading={active ? 'eager' : 'lazy'}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-night-surface to-night-raised p-4 text-center">
          <Layers className="mb-2 h-10 w-10 text-silver-muted/50" aria-hidden="true" />
          <p className="font-display text-sm font-bold text-silver line-clamp-3">{slide.title}</p>
        </div>
      )}
    </>
  );
};

const HeroCarousel = ({ slidesProp = null, autoPlayProp = true, intervalProp = 6 }) => {
  const [slides, setSlides] = useState(slidesProp || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(!slidesProp);
  const [autoPlayInterval, setAutoPlayInterval] = useState(intervalProp);
  const [enableAutoPlay, setEnableAutoPlay] = useState(autoPlayProp);
  const [width, setWidth] = useState(0);
  const shouldReduceMotion = useReducedMotion();
  const containerRef = useRef(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (slides.length > 0 && currentIndex >= slides.length) setCurrentIndex(slides.length - 1);
  }, [slides.length, currentIndex]);

  useEffect(() => {
    if (slidesProp) {
      setSlides(slidesProp);
      setLoading(false);
    }
  }, [slidesProp]);

  useEffect(() => {
    if (slidesProp) return undefined;
    let isMounted = true;
    client
      .get('/carousel')
      .then(({ data }) => {
        if (!isMounted) return;
        if (data.slides && data.slides.length > 0) {
          setSlides(data.slides);
          if (data.settings) {
            setAutoPlayInterval(data.settings.autoPlayInterval || 6);
            setEnableAutoPlay(data.settings.enableAutoPlay !== false);
          }
        }
      })
      .catch((err) => console.error('Failed to fetch carousel slides:', err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [slidesProp]);

  // Card size follows the band's width, so the neighbours always peek in.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, slides.length]);

  const handleNext = useCallback(() => {
    if (slides.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    if (slides.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') handlePrev();
    if (e.key === 'ArrowRight') handleNext();
  };

  useEffect(() => {
    if (!enableAutoPlay || isPaused || slides.length <= 1) return undefined;
    const timer = setInterval(handleNext, autoPlayInterval * 1000);
    return () => clearInterval(timer);
  }, [enableAutoPlay, isPaused, slides.length, autoPlayInterval, handleNext]);

  if (loading) {
    return (
      <div className="flex h-[420px] w-full animate-pulse items-center justify-center rounded-2xl bg-night-surface">
        <Sparkles className="h-6 w-6 animate-spin text-crimson" aria-hidden="true" />
      </div>
    );
  }

  if (slides.length === 0) return null;

  const current = slides[currentIndex] || slides[0];
  const count = slides.length;

  // Centre card: ~72% of the band on phones, capped on wide screens.
  const cardW = Math.max(200, Math.min(width * 0.72, 420));
  const cardH = cardW * ASPECT;
  const step = cardW / 2 + (cardW * SIDE_SCALE) / 2 + GAP;
  const visibleRange = width >= 900 ? 2 : 1;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured novels"
      className="relative w-full overflow-hidden rounded-2xl bg-night focus:outline-none focus-visible:ring-1 focus-visible:ring-crimson/50"
      style={{ height: cardH + 48 }}
    >
      {/* Blurred wash of the current cover */}
      {slides.map((slide, i) => (
        <motion.div
          key={`bg-${slide._id || i}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 scale-125 bg-cover bg-center blur-3xl"
          style={{ backgroundImage: slide.imageUrl ? `url(${slide.imageUrl})` : undefined }}
          initial={false}
          animate={{ opacity: i === currentIndex ? 0.55 : 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.6 }}
        />
      ))}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-night/40 via-night/20 to-night/70" />

      {/* Track */}
      <motion.div
        className="absolute inset-0"
        drag={count > 1 ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(e, { offset, velocity }) => {
          const swipe = offset.x + velocity.x * 0.2;
          if (swipe < -50) handleNext();
          else if (swipe > 50) handlePrev();
          // Let the click that ends a drag fall through without navigating.
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
      >
        {slides.map((slide, i) => {
          const offset = count > 1 ? ringOffset(i, currentIndex, count) : 0;
          const active = offset === 0;
          const hidden = Math.abs(offset) > visibleRange;
          const scale = active ? 1 : SIDE_SCALE;
          const x =
            offset === 0
              ? 0
              : Math.sign(offset) * (step + (Math.abs(offset) - 1) * (cardW * SIDE_SCALE + GAP));

          return (
            <motion.div
              key={slide._id || i}
              className="absolute left-1/2 top-1/2"
              style={{ width: cardW, height: cardH, marginLeft: -cardW / 2, marginTop: -cardH / 2, zIndex: 10 - Math.abs(offset) }}
              initial={false}
              animate={{ x, scale, opacity: hidden ? 0 : 1 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
              aria-hidden={!active}
            >
              <SlideLink
                url={slide.primaryButtonUrl}
                tabIndex={active ? 0 : -1}
                aria-label={active ? `Read ${slide.title}` : undefined}
                draggable={false}
                onClick={(e) => {
                  if (dragged.current) {
                    e.preventDefault();
                    return;
                  }
                  // A neighbour brings itself to the centre instead of navigating.
                  if (!active) {
                    e.preventDefault();
                    setCurrentIndex(i);
                  }
                }}
                className={`relative block h-full w-full overflow-hidden rounded-2xl bg-night-surface shadow-2xl ring-1 ring-white/10 transition-[filter] duration-300 ${
                  active ? '' : 'brightness-75 hover:brightness-90'
                } ${hidden ? 'pointer-events-none' : ''}`}
              >
                <Cover slide={slide} active={active} />

                {active && (
                  <>
                    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

                    {slide.novel?.ratingAvg > 0 && (
                      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-xl bg-black/75 px-2.5 py-1.5 text-sm font-semibold text-white backdrop-blur-sm sm:left-4 sm:top-4 sm:text-base">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400 sm:h-5 sm:w-5" aria-hidden="true" />
                        <span>{slide.novel.ratingAvg.toFixed(1)}</span>
                      </div>
                    )}

                    <h2 className="absolute inset-x-0 bottom-0 p-4 font-display text-base font-bold leading-snug text-white drop-shadow line-clamp-2 sm:p-5 sm:text-lg">
                      {slide.title}
                    </h2>
                  </>
                )}
              </SlideLink>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Dots */}
      {count > 1 && (
        <div className="absolute bottom-3 left-0 right-0 z-20 flex items-center justify-center gap-1.5">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              aria-current={idx === currentIndex ? 'true' : undefined}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {current.title}
      </span>
    </div>
  );
};

export default HeroCarousel;

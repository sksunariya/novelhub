import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BookOpen, Star, Layers, Sparkles, ArrowRight } from 'lucide-react';
import client from '../api/client';
import { useSettings } from '../context/SettingsContext';

// The homepage hero: a full-width stage lit by the current slide's own cover,
// blurred into an ambient backdrop, with the copy on the left and the cover
// "held up" on the right. On phones the two sit side by side in a compact row
// so the first screen still shows what the slide is and how to start reading.
//
// Also rendered by the carousel editor as a live preview (slidesProp), so it
// must look right inside a narrow framed container as well as edge to edge.

// Per-slide colour moods from the carousel editor. 'dark-crimson' is the
// historical id of the default mood; it follows the brand colours, so a slide
// left on the default always matches the rest of the site.
const THEME_STYLES = {
  'dark-crimson': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgb(var(--rgb-primary) / 0.42), transparent 70%), radial-gradient(38% 60% at 100% 0%, rgb(var(--rgb-primary-2) / 0.32), transparent 70%)',
    aura: 'rgb(var(--rgb-primary) / 0.55)',
  },
  'dark-violet': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgba(147, 51, 234, 0.4), transparent 70%)',
    aura: 'rgba(147, 51, 234, 0.5)',
  },
  'dark-gold': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgba(217, 119, 6, 0.36), transparent 70%)',
    aura: 'rgba(217, 119, 6, 0.5)',
  },
  'dark-emerald': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgba(16, 185, 129, 0.32), transparent 70%)',
    aura: 'rgba(16, 185, 129, 0.45)',
  },
  'dark-obsidian': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgba(100, 116, 139, 0.35), transparent 70%)',
    aura: 'rgba(100, 116, 139, 0.5)',
  },
  'dark-cyber': {
    glow: 'radial-gradient(48% 70% at 80% 45%, rgba(6, 182, 212, 0.34), transparent 70%)',
    aura: 'rgba(6, 182, 212, 0.45)',
  },
};

const BADGE_COLORS = {
  crimson: 'border-crimson-soft/30 bg-crimson/15 text-crimson-soft',
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  azure: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  gold: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200',
  rose: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  cyber: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
};

const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.5, ease: [0.25, 1, 0.5, 1] } },
  exit: (direction) => ({ x: direction < 0 ? 48 : -48, opacity: 0, transition: { duration: 0.28, ease: 'easeIn' } }),
};

const contentContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};

const contentItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

/** Internal paths route in-app; anything else is an outbound link. */
const CtaLink = ({ url, className, children, ...rest }) =>
  url?.startsWith('/') ? (
    <Link to={url} className={className} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={url || '#'} target="_blank" rel="noreferrer" className={className} {...rest}>
      {children}
    </a>
  );

const slideImage = (slide) => slide?.imageUrl || slide?.novel?.coverUrl || '';

const HeroSkeleton = () => (
  <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-hidden="true">
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-5 pb-10 pt-8 sm:grid-cols-[9rem_minmax(0,1fr)] md:grid-cols-12 md:gap-10 md:pb-16 md:pt-14">
      <div className="skeleton aspect-[2/3] w-full md:order-2 md:col-span-4 md:col-start-9 md:w-56 md:justify-self-end lg:w-64" />
      <div className="space-y-4 md:order-1 md:col-span-7">
        <div className="skeleton h-6 w-32 rounded-full" />
        <div className="skeleton h-9 w-4/5 md:h-14" />
        <div className="skeleton hidden h-4 w-3/5 sm:block" />
        <div className="skeleton h-10 w-36 rounded-full md:h-12 md:w-44" />
      </div>
    </div>
  </div>
);

const HeroCarousel = ({ slidesProp = null, autoPlayProp = true, intervalProp = 6 }) => {
  const { settings } = useSettings();
  const [slides, setSlides] = useState(slidesProp || []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(!slidesProp);
  const [autoPlayInterval, setAutoPlayInterval] = useState(intervalProp);
  const [enableAutoPlay, setEnableAutoPlay] = useState(autoPlayProp);
  const [imgError, setImgError] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const containerRef = useRef(null);

  // Clamp currentIndex when slides array shrinks
  useEffect(() => {
    if (slides.length > 0 && currentIndex >= slides.length) {
      setCurrentIndex(slides.length - 1);
    }
  }, [slides.length, currentIndex]);

  useEffect(() => {
    setImgError(false);
  }, [currentIndex, slides]);

  // Sync slides if provided as prop (e.g. live admin preview)
  useEffect(() => {
    if (slidesProp) {
      setSlides(slidesProp);
      setLoading(false);
    }
  }, [slidesProp]);

  // Fetch public slides if not passed as prop
  useEffect(() => {
    if (slidesProp) return;
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
      .catch((err) => {
        console.error('Failed to fetch carousel slides:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [slidesProp]);

  const handleNext = useCallback(() => {
    if (slides.length === 0) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const handlePrev = useCallback(() => {
    if (slides.length === 0) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const handleGoTo = (index) => {
    if (index === currentIndex) return;
    setDirection(index > currentIndex ? 1 : -1);
    setCurrentIndex(index);
  };

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowLeft') handlePrev();
    if (e.key === 'ArrowRight') handleNext();
  };

  // Auto-play timer
  useEffect(() => {
    if (!enableAutoPlay || isPaused || slides.length <= 1) return;
    const timer = setInterval(() => {
      handleNext();
    }, autoPlayInterval * 1000);
    return () => clearInterval(timer);
  }, [enableAutoPlay, isPaused, slides.length, autoPlayInterval, handleNext]);

  if (loading) return <HeroSkeleton />;

  if (slides.length === 0) return null;

  const currentSlide = slides[currentIndex] || slides[0];
  const theme = THEME_STYLES[currentSlide.themeStyle] || THEME_STYLES['dark-crimson'];
  const badgeStyle = BADGE_COLORS[currentSlide.badgeColor] || BADGE_COLORS.crimson;
  const image = !imgError ? slideImage(currentSlide) : '';
  const primaryUrl = currentSlide.primaryButtonUrl;
  const showSecondary =
    currentSlide.secondaryButtonText &&
    currentSlide.secondaryButtonUrl &&
    currentSlide.secondaryButtonUrl !== primaryUrl;
  const rating = currentSlide.novel?.ratingAvg > 0 ? currentSlide.novel.ratingAvg.toFixed(1) : null;

  return (
    <section
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="relative isolate overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-crimson-soft/60"
      aria-roledescription="carousel"
      aria-label="Featured novels"
    >
      {/* Ambient backdrop: the slide's own art, blown up and blurred, plus the
          slide's colour mood. Cross-fades between slides. */}
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.div
            key={currentSlide._id || currentIndex}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.8 }}
          >
            {image && (
              <img
                src={image}
                alt=""
                className="h-full w-full scale-125 object-cover opacity-40 blur-3xl saturate-150"
              />
            )}
            <div className="absolute inset-0" style={{ background: theme.glow }} />
          </motion.div>
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/30" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night to-transparent" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={currentSlide._id || currentIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, { offset }) => {
              if (offset.x < -50) handleNext();
              else if (offset.x > 50) handlePrev();
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={`${currentIndex + 1} of ${slides.length}`}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-5 pb-6 pt-8 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-7 md:grid-cols-12 md:gap-10 md:pb-10 md:pt-14 lg:pt-16"
          >
            {/* Cover, held up on the right from md; beside the copy on phones. */}
            <div className="md:order-2 md:col-span-5 md:flex md:justify-end md:pr-3 lg:pr-8">
              <CtaLink url={primaryUrl} className="group/poster relative block" aria-label={`Read ${currentSlide.title}`}>
                <div
                  className="absolute -inset-4 rounded-[2rem] opacity-60 blur-2xl transition-opacity duration-500 group-hover/poster:opacity-100"
                  style={{ background: theme.aura }}
                  aria-hidden="true"
                />
                <div className="relative aspect-[2/3] w-[6.5rem] overflow-hidden rounded-xl bg-night-raised shadow-2xl ring-1 ring-white/15 transition duration-500 ease-out sm:w-36 md:w-56 md:rotate-[2deg] md:group-hover/poster:-translate-y-2 md:group-hover/poster:rotate-0 lg:w-64">
                  {image ? (
                    <img
                      src={image}
                      alt={currentSlide.title}
                      onError={() => setImgError(true)}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover/poster:scale-105"
                      loading="eager"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-night-raised via-night-surface to-crimson/25 p-3 text-center">
                      <Layers className="mb-2 h-8 w-8 text-silver-muted/60 md:h-12 md:w-12" aria-hidden="true" />
                      <p className="line-clamp-3 font-display text-[11px] font-bold text-silver md:text-sm">{currentSlide.title}</p>
                      <p className="mt-1 text-[10px] text-crimson-soft md:text-xs">{settings?.siteName || ''}</p>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/[0.06]" />
                  {rating && (
                    <div className="absolute right-2 top-2 hidden items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold text-amber-300 backdrop-blur-md md:flex">
                      <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      {rating}
                    </div>
                  )}
                </div>
              </CtaLink>
            </div>

            {/* Copy */}
            <motion.div variants={contentContainer} initial="hidden" animate="show" className="min-w-0 md:order-1 md:col-span-7">
              <motion.div variants={contentItem}>
                <span
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] backdrop-blur-md sm:px-3 sm:text-[11px] ${badgeStyle}`}
                >
                  <Sparkles className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
                  <span className="truncate">{currentSlide.badgeText || 'Featured'}</span>
                </span>
              </motion.div>

              <motion.h1
                variants={contentItem}
                className="mt-3 line-clamp-2 font-display text-2xl font-extrabold leading-[1.08] text-silver sm:text-4xl md:mt-5 md:line-clamp-3 md:text-5xl lg:text-6xl"
              >
                {currentSlide.title}
              </motion.h1>

              {currentSlide.subtitle && (
                <motion.p
                  variants={contentItem}
                  className="mt-2 line-clamp-1 text-xs font-semibold text-crimson-soft sm:text-sm md:mt-4 md:text-base"
                >
                  {currentSlide.subtitle}
                </motion.p>
              )}

              {currentSlide.description && (
                <motion.p
                  variants={contentItem}
                  className="mt-3 hidden max-w-xl text-sm leading-relaxed text-silver-muted sm:line-clamp-2 md:mt-4 md:line-clamp-3 md:text-base"
                >
                  {currentSlide.description}
                </motion.p>
              )}

              <motion.div variants={contentItem} className="mt-4 flex flex-wrap items-center gap-3 md:mt-8">
                <CtaLink url={primaryUrl} className="btn btn-primary btn-sm md:btn-lg">
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  {currentSlide.primaryButtonText || 'Start Reading'}
                </CtaLink>
                {showSecondary && (
                  <CtaLink url={currentSlide.secondaryButtonUrl} className="btn btn-secondary btn-lg hidden backdrop-blur-md md:inline-flex">
                    {currentSlide.secondaryButtonText}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </CtaLink>
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {/* Controls: cover thumbnails from md, dots on phones. */}
        {slides.length > 1 && (
          <div className="flex items-center justify-between gap-4 pb-7 md:pb-12">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              {slides.map((slide, idx) => {
                const active = idx === currentIndex;
                const thumb = slideImage(slide);
                return (
                  <button
                    key={slide._id || idx}
                    type="button"
                    onClick={() => handleGoTo(idx)}
                    aria-label={`Go to slide ${idx + 1}: ${slide.title}`}
                    aria-current={active ? 'true' : undefined}
                    className="group/thumb cursor-pointer"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-all duration-300 md:hidden ${
                        active ? 'w-6 bg-gradient-to-r from-crimson-soft to-crimson-alt' : 'w-1.5 bg-silver-muted/40'
                      }`}
                    />
                    <span
                      className={`hidden h-14 w-10 overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-night transition duration-300 md:block ${
                        active ? 'opacity-100 ring-crimson-soft' : 'opacity-45 ring-transparent group-hover/thumb:opacity-90'
                      }`}
                    >
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="block h-full w-full bg-gradient-to-br from-night-raised to-crimson/30" />
                      )}
                    </span>
                  </button>
                );
              })}
              <span className="ml-2 text-xs font-semibold tabular-nums text-silver-muted">
                {currentIndex + 1} / {slides.length}
              </span>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous slide"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-silver backdrop-blur-md transition hover:border-crimson-soft/40 hover:bg-white/10"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next slide"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-silver backdrop-blur-md transition hover:border-crimson-soft/40 hover:bg-white/10"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Countdown to the next slide. */}
      {enableAutoPlay && slides.length > 1 && !isPaused && !shouldReduceMotion && (
        <motion.div
          key={`progress-${currentIndex}`}
          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-crimson to-crimson-alt"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: autoPlayInterval, ease: 'linear' }}
          aria-hidden="true"
        />
      )}
    </section>
  );
};

export default HeroCarousel;

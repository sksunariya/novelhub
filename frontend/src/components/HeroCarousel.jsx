import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Sparkles, BookOpen, Star, Layers, Flame, Compass } from 'lucide-react';
import client from '../api/client';
import HeroEmbers from './HeroEmbers';

const THEME_STYLES = {
  'dark-crimson': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(220,38,38,0.35), transparent 70%)',
    border: 'border-crimson/30 hover:border-crimson/60',
    badgeBg: 'bg-crimson/20 text-crimson-soft border-crimson/40',
    buttonPrimary: 'bg-crimson hover:bg-crimson-soft text-white shadow-glow',
    glowColor: 'rgba(220, 38, 38, 0.4)',
  },
  'dark-violet': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(147,51,234,0.35), transparent 70%)',
    border: 'border-purple-500/30 hover:border-purple-500/60',
    badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    buttonPrimary: 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)]',
    glowColor: 'rgba(147, 51, 234, 0.4)',
  },
  'dark-gold': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(217,119,6,0.35), transparent 70%)',
    border: 'border-amber-500/30 hover:border-amber-500/60',
    badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    buttonPrimary: 'bg-amber-600 hover:bg-amber-500 text-white shadow-[0_0_20px_rgba(217,119,6,0.4)]',
    glowColor: 'rgba(217, 119, 6, 0.4)',
  },
  'dark-emerald': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(16,185,129,0.35), transparent 70%)',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    buttonPrimary: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.4)]',
    glowColor: 'rgba(16, 185, 129, 0.4)',
  },
  'dark-obsidian': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(71,85,105,0.35), transparent 70%)',
    border: 'border-slate-600/40 hover:border-slate-500',
    badgeBg: 'bg-slate-700/40 text-slate-200 border-slate-600',
    buttonPrimary: 'bg-slate-700 hover:bg-slate-600 text-white shadow-[0_0_20px_rgba(71,85,105,0.4)]',
    glowColor: 'rgba(71, 85, 105, 0.4)',
  },
  'dark-cyber': {
    glow: 'radial-gradient(ellipse at 50% 10%, rgba(6,182,212,0.35), transparent 70%)',
    border: 'border-cyan-500/30 hover:border-cyan-500/60',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    buttonPrimary: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)]',
    glowColor: 'rgba(6, 182, 212, 0.4)',
  },
};

const BADGE_COLORS = {
  crimson: 'bg-crimson/20 text-crimson-soft border-crimson/40',
  amber: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  emerald: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  azure: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  violet: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  rose: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  cyber: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
};

const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 120 : -120,
    opacity: 0,
    scale: 0.96,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.55,
      ease: [0.25, 1, 0.5, 1],
    },
  },
  exit: (direction) => ({
    x: direction < 0 ? 120 : -120,
    opacity: 0,
    scale: 0.96,
    transition: {
      duration: 0.4,
      ease: 'easeIn',
    },
  }),
};

const contentContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const contentItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

const HeroCarousel = ({ slidesProp = null, autoPlayProp = true, intervalProp = 6 }) => {
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

  if (loading) {
    return (
      <div className="relative h-96 w-full animate-pulse rounded-2xl border border-line bg-night-surface p-8 shadow-card flex items-center justify-center">
        <div className="flex items-center gap-3 text-silver-muted">
          <Sparkles className="h-6 w-6 animate-spin text-crimson" />
          <span className="font-medium text-sm">Loading Hero Carousel...</span>
        </div>
      </div>
    );
  }

  if (slides.length === 0) return null;

  const currentSlide = slides[currentIndex] || slides[0];
  const theme = THEME_STYLES[currentSlide.themeStyle] || THEME_STYLES['dark-crimson'];
  const badgeStyle = BADGE_COLORS[currentSlide.badgeColor] || THEME_STYLES['dark-crimson'].badgeBg;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="group relative overflow-hidden rounded-2xl border border-line bg-night-surface shadow-card transition-all focus:outline-none focus:ring-1 focus:ring-crimson/50"
      aria-label="Featured Novels Carousel"
    >
      {/* Dynamic Radial Ambient Backdrop */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-700"
        style={{ background: theme.glow }}
        animate={shouldReduceMotion ? { opacity: 0.6 } : { opacity: [0.4, 0.65, 0.4] }}
        transition={shouldReduceMotion ? undefined : { duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden="true"
      />

      {/* Floating Ember Particles */}
      {!shouldReduceMotion && <HeroEmbers />}

      {/* Main Slide Track & Animations */}
      <div className="relative min-h-[460px] w-full px-6 py-10 sm:px-12 sm:py-16 md:px-16 flex items-center">
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
            className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12"
          >
            {/* Left Content Side */}
            <motion.div
              variants={contentContainer}
              initial="hidden"
              animate="show"
              className="lg:col-span-7 flex flex-col items-center text-center lg:items-start lg:text-left z-10"
            >
              {/* Badge */}
              <motion.div variants={contentItem} className="mb-4">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-bold tracking-wider uppercase backdrop-blur-md shadow-sm ${badgeStyle}`}
                >
                  <Flame className="h-3.5 w-3.5" />
                  {currentSlide.badgeText || 'FEATURED'}
                </span>
              </motion.div>

              {/* Title */}
              <motion.h1
                variants={contentItem}
                className="font-display text-3xl font-black tracking-tight text-silver sm:text-5xl lg:text-6xl line-clamp-2 leading-tight"
              >
                {currentSlide.title}
              </motion.h1>

              {/* Subtitle / Author Tagline */}
              {currentSlide.subtitle && (
                <motion.p variants={contentItem} className="mt-2 text-sm font-semibold text-crimson-soft sm:text-base">
                  {currentSlide.subtitle}
                </motion.p>
              )}

              {/* Description */}
              <motion.p
                variants={contentItem}
                className="mt-3 max-w-xl text-sm leading-relaxed text-silver-muted sm:text-base line-clamp-3"
              >
                {currentSlide.description}
              </motion.p>

              {/* CTA Buttons */}
              <motion.div
                variants={contentItem}
                className="mt-7 flex flex-wrap items-center justify-center gap-3.5 lg:justify-start"
              >
                {currentSlide.primaryButtonUrl?.startsWith('/') ? (
                  <Link
                    to={currentSlide.primaryButtonUrl}
                    className={`inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-bold transition-all transform hover:scale-105 active:scale-95 ${theme.buttonPrimary}`}
                  >
                    <BookOpen className="h-4 w-4" />
                    {currentSlide.primaryButtonText || 'Start Reading'}
                  </Link>
                ) : (
                  <a
                    href={currentSlide.primaryButtonUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-bold transition-all transform hover:scale-105 active:scale-95 ${theme.buttonPrimary}`}
                  >
                    <BookOpen className="h-4 w-4" />
                    {currentSlide.primaryButtonText || 'Start Reading'}
                  </a>
                )}

                {currentSlide.secondaryButtonText && (
                  currentSlide.secondaryButtonUrl?.startsWith('/') ? (
                    <Link
                      to={currentSlide.secondaryButtonUrl}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-night-raised/80 px-6 py-3 text-sm font-semibold text-silver backdrop-blur-md transition-all hover:border-silver-muted hover:text-white transform hover:scale-105 active:scale-95"
                    >
                      <Compass className="h-4 w-4" />
                      {currentSlide.secondaryButtonText}
                    </Link>
                  ) : (
                    <a
                      href={currentSlide.secondaryButtonUrl || '#'}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-night-raised/80 px-6 py-3 text-sm font-semibold text-silver backdrop-blur-md transition-all hover:border-silver-muted hover:text-white transform hover:scale-105 active:scale-95"
                    >
                      <Compass className="h-4 w-4" />
                      {currentSlide.secondaryButtonText}
                    </a>
                  )
                )}
              </motion.div>
            </motion.div>

            {/* Right Side: 3D Animated Cover Poster Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="lg:col-span-5 flex justify-center z-10"
            >
              <div className="relative group/poster cursor-pointer">
                {/* Glowing Aura Ring */}
                <div
                  className="absolute -inset-1.5 rounded-2xl opacity-60 blur-xl transition-all duration-500 group-hover/poster:opacity-100 group-hover/poster:blur-2xl"
                  style={{ background: theme.glowColor }}
                />

                {/* Poster Frame Container */}
                <div
                  className={`relative overflow-hidden rounded-2xl border bg-night-surface/90 shadow-2xl transition-all duration-300 transform group-hover/poster:-translate-y-2 group-hover/poster:rotate-1 ${theme.border}`}
                >
                  {currentSlide.imageUrl && !imgError ? (
                    <img
                      src={currentSlide.imageUrl}
                      alt={currentSlide.title}
                      onError={() => setImgError(true)}
                      className="h-64 sm:h-80 md:h-96 w-48 sm:w-60 md:w-64 object-cover transition-transform duration-700 group-hover/poster:scale-105"
                      loading="eager"
                    />
                  ) : (
                    <div className="h-64 sm:h-80 md:h-96 w-48 sm:w-60 md:w-64 flex flex-col items-center justify-center p-6 bg-gradient-to-br from-night-surface to-night-raised text-center border border-line">
                      <Layers className="h-12 w-12 text-silver-muted/50 mb-3" />
                      <p className="font-display font-bold text-silver text-sm line-clamp-3">{currentSlide.title}</p>
                      <p className="text-xs text-crimson-soft mt-1">Apex NovelHub</p>
                    </div>
                  )}

                  {/* Gradient Overlay & Details Pill */}
                  <div className="absolute inset-0 bg-gradient-to-t from-night/90 via-transparent to-transparent opacity-80" />

                  {/* Live Rating Pill */}
                  {currentSlide.novel?.ratingAvg > 0 && (
                    <div className="absolute top-3 right-3 rounded-full bg-night/80 border border-amber-500/40 px-2.5 py-1 text-xs font-bold text-amber-400 backdrop-blur-md flex items-center gap-1 shadow-md">
                      <Star className="h-3.5 w-3.5 fill-amber-400" />
                      <span>{currentSlide.novel.ratingAvg.toFixed(1)}</span>
                    </div>
                  )}

                  {/* Chapter Pill */}
                  {currentSlide.novel?.chapterCount > 0 && (
                    <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-night-surface/90 border border-line p-2 text-xs text-silver text-center backdrop-blur-md font-medium shadow-md">
                      <span>📖 {currentSlide.novel.chapterCount} Available Chapters</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation Arrows */}
      {slides.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            aria-label="Previous Slide"
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 rounded-full border border-line bg-night/70 p-2.5 text-silver backdrop-blur-md transition-all hover:bg-crimson hover:border-crimson hover:text-white hover:scale-110 active:scale-90"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next Slide"
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 rounded-full border border-line bg-night/70 p-2.5 text-silver backdrop-blur-md transition-all hover:bg-crimson hover:border-crimson hover:text-white hover:scale-110 active:scale-90"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Dot Indicators & Slide Counter */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-0 right-0 z-20 flex items-center justify-center gap-2">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => handleGoTo(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentIndex ? 'w-8 bg-crimson shadow-glow' : 'w-2 bg-silver-muted/30 hover:bg-silver-muted/60'
              }`}
            />
          ))}
        </div>
      )}

      {/* Animated Countdown Progress Bar */}
      {enableAutoPlay && slides.length > 1 && !isPaused && (
        <motion.div
          key={`progress-${currentIndex}`}
          className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-crimson to-amber-500 z-30"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: autoPlayInterval, ease: 'linear' }}
        />
      )}
    </div>
  );
};

export default HeroCarousel;

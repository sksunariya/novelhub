import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Flame, Sparkles, Trophy, BookOpen, CheckCircle2, TrendingUp, ChevronDown } from 'lucide-react';
import client from '../api/client';
import { useSettings } from '../context/SettingsContext';
import HorizontalSection from '../components/HorizontalSection';
import HeroEmbers from '../components/HeroEmbers';
import HeroLogo from '../components/HeroLogo';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

const heroContainer = (stagger) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: 0.05 } },
});

const heroItem = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const wordItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
};

const buttonItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 20 } },
};

const SECTIONS = [
  {
    key: 'featured',
    title: 'Featured',
    icon: Sparkles,
    link: '/browse',
    fetch: () => client.get('/novels/featured'),
  },
  {
    key: 'trending',
    title: 'Trending This Week',
    icon: Flame,
    link: '/rankings',
    fetch: () => client.get('/novels/rankings?type=trending&limit=12'),
  },
  {
    key: 'newArrivals',
    title: 'New Arrivals',
    icon: BookOpen,
    link: '/browse?sort=newest',
    fetch: () => client.get('/novels?sort=newest&limit=12'),
  },
  {
    key: 'popular',
    title: 'Most Popular',
    icon: TrendingUp,
    link: '/browse?sort=popular',
    fetch: () => client.get('/novels/rankings?type=popular&limit=12'),
  },
  {
    key: 'completed',
    title: 'Completed Novels',
    icon: CheckCircle2,
    link: '/browse?status=completed',
    fetch: () => client.get('/novels?status=completed&sort=latest&limit=12'),
  },
  {
    key: 'topRated',
    title: 'Top Rated',
    icon: Trophy,
    link: '/rankings',
    fetch: () => client.get('/novels/rankings?type=rating&limit=12'),
  },
];

const Home = () => {
  const { settings } = useSettings();
  const [sections, setSections] = useState(null);
  const enabled = settings?.homeSections;
  const shouldReduceMotion = useReducedMotion();
  const siteName = settings?.siteName || 'Apex NovelHub';
  const words = siteName.split(' ');

  useEffect(() => {
    if (!settings) return;
    const active = SECTIONS.filter((section) => !enabled || enabled[section.key] !== false);
    Promise.all(
      active.map((section) =>
        section
          .fetch()
          .then(({ data }) => ({ ...section, novels: data.novels }))
          .catch(() => ({ ...section, novels: [] }))
      )
    ).then(setSections);
  }, [settings, enabled]);

  return (
    <PageTransition>
      <section className="relative overflow-hidden rounded-2xl border border-line bg-night-surface px-6 py-16 text-center shadow-card sm:py-24">
        <motion.div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(220,38,38,0.35), transparent 65%)' }}
          animate={shouldReduceMotion ? { opacity: 0.4 } : { opacity: [0.3, 0.5, 0.3] }}
          transition={shouldReduceMotion ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        />
        {!shouldReduceMotion && <HeroEmbers />}

        <motion.div
          variants={heroContainer(shouldReduceMotion ? 0 : 0.14)}
          initial="hidden"
          animate="show"
          className="relative"
        >
          {settings?.logoUrl && <HeroLogo src={settings.logoUrl} alt="" variants={heroItem} />}

          <motion.h1
            variants={heroContainer(shouldReduceMotion ? 0 : 0.06)}
            className="font-display text-4xl font-black tracking-wide text-silver sm:text-6xl"
          >
            {words.map((word, index) => (
              <motion.span key={`${word}-${index}`} variants={wordItem} className="inline-block">
                {word}
                {index < words.length - 1 ? ' ' : ''}
              </motion.span>
            ))}
          </motion.h1>

          <motion.p variants={heroItem} className="mx-auto mt-4 max-w-xl text-silver-muted sm:text-lg">
            {settings?.tagline || 'Where dark tales come alive'}
          </motion.p>

          <motion.div
            variants={heroContainer(shouldReduceMotion ? 0 : 0.1)}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <motion.div variants={buttonItem} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
              <Link
                to="/browse"
                className="inline-block rounded-full bg-crimson px-6 py-3 font-semibold text-white shadow-glow transition-colors duration-200 hover:bg-crimson-soft"
              >
                Start Reading
              </Link>
            </motion.div>
            <motion.div variants={buttonItem} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
              <Link
                to="/rankings"
                className="inline-block rounded-full border border-line px-6 py-3 font-semibold text-silver transition-colors duration-200 hover:border-crimson/60 hover:text-crimson-soft"
              >
                Top Novels
              </Link>
            </motion.div>
          </motion.div>

          <motion.div variants={heroItem} className="mt-10 flex justify-center">
            <ChevronDown className="h-5 w-5 text-silver-muted" aria-hidden="true" />
          </motion.div>
        </motion.div>
      </section>

      {!sections ? (
        <Spinner full />
      ) : (
        sections.map((section) => (
          <HorizontalSection
            key={section.key}
            icon={section.icon}
            title={section.title}
            link={section.link}
            novels={section.novels}
          />
        ))
      )}
    </PageTransition>
  );
};

export default Home;

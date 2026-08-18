import { useState, useEffect } from 'react';
import { Flame, Sparkles, Trophy, BookOpen, CheckCircle2, TrendingUp } from 'lucide-react';
import client from '../api/client';
import { useSettings } from '../context/SettingsContext';
import HeroCarousel from '../components/HeroCarousel';
import HorizontalSection from '../components/HorizontalSection';
import PageTransition from '../components/PageTransition';
import Spinner from '../components/Spinner';

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
      <div className="mb-6 sm:mb-10">
        <HeroCarousel />
      </div>

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

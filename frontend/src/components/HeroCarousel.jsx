import { useEffect, useState } from 'react';
import HeroCarouselClassic from './HeroCarouselClassic';
import HeroCoverflow from './HeroCoverflow';

// Laptops and up (Tailwind `lg`, 1024px) keep the classic split hero; phones
// and tablets get the cover-flow. Same props for both, so the admin preview
// and the public homepage work either way.
const DESKTOP_QUERY = '(min-width: 1024px)';

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
};

const HeroCarousel = (props) => {
  const isDesktop = useIsDesktop();
  return isDesktop ? <HeroCarouselClassic {...props} /> : <HeroCoverflow {...props} />;
};

export default HeroCarousel;

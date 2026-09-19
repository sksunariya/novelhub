import { Outlet, matchPath, useLocation } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import Navbar from './Navbar';
import Footer from './Footer';
import MobileTabBar from './MobileTabBar';
import { useSettings } from '../context/SettingsContext';

// Pages that paint edge-to-edge (a full-width hero or cover backdrop) and lay
// out their own content containers. Everything else is wrapped in the standard
// centred column here, so individual pages never repeat it.
const FULL_BLEED_ROUTES = ['/', '/novel/:slug'];

const isFullBleed = (pathname) => FULL_BLEED_ROUTES.some((path) => matchPath(path, pathname));

const Layout = () => {
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const fullBleed = isFullBleed(pathname);

  return (
    // Bottom padding on phones keeps the footer clear of the fixed tab bar.
    <div className="flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-night-raised focus:px-4 focus:py-2 focus:text-sm focus:text-silver"
      >
        Skip to content
      </a>
      {settings?.announcement && (
        <div
          className="relative flex items-center justify-center gap-2 bg-gradient-to-r from-crimson/25 via-crimson-alt/20 to-crimson/25 px-4 py-2 text-center text-[13px] font-medium text-silver"
          role="status"
        >
          <Megaphone className="h-4 w-4 shrink-0 text-crimson-soft" aria-hidden="true" />
          <span>{settings.announcement}</span>
        </div>
      )}
      <Navbar />
      <main
        id="main"
        className={fullBleed ? 'w-full flex-1' : 'mx-auto w-full max-w-7xl flex-1 px-4 pb-4 pt-6 sm:px-6 sm:pt-8 lg:px-8'}
      >
        <Outlet />
      </main>
      <Footer />
      <MobileTabBar />
    </div>
  );
};

export default Layout;

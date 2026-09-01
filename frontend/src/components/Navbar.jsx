import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Bell, Menu, X, User, LogOut, Shield, Library } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import client from '../api/client';
import CreditBalance from './credits/CreditBalance';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/browse', label: 'Browse' },
  { to: '/rankings', label: 'Rankings' },
  // Shown only when the community is enabled AND spaces.entryPoint is 'nav'.
  // Both come from the public settings projection, so launching or hiding it is
  // an admin toggle rather than a deploy.
  { to: '/community', label: 'Spaces', when: (s) => s['spaces.enabled'] && s['spaces.entryPoint'] === 'nav' },
];

/** Links whose `when` predicate passes against the current public settings. */
const visibleLinks = (settings) =>
  NAV_LINKS.filter((link) => !link.when || link.when(settings || {}));

const Navbar = () => {
  const { user, logout, isAdmin } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    client
      .get('/library/notifications/list')
      .then(({ data }) => setUnreadCount(data.unreadCount))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submitSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      navigate(`/browse?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
      setMobileOpen(false);
    }
  };

  const linkClass = ({ isActive }) =>
    `rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ${
      isActive ? 'text-crimson-soft' : 'text-silver-muted hover:text-silver'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-night/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4" aria-label="Main navigation">
        <Link to="/" className="flex min-w-0 shrink items-center gap-2">
          {settings?.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={settings.siteName || 'Logo'}
              className="h-8 w-8 shrink-0 rounded-full object-cover sm:h-10 sm:w-10"
            />
          ) : null}
          <span className="truncate font-display text-base font-bold tracking-wide text-silver sm:text-lg">
            {settings?.siteName || ''}
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {visibleLinks(settings).map((link) => (
            <NavLink key={link.to} to={link.to} className={linkClass} end={link.to === '/'}>
              {link.label}
            </NavLink>
          ))}
        </div>

        <form onSubmit={submitSearch} className="ml-auto hidden max-w-xs flex-1 md:block" role="search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search novels..."
              aria-label="Search novels"
              className="w-full rounded-full border border-line bg-night-surface py-2 pl-9 pr-4 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
            />
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 md:ml-0">
          {user ? (
            <>
              {/* Renders nothing unless monetization is on. */}
              <CreditBalance compact />
              <Link
                to="/notifications"
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-silver-muted transition-colors hover:text-silver"
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-night-surface py-1.5 pl-1.5 pr-3 transition-colors hover:border-crimson/50"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-crimson/20 text-xs font-bold uppercase text-crimson-soft">
                    {(user.fullName || user.username).slice(0, 2)}
                  </span>
                  <span className="hidden text-sm font-medium sm:block">{user.fullName || user.username}</span>
                </button>
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-night-raised shadow-card"
                      role="menu"
                    >
                      <Link to="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-night-surface" role="menuitem">
                        <User className="h-4 w-4" aria-hidden="true" /> Profile
                      </Link>
                      <Link to="/library" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-night-surface" role="menuitem">
                        <Library className="h-4 w-4" aria-hidden="true" /> My Library
                      </Link>
                      {isAdmin && (
                        <Link to="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-crimson-soft hover:bg-night-surface" role="menuitem">
                          <Shield className="h-4 w-4" aria-hidden="true" /> Admin Portal
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          setMenuOpen(false);
                          navigate('/');
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 border-t border-line px-4 py-2.5 text-left text-sm text-silver-muted hover:bg-night-surface"
                        role="menuitem"
                      >
                        <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium text-silver-muted transition-colors hover:text-silver">
                Log in
              </Link>
              <Link
                to="/signup"
                className="rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft"
              >
                Sign up
              </Link>
            </div>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-silver-muted md:hidden"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-line md:hidden"
          >
            <div className="space-y-1 px-4 py-3">
              <form onSubmit={submitSearch} role="search">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search novels..."
                  aria-label="Search novels"
                  className="mb-2 w-full rounded-full border border-line bg-night-surface px-4 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
                />
              </form>
              {visibleLinks(settings).map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-night-surface text-crimson-soft' : 'text-silver-muted'}`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
              {!user && (
                <div className="flex gap-2 pt-2 sm:hidden">
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex-1 rounded-full border border-line px-3 py-2.5 text-center text-sm font-medium text-silver-muted"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/signup"
                    onClick={() => setMobileOpen(false)}
                    className="flex-1 rounded-full bg-crimson px-3 py-2.5 text-center text-sm font-semibold text-white"
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Navbar;

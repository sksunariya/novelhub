import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, Bell, X, User, LogOut, Shield, Library, ChevronDown, Coins, Crown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useMonetization } from '../context/MonetizationContext';
import client from '../api/client';
import CreditBalance from './credits/CreditBalance';
import BrandLink from './BrandMark';

export const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/browse', label: 'Browse' },
  { to: '/rankings', label: 'Rankings' },
  // Shown only when the community is enabled AND spaces.entryPoint is 'nav'.
  // Both come from the public settings projection, so launching or hiding it is
  // an admin toggle rather than a deploy.
  { to: '/community', label: 'Spaces', when: (s) => s['spaces.enabled'] && s['spaces.entryPoint'] === 'nav' },
];

/** Links whose `when` predicate passes against the current public settings. */
export const visibleLinks = (settings) =>
  NAV_LINKS.filter((link) => !link.when || link.when(settings || {}));

/** Typing somewhere already? Then "/" is a character, not a shortcut. */
const isEditable = (element) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));

const initialsOf = (user) => (user.fullName || user.username || '?').slice(0, 2);

const Avatar = ({ user, className = 'h-8 w-8 text-xs' }) =>
  user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={`${className} shrink-0 rounded-full object-cover ring-1 ring-white/10`} />
  ) : (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-crimson to-crimson-alt font-bold uppercase text-white`}
      aria-hidden="true"
    >
      {initialsOf(user)}
    </span>
  );

const MenuItem = ({ to, icon: Icon, children, onSelect, tone = '' }) => (
  <Link
    to={to}
    onClick={onSelect}
    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-silver transition-colors hover:bg-white/[0.06] ${tone}`}
    role="menuitem"
  >
    <Icon className="h-4 w-4 text-silver-muted" aria-hidden="true" />
    {children}
  </Link>
);

const Navbar = () => {
  const { user, logout, isAdmin } = useAuth();
  const { settings } = useSettings();
  const { enabled: monetizationOn, storeEnabled, subscriptionsEnabled, labelPlural } = useMonetization();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search, setSearch] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const mobileSearchRef = useRef(null);

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

  // Any navigation closes whatever was open.
  useEffect(() => {
    setMenuOpen(false);
    setMobileSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setMobileSearchOpen(false);
        if (document.activeElement === searchRef.current) searchRef.current.blur();
      }
      // "/" jumps to search, the convention readers know from most large sites.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(document.activeElement)) {
        const target = window.matchMedia('(min-width: 1024px)').matches ? searchRef.current : null;
        if (target) {
          e.preventDefault();
          target.focus();
        } else {
          e.preventDefault();
          setMobileSearchOpen(true);
        }
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (mobileSearchOpen) mobileSearchRef.current?.focus();
  }, [mobileSearchOpen]);

  const submitSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      navigate(`/browse?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
      setMobileSearchOpen(false);
    }
  };

  const linkClass = ({ isActive }) =>
    `relative whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200 lg:px-3.5 ${
      isActive ? 'bg-white/[0.07] text-silver' : 'text-silver-muted hover:text-silver'
    }`;

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-night/75 backdrop-blur-xl supports-[backdrop-filter]:bg-night/60">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-6 lg:px-8" aria-label="Main navigation">
        <BrandLink className="shrink-0" />

        <div className="hidden items-center gap-1 md:flex">
          {visibleLinks(settings).map((link) => (
            <NavLink key={link.to} to={link.to} className={linkClass} end={link.to === '/'}>
              {link.label}
            </NavLink>
          ))}
        </div>

        <form onSubmit={submitSearch} className="ml-auto hidden min-w-0 max-w-sm flex-1 lg:block" role="search">
          <div className="group relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted transition-colors group-focus-within:text-crimson-soft" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, authors…"
              aria-label="Search novels"
              className="h-10 w-full rounded-full border border-line bg-night-surface/80 pl-10 pr-10 text-sm text-silver placeholder:text-silver-muted/80 transition focus:border-crimson-soft/50 focus:bg-night-surface focus:outline-none focus:ring-2 focus:ring-crimson/25"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-night-raised px-1.5 py-0.5 font-body text-[10px] font-semibold text-silver-muted xl:block">
              /
            </kbd>
          </div>
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2 lg:ml-0">
          <button
            type="button"
            onClick={() => setMobileSearchOpen((open) => !open)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-silver-muted transition-colors hover:bg-white/[0.06] hover:text-silver lg:hidden"
            aria-label={mobileSearchOpen ? 'Close search' : 'Search'}
            aria-expanded={mobileSearchOpen}
          >
            {mobileSearchOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Search className="h-5 w-5" aria-hidden="true" />}
          </button>

          {user ? (
            <>
              {/* Renders nothing unless monetization is on. */}
              <div className="hidden lg:block">
                <CreditBalance compact />
              </div>
              <Link
                to="/notifications"
                className="relative flex h-10 w-10 items-center justify-center rounded-full text-silver-muted transition-colors hover:bg-white/[0.06] hover:text-silver"
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-crimson to-crimson-alt px-1 text-[10px] font-bold text-white ring-2 ring-night">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-night-surface/70 p-1 transition-colors hover:border-crimson-soft/40 sm:pr-3"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                >
                  <Avatar user={user} />
                  <span className="hidden max-w-[9rem] truncate text-sm font-medium text-silver xl:block">
                    {user.fullName || user.username}
                  </span>
                  <ChevronDown className={`hidden h-4 w-4 text-silver-muted transition-transform sm:block ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-64 origin-top-right overflow-hidden rounded-2xl border border-line bg-night-raised/95 p-1.5 shadow-card backdrop-blur-xl"
                      role="menu"
                    >
                      <div className="flex items-center gap-3 px-3 pb-3 pt-2">
                        <Avatar user={user} className="h-10 w-10 text-sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-silver">{user.fullName || user.username}</p>
                          <p className="truncate text-xs text-silver-muted">@{user.username}</p>
                        </div>
                      </div>
                      <div className="border-t border-line pt-1.5">
                        <MenuItem to="/profile" icon={User} onSelect={closeMenu}>Profile</MenuItem>
                        <MenuItem to="/library" icon={Library} onSelect={closeMenu}>My Library</MenuItem>
                        {monetizationOn && storeEnabled && (
                          <MenuItem to="/store" icon={Coins} onSelect={closeMenu}>Get {(labelPlural || 'credits').toLowerCase()}</MenuItem>
                        )}
                        {monetizationOn && subscriptionsEnabled && (
                          <MenuItem to="/subscribe" icon={Crown} onSelect={closeMenu}>Subscription</MenuItem>
                        )}
                        {isAdmin && (
                          <MenuItem to="/admin" icon={Shield} onSelect={closeMenu} tone="text-crimson-soft">
                            Admin Portal
                          </MenuItem>
                        )}
                      </div>
                      <div className="mt-1.5 border-t border-line pt-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            logout();
                            setMenuOpen(false);
                            navigate('/');
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-silver-muted transition-colors hover:bg-rose-500/10 hover:text-rose-200"
                          role="menuitem"
                        >
                          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link to="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
                Log in
              </Link>
              <Link to="/signup" className="btn btn-primary btn-sm">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </nav>

      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.06] lg:hidden"
          >
            <form onSubmit={submitSearch} role="search" className="px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
                <input
                  ref={mobileSearchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles, authors…"
                  aria-label="Search novels"
                  className="h-11 w-full rounded-full border border-line bg-night-surface pl-10 pr-4 text-sm text-silver placeholder:text-silver-muted/80 focus:border-crimson-soft/50 focus:outline-none focus:ring-2 focus:ring-crimson/25"
                />
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Navbar;

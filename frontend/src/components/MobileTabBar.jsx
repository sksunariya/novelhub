import { NavLink } from 'react-router-dom';
import { Home, Compass, Trophy, Library, LogIn, MessagesSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

// App-style bottom navigation for phones. The top bar keeps the brand, search
// and account; everything a reader moves between lives down here, within
// thumb reach. Hidden from md up, where the same links sit in the top bar.

const TabLink = ({ to, icon: Icon, label, end = false }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) =>
      `group relative flex flex-1 flex-col items-center gap-1 pb-1.5 pt-2 text-[10.5px] font-semibold transition-colors ${
        isActive ? 'text-crimson-soft' : 'text-silver-muted hover:text-silver'
      }`
    }
  >
    {({ isActive }) => (
      <>
        <span
          className={`absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-crimson to-crimson-alt transition-opacity ${
            isActive ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        />
        <span
          className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
            isActive ? 'bg-crimson/15' : 'group-hover:bg-white/[0.04]'
          }`}
        >
          <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
        </span>
        {label}
      </>
    )}
  </NavLink>
);

const MobileTabBar = () => {
  const { user } = useAuth();
  const { settings } = useSettings();
  const spacesInNav = settings?.['spaces.enabled'] && settings?.['spaces.entryPoint'] === 'nav';

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-night/85 pb-safe backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch px-2">
        <TabLink to="/" end icon={Home} label="Home" />
        <TabLink to="/browse" icon={Compass} label="Browse" />
        <TabLink to="/rankings" icon={Trophy} label="Rankings" />
        {spacesInNav && <TabLink to="/community" icon={MessagesSquare} label="Spaces" />}
        {user ? (
          <TabLink to="/library" icon={Library} label="Library" />
        ) : (
          <TabLink to="/login" icon={LogIn} label="Sign in" />
        )}
      </div>
    </nav>
  );
};

export default MobileTabBar;

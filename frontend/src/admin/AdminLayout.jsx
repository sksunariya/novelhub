import { NavLink, Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, Images, BookOpen, Users, ShieldAlert, Bell, Settings, ArrowLeft } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

const LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/carousel', label: 'Hero Carousel', icon: Images },
  { to: '/admin/novels', label: 'Novels', icon: BookOpen },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/moderation', label: 'Moderation', icon: ShieldAlert },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/settings', label: 'Site Settings', icon: Settings },
];

const AdminLayout = () => {
  const { settings } = useSettings();
  return (
    <div className="flex min-h-dvh bg-night">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-night-surface md:flex">
        <div className="border-b border-line p-4">
          <p className="font-display text-lg font-bold text-silver">{settings?.siteName || 'Apex NovelHub'}</p>
          <p className="text-xs text-crimson-soft">Admin Portal</p>
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Admin navigation">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
                }`
              }
            >
              <link.icon className="h-4 w-4" aria-hidden="true" />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="flex items-center gap-2 border-t border-line p-4 text-sm text-silver-muted transition-colors hover:text-silver">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to site
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-night-surface px-3 py-2 md:hidden">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                  isActive ? 'bg-crimson text-white' : 'text-silver-muted'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;

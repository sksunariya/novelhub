import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  LayoutDashboard, Images, BookOpen, Users, ShieldAlert, Bell, Settings, ArrowLeft,
  Tags, Clock, ChevronDown, Globe, Gift, TrendingUp, Repeat, MessagesSquare, Flag,
  ScrollText, ShieldCheck, Inbox, FileText,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

// Two-level navigation. A flat list worked at seven links; it does not at
// twenty-plus, and grouping is what keeps the portal navigable as sections
// are added.
const GROUPS = [
  {
    id: 'overview',
    links: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    id: 'content',
    label: 'Content',
    links: [
      { to: '/admin/novels', label: 'Novels', icon: BookOpen },
      { to: '/admin/carousel', label: 'Hero carousel', icon: Images },
    ],
  },
  {
    id: 'monetization',
    label: 'Monetization',
    links: [
      { to: '/admin/config', label: 'Settings', icon: Settings },
      { to: '/admin/packs', label: 'Credit packs', icon: Tags },
      { to: '/admin/plans', label: 'Subscriptions', icon: Repeat },
      { to: '/admin/currencies', label: 'Currencies', icon: Globe },
      { to: '/admin/grants', label: 'Free credits', icon: Gift },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    links: [{ to: '/admin/analytics', label: 'Revenue & authors', icon: TrendingUp }],
  },
  // The community system: spaces, posts, reports. Distinct from the chapter
  // comment moderation under People below.
  {
    id: 'spaces',
    label: 'Community',
    links: [
      { to: '/admin/spaces', label: 'Spaces', icon: MessagesSquare, end: true },
      { to: '/admin/spaces/requests', label: 'Requests', icon: Inbox },
      { to: '/admin/community/posts', label: 'Posts', icon: FileText },
      { to: '/admin/community/reports', label: 'Reports', icon: Flag },
      { to: '/admin/community/modlog', label: 'Mod log', icon: ScrollText },
      { to: '/admin/community/safety', label: 'Safety', icon: ShieldCheck },
    ],
  },
  {
    id: 'people',
    label: 'People',
    links: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin/moderation', label: 'Chapter comments', icon: ShieldAlert },
      { to: '/admin/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    id: 'system',
    label: 'System',
    links: [
      { to: '/admin/settings', label: 'Site settings', icon: Settings },
      { to: '/admin/jobs', label: 'Jobs', icon: Clock },
    ],
  },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
  }`;

const AdminLayout = () => {
  const { settings } = useSettings();
  const [collapsed, setCollapsed] = useState({});

  const toggle = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  const allLinks = GROUPS.flatMap((group) => group.links);

  return (
    <div className="flex min-h-dvh bg-night">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-night-surface md:flex">
        <div className="border-b border-line p-4">
          <p className="font-display text-lg font-bold text-silver">{settings?.siteName || 'Apex NovelHub'}</p>
          <p className="text-xs text-crimson-soft">Admin Portal</p>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Admin navigation">
          {GROUPS.map((group) => (
            <div key={group.id}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={!collapsed[group.id]}
                  className="mb-1 flex w-full cursor-pointer items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-silver-muted transition-colors hover:text-silver"
                >
                  {group.label}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${collapsed[group.id] ? '-rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              )}
              {!collapsed[group.id] && (
                <div className="space-y-0.5">
                  {group.links.map((link) => (
                    <NavLink key={link.to} to={link.to} end={link.end} className={linkClass}>
                      <link.icon className="h-4 w-4" aria-hidden="true" />
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <Link
          to="/"
          className="flex items-center gap-2 border-t border-line p-4 text-sm text-silver-muted transition-colors hover:text-silver"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to site
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile keeps a flat scroller — grouping costs more than it gives here. */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-night-surface px-3 py-2 md:hidden">
          {allLinks.map((link) => (
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

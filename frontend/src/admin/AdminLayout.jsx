import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  LayoutDashboard, Images, BookOpen, Users, ShieldAlert, Bell, Settings, ArrowLeft,
  Tags, Clock, ChevronDown, Globe, Gift, TrendingUp, Repeat, MessagesSquare, Flag,
  ScrollText, ShieldCheck, Inbox, FileText, KeyRound, Crown,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useAdminAccess } from '../context/AdminAccessContext';

// Two-level navigation. A flat list worked at seven links; it does not at
// twenty-plus, and grouping is what keeps the portal navigable as sections
// are added.
//
// Every link carries the `module` id its API routes are guarded by. The two
// must agree: a link whose module is hidden disappears, and the route behind it
// returns 404 regardless. Keep them in step with backend config/constants.js.
//
// `requires` adds modules that must ALSO be held; `anyOf` names a set where one
// is enough, for screens that span several modules.
const GROUPS = [
  {
    id: 'overview',
    links: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, module: 'dashboard' }],
  },
  {
    id: 'content',
    label: 'Content',
    links: [
      { to: '/admin/novels', label: 'Novels', icon: BookOpen, module: 'novels' },
      { to: '/admin/carousel', label: 'Hero carousel', icon: Images, module: 'carousel' },
    ],
  },
  {
    id: 'monetization',
    label: 'Monetization',
    links: [
      // The settings registry spans three modules. The link shows if the admin
      // holds any of them, and the API filters the page down to their sections.
      {
        to: '/admin/config',
        label: 'Settings',
        icon: Settings,
        anyOf: ['monetization_config', 'platform_config', 'community_config'],
      },
      { to: '/admin/packs', label: 'Credit packs', icon: Tags, module: 'packs' },
      { to: '/admin/plans', label: 'Subscriptions', icon: Repeat, module: 'plans' },
      { to: '/admin/currencies', label: 'Currencies', icon: Globe, module: 'currencies' },
      { to: '/admin/grants', label: 'Free credits', icon: Gift, module: 'grants' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    links: [{ to: '/admin/analytics', label: 'Revenue & authors', icon: TrendingUp, module: 'analytics' }],
  },
  // The community system: spaces, posts, reports. Distinct from the chapter
  // comment moderation under People below.
  {
    id: 'spaces',
    label: 'Community',
    links: [
      { to: '/admin/spaces', label: 'Spaces', icon: MessagesSquare, end: true, module: 'spaces' },
      // The request queue reads the spaces endpoints, so it needs both: its
      // own module to act on requests, and Spaces to see them at all.
      { to: '/admin/spaces/requests', label: 'Requests', icon: Inbox, module: 'space_requests', requires: ['spaces'] },
      { to: '/admin/community/posts', label: 'Posts', icon: FileText, module: 'community_posts' },
      { to: '/admin/community/reports', label: 'Reports', icon: Flag, module: 'community_reports' },
      { to: '/admin/community/modlog', label: 'Mod log', icon: ScrollText, module: 'community_modlog' },
      { to: '/admin/community/safety', label: 'Safety', icon: ShieldCheck, module: 'community_safety' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    links: [
      { to: '/admin/users', label: 'Users', icon: Users, module: 'users' },
      { to: '/admin/moderation', label: 'Chapter comments', icon: ShieldAlert, module: 'moderation' },
      { to: '/admin/notifications', label: 'Notifications', icon: Bell, module: 'notifications' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    links: [
      { to: '/admin/settings', label: 'Site settings', icon: Settings, module: 'site_settings' },
      { to: '/admin/jobs', label: 'Jobs', icon: Clock, module: 'jobs' },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    links: [{ to: '/admin/access-control', label: 'Access control', icon: KeyRound, module: 'access_control' }],
  },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
  }`;

const AdminLayout = () => {
  const { settings } = useSettings();
  const { can, loading, error, isSuperAdmin } = useAdminAccess();
  const [collapsed, setCollapsed] = useState({});

  const toggle = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  // A group whose every link is hidden should not leave an empty heading behind
  // — that would advertise the existence of the section it is hiding.
  const visible = (link) => {
    if (link.anyOf) return link.anyOf.some((moduleId) => can(moduleId));
    return can(link.module) && (link.requires || []).every((required) => can(required));
  };

  const groups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter(visible),
  })).filter((group) => group.links.length > 0);

  const allLinks = groups.flatMap((group) => group.links);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-night">
        <p className="text-sm text-silver-muted">Loading portal…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-night px-6 text-center">
        <p className="text-sm text-silver">{error}</p>
        <Link to="/" className="text-sm text-crimson-soft hover:underline">
          Back to site
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-night">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-night-surface md:flex">
        <div className="border-b border-line p-4">
          <p className="font-display text-lg font-bold text-silver">{settings?.siteName || 'Admin Portal'}</p>
          <p className="flex items-center gap-1.5 text-xs text-crimson-soft">
            {isSuperAdmin && <Crown className="h-3 w-3" aria-hidden="true" />}
            {isSuperAdmin ? 'Superadmin' : 'Admin Portal'}
          </p>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Admin navigation">
          {groups.map((group) => (
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

import { Link } from 'react-router-dom';
import { ArrowUp, Mail, MessageCircle, Twitter } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useMonetization } from '../context/MonetizationContext';
import BrandLink from './BrandMark';

const FooterColumn = ({ title, links }) => {
  if (!links.length) return null;
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-silver">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="text-sm text-silver-muted transition-colors hover:text-crimson-soft">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

const SOCIALS = [
  { key: 'discord', label: 'Discord', icon: MessageCircle, href: (v) => v },
  { key: 'twitter', label: 'X (Twitter)', icon: Twitter, href: (v) => v },
  { key: 'email', label: 'Email', icon: Mail, href: (v) => (v.startsWith('mailto:') ? v : `mailto:${v}`) },
];

const Footer = () => {
  const { settings } = useSettings();
  const { user } = useAuth();
  const { enabled: monetizationOn, storeEnabled, subscriptionsEnabled, labelPlural } = useMonetization();
  const siteName = settings?.siteName || '';
  const year = new Date().getFullYear();
  const socials = SOCIALS.filter((s) => settings?.socialLinks?.[s.key]);
  const spacesOn = settings?.['spaces.enabled'];

  const discover = [
    { to: '/browse', label: 'Browse all' },
    { to: '/rankings', label: 'Rankings' },
    { to: '/browse?sort=newest', label: 'New releases' },
    { to: '/browse?status=completed', label: 'Completed series' },
  ];
  const account = user
    ? [
        { to: '/library', label: 'My Library' },
        { to: '/notifications', label: 'Notifications' },
        { to: '/profile', label: 'Profile & settings' },
      ]
    : [
        { to: '/login', label: 'Log in' },
        { to: '/signup', label: 'Create an account' },
      ];
  const more = [
    spacesOn && { to: '/community', label: 'Community spaces' },
    monetizationOn && storeEnabled && { to: '/store', label: `Get ${(labelPlural || 'credits').toLowerCase()}` },
    monetizationOn && subscriptionsEnabled && { to: '/subscribe', label: 'Subscription plans' },
  ].filter(Boolean);

  return (
    <footer className="relative mt-20 border-t border-white/[0.06] bg-night-surface/50">
      {/* A thin brand line along the top edge. */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-crimson/60 to-transparent" aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <BrandLink />
            {settings?.tagline && (
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-silver-muted">{settings.tagline}</p>
            )}
            {socials.length > 0 && (
              <div className="mt-5 flex gap-2">
                {socials.map(({ key, label, icon: Icon, href }) => (
                  <a
                    key={key}
                    href={href(settings.socialLinks[key])}
                    target={key === 'email' ? undefined : '_blank'}
                    rel="noreferrer"
                    aria-label={label}
                    title={label}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-night-raised/60 text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-crimson-soft"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <FooterColumn title="Discover" links={discover} />
          <FooterColumn title="Your account" links={account} />
          <FooterColumn title="More" links={more} />
        </div>

        <div className="mt-12 flex flex-col-reverse items-start justify-between gap-4 border-t border-white/[0.06] pt-6 text-xs text-silver-muted sm:flex-row sm:items-center">
          <p>{settings?.footerText || `© ${year} ${siteName}. All rights reserved.`}</p>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 font-medium transition-colors hover:text-silver"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Back to top
          </button>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

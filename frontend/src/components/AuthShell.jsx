import { motion } from 'framer-motion';
import { BookOpen, Bookmark, Sparkles } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import BrandLink from './BrandMark';

// Shared frame for login, signup and password reset: a brand panel on the left
// (desktop only) and the form on the right. On phones the form stands alone —
// the navbar above already carries the brand.

const PERKS = [
  { icon: BookOpen, title: 'Read anywhere', body: 'Your library and progress follow you to every device.' },
  { icon: Bookmark, title: 'Never lose your place', body: 'We remember the exact chapter you stopped at.' },
  { icon: Sparkles, title: 'Find your next favourite', body: 'Rankings, reviews and a community of readers.' },
];

const AuthShell = ({ children }) => {
  const { settings } = useSettings();
  const year = new Date().getFullYear();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="mx-auto grid w-full max-w-md overflow-hidden rounded-[1.75rem] border border-line bg-night-surface/80 shadow-card backdrop-blur sm:mt-4 lg:max-w-5xl lg:grid-cols-[1.05fr_1fr]"
    >
      <aside className="relative isolate hidden overflow-hidden p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-crimson/45 via-night-raised to-crimson-alt/30" aria-hidden="true" />
        <div className="absolute -left-24 top-1/3 -z-10 h-80 w-80 rounded-full bg-crimson/40 blur-3xl" aria-hidden="true" />
        <div className="absolute -right-16 -top-16 -z-10 h-64 w-64 rounded-full bg-crimson-alt/35 blur-3xl" aria-hidden="true" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" aria-hidden="true" />

        <BrandLink />

        <div className="py-12">
          <h2 className="font-display text-4xl font-extrabold leading-[1.1] text-white">
            Stories that <span className="text-gradient">stay with you.</span>
          </h2>
          {settings?.tagline && <p className="mt-4 max-w-sm text-[15px] text-white/70">{settings.tagline}</p>}
          <ul className="mt-9 space-y-5">
            {PERKS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-inset ring-white/15 backdrop-blur" aria-hidden="true">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-white/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/50">© {year} {settings?.siteName || ''}</p>
      </aside>

      <div className="p-6 sm:p-10 lg:p-12">{children}</div>
    </motion.div>
  );
};

export default AuthShell;

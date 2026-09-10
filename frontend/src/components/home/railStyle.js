import {
  Sparkles, Flame, TrendingUp, BookOpen, CheckCircle2, Trophy, Star, Clock,
  MessagesSquare, Users, BarChart3, Activity, Heart, Zap, Gift, Crown,
  Bookmark, Compass, PenLine, Megaphone,
} from 'lucide-react';

// Rail chrome: the icon and accent an admin picks, resolved to real components
// and classes.
//
// An EXPLICIT icon map, not `import * as Icons from 'lucide-react'`. The
// namespace import pulls the entire icon library into the homepage bundle —
// roughly a thousand components to render one — and tree-shaking cannot help
// when the name is only known at runtime. It also gives the admin form a list
// to choose from instead of a text box where a typo renders nothing.
export const RAIL_ICONS = {
  Sparkles, Flame, TrendingUp, BookOpen, CheckCircle2, Trophy, Star, Clock,
  MessagesSquare, Users, BarChart3, Activity, Heart, Zap, Gift, Crown,
  Bookmark, Compass, PenLine, Megaphone,
};

export const ICON_NAMES = Object.keys(RAIL_ICONS);

export const iconFor = (name) => RAIL_ICONS[name] || Sparkles;

// The theme is CSS-variable driven and only defines one brand colour, so the
// other accents map onto fixed palette values that hold up on the dark ground.
// `crimson` stays a variable so it follows the admin's theme colour.
export const ACCENTS = {
  crimson: { text: 'text-crimson', border: 'border-crimson/50', bg: 'bg-crimson/10', ring: 'ring-crimson/30' },
  violet: { text: 'text-violet-400', border: 'border-violet-400/50', bg: 'bg-violet-400/10', ring: 'ring-violet-400/30' },
  amber: { text: 'text-amber-400', border: 'border-amber-400/50', bg: 'bg-amber-400/10', ring: 'ring-amber-400/30' },
  emerald: { text: 'text-emerald-400', border: 'border-emerald-400/50', bg: 'bg-emerald-400/10', ring: 'ring-emerald-400/30' },
  azure: { text: 'text-sky-400', border: 'border-sky-400/50', bg: 'bg-sky-400/10', ring: 'ring-sky-400/30' },
  gold: { text: 'text-yellow-400', border: 'border-yellow-400/50', bg: 'bg-yellow-400/10', ring: 'ring-yellow-400/30' },
  rose: { text: 'text-rose-400', border: 'border-rose-400/50', bg: 'bg-rose-400/10', ring: 'ring-rose-400/30' },
};

export const ACCENT_NAMES = Object.keys(ACCENTS);

export const accentFor = (name) => ACCENTS[name] || ACCENTS.crimson;

/** 1200 -> "1.2k". Used for member and vote counts, which get large. */
export const compact = (n) => {
  const value = Number(n) || 0;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
};

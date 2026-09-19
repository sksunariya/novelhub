/** @type {import('tailwindcss').Config} */

// Every theme colour is an "r g b" channel triplet in a CSS variable (see
// src/index.css), wrapped here as rgb(var(--x) / <alpha-value>). That wrapper is
// what makes opacity modifiers such as `bg-crimson/15` or `border-line/60`
// generate CSS at all: Tailwind cannot apply an alpha to a bare `var(--x)`, and
// with the old definitions every one of those classes silently produced nothing.
//
// The token NAMES (crimson, night, silver, line) are kept from the original
// NovelHub theme so this branch stays mergeable with main; only what they point
// at has changed. Read them as roles, not colours:
//   crimson  -> brand   (DEFAULT = solid fill, soft = text/links on dark,
//                         hover = solid fill on hover, alt = gradient partner)
//   night    -> surfaces (DEFAULT = page, surface = cards, raised = inputs/menus)
//   silver   -> text     (DEFAULT = primary text, muted = secondary text)
//   line     -> hairline borders
const channel = (name) => `rgb(var(--rgb-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        crimson: {
          DEFAULT: channel('primary'),
          soft: channel('accent'),
          hover: channel('primary-hover'),
          alt: channel('primary-2'),
        },
        night: {
          DEFAULT: channel('background'),
          surface: channel('surface'),
          raised: channel('surface-raised'),
          // Referenced by DeletedItemModal but never defined, which left that
          // dialog with a transparent background.
          card: channel('surface-raised'),
        },
        silver: {
          DEFAULT: channel('text'),
          muted: channel('text-muted'),
        },
        line: channel('border'),
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        reading: ['Lora', 'Georgia', 'serif'],
      },
      boxShadow: {
        glow: '0 10px 30px -12px rgb(var(--rgb-primary) / 0.65)',
        card: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 18px 40px -24px rgb(0 0 0 / 0.75)',
        lift: '0 24px 48px -22px rgb(var(--rgb-primary) / 0.55)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        crimson: {
          DEFAULT: 'var(--color-primary)',
          soft: 'var(--color-accent)',
        },
        night: {
          DEFAULT: 'var(--color-background)',
          surface: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
        },
        silver: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
        },
        line: 'var(--color-border)',
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        reading: ['Lora', 'Georgia', 'serif'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(220, 38, 38, 0.25)',
        card: '0 8px 30px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
};

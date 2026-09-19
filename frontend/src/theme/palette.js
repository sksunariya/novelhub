// The a2zNovel "Aurora Violet" palette: the five colours an admin can edit under
// Admin -> Settings -> Theme colors, as the stylesheet ships them.
//
// index.css declares the same values as CSS variables. SettingsContext compares
// the saved theme colours against these to tell a customised colour from the
// default, and backend/scripts/applyAuroraTheme.js writes exactly these values
// into the database. Keep all three in sync.
export const PALETTE = {
  primary: '#7c3aed',
  accent: '#a78bfa',
  background: '#0c0a13',
  surface: '#14111d',
  text: '#f2eff9',
};

/** '#7c3aed' | '7c3aed' | '#73e' -> [124, 58, 237], or null when not a hex colour. */
export const hexToRgb = (value) => {
  if (typeof value !== 'string') return null;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

/** Linear blend of two rgb triplets; weight 0 = a, 1 = b. */
export const mixRgb = (a, b, weight) => a.map((c, i) => Math.round(c + (b[i] - c) * weight));

/** [124, 58, 237] -> '124 58 237', the form the CSS variables hold. */
export const toChannels = (rgb) => rgb.join(' ');

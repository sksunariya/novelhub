import { PALETTE, hexToRgb, mixRgb, toChannels } from './palette';

// Turning the five admin-editable colours into the CSS variables the whole app
// is built on. Lives here rather than in SettingsContext because the admin
// settings page uses it too, to preview a palette before it is saved.

const CSS_VAR_MAP = {
  primary: '--rgb-primary',
  accent: '--rgb-accent',
  background: '--rgb-background',
  surface: '--rgb-surface',
  text: '--rgb-text',
};

const DERIVED_BRAND = ['--rgb-primary-hover', '--rgb-primary-2'];
const DERIVED_SURFACE = ['--rgb-surface-raised', '--rgb-border', '--rgb-text-muted'];
const WHITE = [255, 255, 255];

/**
 * Apply a set of theme colours to the document.
 *
 * The variables hold "r g b" channels (see tailwind.config.js), so each hex is
 * converted first. A colour equal to the shipped palette changes nothing. When
 * an admin moves away from it, the tokens that are not editable in the admin
 * form (hover fill, gradient partner, raised surface, border, muted text) are
 * derived from the ones that are, so a custom palette stays coherent instead of
 * mixing new surfaces with the default borders.
 */
export const applyThemeColors = (themeColors = {}) => {
  const root = document.documentElement.style;
  const rgb = {};
  Object.keys(CSS_VAR_MAP).forEach((key) => {
    const parsed = hexToRgb(themeColors[key]);
    if (parsed) rgb[key] = parsed;
  });

  const isCustom = (key) => {
    if (!rgb[key]) return false;
    const shipped = hexToRgb(PALETTE[key]);
    return rgb[key].some((channel, i) => channel !== shipped[i]);
  };

  Object.entries(rgb).forEach(([key, value]) => root.setProperty(CSS_VAR_MAP[key], toChannels(value)));

  if (isCustom('primary') || isCustom('accent')) {
    const primary = rgb.primary || hexToRgb(PALETTE.primary);
    const accent = rgb.accent || hexToRgb(PALETTE.accent);
    root.setProperty('--rgb-primary-hover', toChannels(mixRgb(primary, WHITE, 0.12)));
    root.setProperty('--rgb-primary-2', toChannels(mixRgb(primary, accent, 0.45)));
  } else {
    // Back on the shipped brand colours (e.g. an admin reverted them): drop any
    // values derived from an earlier custom palette so the stylesheet wins.
    DERIVED_BRAND.forEach((name) => root.removeProperty(name));
  }

  if (['background', 'surface', 'text'].some(isCustom)) {
    const background = rgb.background || hexToRgb(PALETTE.background);
    const surface = rgb.surface || hexToRgb(PALETTE.surface);
    const text = rgb.text || hexToRgb(PALETTE.text);
    root.setProperty('--rgb-surface-raised', toChannels(mixRgb(surface, text, 0.05)));
    root.setProperty('--rgb-border', toChannels(mixRgb(surface, text, 0.13)));
    root.setProperty('--rgb-text-muted', toChannels(mixRgb(text, background, 0.38)));
  } else {
    DERIVED_SURFACE.forEach((name) => root.removeProperty(name));
  }
};

export default applyThemeColors;

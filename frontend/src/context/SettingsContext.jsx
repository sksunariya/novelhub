import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import { PALETTE, hexToRgb, mixRgb, toChannels } from '../theme/palette';

const SettingsContext = createContext(null);

const CSS_VAR_MAP = {
  primary: '--rgb-primary',
  accent: '--rgb-accent',
  background: '--rgb-background',
  surface: '--rgb-surface',
  text: '--rgb-text',
};

const WHITE = [255, 255, 255];

/**
 * Apply the admin-saved theme colours.
 *
 * The variables hold "r g b" channels (see tailwind.config.js), so each hex is
 * converted first. A colour equal to the shipped palette changes nothing. When
 * an admin moves away from it, the tokens that are not editable in the admin
 * form (hover fill, gradient partner, raised surface, border, muted text) are
 * derived from the ones that are, so a custom palette stays coherent instead of
 * mixing new surfaces with the default borders.
 */
const applyThemeColors = (themeColors = {}) => {
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
    ['--rgb-primary-hover', '--rgb-primary-2'].forEach((name) => root.removeProperty(name));
  }

  if (['background', 'surface', 'text'].some(isCustom)) {
    const background = rgb.background || hexToRgb(PALETTE.background);
    const surface = rgb.surface || hexToRgb(PALETTE.surface);
    const text = rgb.text || hexToRgb(PALETTE.text);
    root.setProperty('--rgb-surface-raised', toChannels(mixRgb(surface, text, 0.05)));
    root.setProperty('--rgb-border', toChannels(mixRgb(surface, text, 0.13)));
    root.setProperty('--rgb-text-muted', toChannels(mixRgb(text, background, 0.38)));
  } else {
    ['--rgb-surface-raised', '--rgb-border', '--rgb-text-muted'].forEach((name) => root.removeProperty(name));
  }
};

const applyTheme = (settings) => {
  if (settings.themeColors) {
    applyThemeColors(settings.themeColors);
  }
  if (settings.siteName) {
    document.title = settings.siteName;
  }
  if (settings.faviconUrl) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = settings.faviconUrl;
  }
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await client.get('/settings');
      setSettings({ ...data.settings, ...(data.config || {}) });
      applyTheme(data.settings);
    } catch (error) {
      setSettings({});
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);

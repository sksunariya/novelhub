import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import { applyThemeColors } from '../theme/applyTheme';

const SettingsContext = createContext(null);

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

import { useSettings } from '../context/SettingsContext';

const Footer = () => {
  const { settings } = useSettings();
  return (
    <footer className="mt-16 border-t border-line bg-night-surface">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-silver-muted sm:flex-row sm:justify-between sm:text-left">
        <p className="font-display text-base text-silver">{settings?.siteName || 'Apex NovelHub'}</p>
        <p>{settings?.footerText || `© ${new Date().getFullYear()} All rights reserved.`}</p>
      </div>
    </footer>
  );
};

export default Footer;

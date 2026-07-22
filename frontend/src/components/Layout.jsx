import { Outlet } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import Navbar from './Navbar';
import Footer from './Footer';
import { useSettings } from '../context/SettingsContext';

const Layout = () => {
  const { settings } = useSettings();
  return (
    <div className="flex min-h-dvh flex-col">
      {settings?.announcement && (
        <div className="flex items-center justify-center gap-2 bg-crimson/15 px-4 py-2 text-center text-sm text-crimson-soft" role="status">
          <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{settings.announcement}</span>
        </div>
      )}
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-6">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default Layout;

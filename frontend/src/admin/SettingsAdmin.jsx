import { useState, useEffect } from 'react';
import { Megaphone, Palette, Globe, Image, Send, LayoutGrid } from 'lucide-react';
import client from '../api/client';
import { useSettings } from '../context/SettingsContext';
import Spinner from '../components/Spinner';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const HOME_SECTION_FIELDS = [
  { key: 'featured', label: 'Featured' },
  { key: 'trending', label: 'Trending This Week' },
  { key: 'newArrivals', label: 'New Arrivals' },
  { key: 'popular', label: 'Most Popular' },
  { key: 'completed', label: 'Completed Novels' },
  { key: 'topRated', label: 'Top Rated' },
];

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
];

const SettingsAdmin = () => {
  const { refresh } = useSettings();
  const [form, setForm] = useState(null);
  const [files, setFiles] = useState({ logo: null, favicon: null });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [broadcast, setBroadcast] = useState({ message: '', link: '' });
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState(null);

  useEffect(() => {
    client.get('/admin/settings').then(({ data }) => setForm(data.settings)).catch(() => setForm(null));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append('siteName', form.siteName);
      body.append('tagline', form.tagline);
      body.append('announcement', form.announcement);
      body.append('footerText', form.footerText);
      body.append('logoUrl', form.logoUrl);
      body.append('faviconUrl', form.faviconUrl);
      body.append('themeColors', JSON.stringify(form.themeColors));
      body.append('socialLinks', JSON.stringify(form.socialLinks));
      body.append('homeSections', JSON.stringify(form.homeSections));
      body.append('allowSignups', form.allowSignups);
      body.append('requireEmailVerification', form.requireEmailVerification);
      body.append('maintenanceMode', form.maintenanceMode);
      if (files.logo) body.append('logo', files.logo);
      if (files.favicon) body.append('favicon', files.favicon);
      const { data } = await client.put('/admin/settings', body);
      setForm(data.settings);
      setFiles({ logo: null, favicon: null });
      await refresh();
      setMessage({ type: 'success', text: 'Settings saved and applied' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const sendBroadcast = async (e) => {
    e.preventDefault();
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const { data } = await client.post('/admin/announcements', broadcast);
      setBroadcastResult({ type: 'success', text: `Sent to ${data.notifiedCount} users` });
      setBroadcast({ message: '', link: '' });
    } catch (err) {
      setBroadcastResult({ type: 'error', text: err.response?.data?.message || 'Broadcast failed' });
    } finally {
      setBroadcasting(false);
    }
  };

  if (!form) return <Spinner full />;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 font-display text-2xl font-bold text-silver">Site Settings</h1>
      <form onSubmit={save} className="space-y-6">
        <section className="rounded-xl border border-line bg-night-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
            <Globe className="h-4 w-4 text-crimson" aria-hidden="true" /> Identity
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="st-name" className="mb-1 block text-sm font-medium text-silver">Site name</label>
              <input id="st-name" value={form.siteName} onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label htmlFor="st-tagline" className="mb-1 block text-sm font-medium text-silver">Tagline</label>
              <input id="st-tagline" value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="st-footer" className="mb-1 block text-sm font-medium text-silver">Footer text</label>
              <input id="st-footer" value={form.footerText} onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))} className={inputClass} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-night-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
            <Image className="h-4 w-4 text-crimson" aria-hidden="true" /> Branding
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-silver">Logo</p>
              {form.logoUrl && <img src={form.logoUrl} alt="Current logo" className="h-16 w-16 rounded-full border border-line object-cover" />}
              <label htmlFor="st-logo-file" className="block text-xs text-silver-muted">Upload file</label>
              <input id="st-logo-file" type="file" accept="image/*" onChange={(e) => setFiles((f) => ({ ...f, logo: e.target.files[0] }))} className={`${inputClass} cursor-pointer`} />
              <label htmlFor="st-logo-url" className="block text-xs text-silver-muted">Or paste URL</label>
              <input id="st-logo-url" value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} className={inputClass} placeholder="https://... or /uploads/..." />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-silver">Favicon</p>
              {form.faviconUrl && <img src={form.faviconUrl} alt="Current favicon" className="h-10 w-10 rounded border border-line object-cover" />}
              <label htmlFor="st-fav-file" className="block text-xs text-silver-muted">Upload file</label>
              <input id="st-fav-file" type="file" accept="image/*,.ico" onChange={(e) => setFiles((f) => ({ ...f, favicon: e.target.files[0] }))} className={`${inputClass} cursor-pointer`} />
              <label htmlFor="st-fav-url" className="block text-xs text-silver-muted">Or paste URL</label>
              <input id="st-fav-url" value={form.faviconUrl} onChange={(e) => setForm((f) => ({ ...f, faviconUrl: e.target.value }))} className={inputClass} placeholder="https://... or /uploads/..." />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-night-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
            <Palette className="h-4 w-4 text-crimson" aria-hidden="true" /> Theme Colors
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {COLOR_FIELDS.map((field) => (
              <div key={field.key}>
                <label htmlFor={`st-color-${field.key}`} className="mb-1 block text-xs font-medium text-silver">{field.label}</label>
                <div className="flex items-center gap-1.5">
                  <input
                    id={`st-color-${field.key}`}
                    type="color"
                    value={form.themeColors[field.key] || '#000000'}
                    onChange={(e) => setForm((f) => ({ ...f, themeColors: { ...f.themeColors, [field.key]: e.target.value } }))}
                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-line bg-night"
                  />
                  <input
                    value={form.themeColors[field.key] || ''}
                    onChange={(e) => setForm((f) => ({ ...f, themeColors: { ...f.themeColors, [field.key]: e.target.value } }))}
                    className={`${inputClass} px-2 text-xs`}
                    aria-label={`${field.label} hex value`}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-night-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
            <LayoutGrid className="h-4 w-4 text-crimson" aria-hidden="true" /> Homepage Sections
          </h2>
          <p className="mb-3 text-xs text-silver-muted">Choose which rows appear on the homepage.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {HOME_SECTION_FIELDS.map((field) => (
              <label key={field.key} className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input
                  type="checkbox"
                  checked={form.homeSections?.[field.key] !== false}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, homeSections: { ...f.homeSections, [field.key]: e.target.checked } }))
                  }
                  className="accent-[var(--color-primary)]"
                />
                {field.label}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-night-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
            <Megaphone className="h-4 w-4 text-crimson" aria-hidden="true" /> Announcement & Access
          </h2>
          <div className="space-y-3">
            <div>
              <label htmlFor="st-announcement" className="mb-1 block text-sm font-medium text-silver">Site-wide announcement banner</label>
              <input id="st-announcement" value={form.announcement} onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))} className={inputClass} placeholder="Leave empty to hide the banner" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="st-discord" className="mb-1 block text-sm font-medium text-silver">Discord link</label>
                <input id="st-discord" value={form.socialLinks?.discord || ''} onChange={(e) => setForm((f) => ({ ...f, socialLinks: { ...f.socialLinks, discord: e.target.value } }))} className={inputClass} />
              </div>
              <div>
                <label htmlFor="st-twitter" className="mb-1 block text-sm font-medium text-silver">Twitter/X link</label>
                <input id="st-twitter" value={form.socialLinks?.twitter || ''} onChange={(e) => setForm((f) => ({ ...f, socialLinks: { ...f.socialLinks, twitter: e.target.value } }))} className={inputClass} />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input type="checkbox" checked={form.allowSignups} onChange={(e) => setForm((f) => ({ ...f, allowSignups: e.target.checked }))} className="accent-[var(--color-primary)]" />
                Allow new signups
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input type="checkbox" checked={form.requireEmailVerification || false} onChange={(e) => setForm((f) => ({ ...f, requireEmailVerification: e.target.checked }))} className="accent-[var(--color-primary)]" />
                Require email verification on signup
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input type="checkbox" checked={form.maintenanceMode} onChange={(e) => setForm((f) => ({ ...f, maintenanceMode: e.target.checked }))} className="accent-[var(--color-primary)]" />
                Maintenance mode
              </label>
            </div>
            {form.maintenanceMode && (
              <p className="rounded-lg bg-crimson/15 px-3 py-2 text-xs text-crimson-soft">
                Maintenance mode blocks the site for everyone except admins.
              </p>
            )}
          </div>
        </section>

        {message && (
          <p className={`rounded-lg px-3 py-2 text-sm ${message.type === 'success' ? 'bg-green-500/15 text-green-400' : 'bg-crimson/15 text-crimson-soft'}`} role="alert">
            {message.text}
          </p>
        )}
        <button type="submit" disabled={saving} className="cursor-pointer rounded-full bg-crimson px-6 py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <form onSubmit={sendBroadcast} className="mt-8 rounded-xl border border-line bg-night-surface p-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
          <Send className="h-4 w-4 text-crimson" aria-hidden="true" /> Broadcast Notification
        </h2>
        <p className="mb-3 text-xs text-silver-muted">Sends an in-app notification to every active user.</p>
        <div className="space-y-3">
          <div>
            <label htmlFor="bc-message" className="mb-1 block text-sm font-medium text-silver">Message</label>
            <input id="bc-message" required value={broadcast.message} onChange={(e) => setBroadcast((b) => ({ ...b, message: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="bc-link" className="mb-1 block text-sm font-medium text-silver">Link (optional)</label>
            <input id="bc-link" value={broadcast.link} onChange={(e) => setBroadcast((b) => ({ ...b, link: e.target.value }))} className={inputClass} placeholder="/novel/some-novel" />
          </div>
          {broadcastResult && (
            <p className={`rounded-lg px-3 py-2 text-sm ${broadcastResult.type === 'success' ? 'bg-green-500/15 text-green-400' : 'bg-crimson/15 text-crimson-soft'}`} role="status">
              {broadcastResult.text}
            </p>
          )}
          <button type="submit" disabled={broadcasting} className="cursor-pointer rounded-full border border-crimson px-6 py-2.5 text-sm font-semibold text-crimson-soft transition-colors hover:bg-crimson hover:text-white disabled:opacity-60">
            {broadcasting ? 'Sending...' : 'Send Broadcast'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SettingsAdmin;

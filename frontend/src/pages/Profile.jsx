import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, History, Library } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import WalletPanel from '../components/credits/WalletPanel';

const Profile = () => {
  const { user, updateUser } = useAuth();
  const [account, setAccount] = useState({ username: user.username, fullName: user.fullName || '', currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const prefs = user.notificationPreferences || {};
  const [notificationPrefs, setNotificationPrefs] = useState({
    emailMentions: prefs.emailMentions !== false,
    emailReplies: prefs.emailReplies !== false,
    emailAnnouncements: prefs.emailAnnouncements !== false,
    inAppMentions: prefs.inAppMentions !== false,
    inAppReplies: prefs.inAppReplies !== false,
  });

  const save = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!account.fullName.trim()) {
      setMessage({ type: 'error', text: 'Full name is required' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        username: account.username,
        fullName: account.fullName,
        notificationPreferences: notificationPrefs,
      };
      if (account.newPassword) {
        payload.currentPassword = account.currentPassword;
        payload.newPassword = account.newPassword;
      }
      const { data } = await client.put('/auth/profile', payload);
      updateUser({ ...user, ...data.user });
      setAccount((a) => ({ ...a, currentPassword: '', newPassword: '' }));
      setMessage({ type: 'success', text: 'Account and notification preferences saved' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Update failed' });
    } finally {
      setSaving(false);
    }
  };

  const notificationOptions = [
    { key: 'inAppMentions', label: 'In-app notifications when mentioned (@username)' },
    { key: 'inAppReplies', label: 'In-app notifications when someone replies to your comment' },
    { key: 'emailMentions', label: 'Email alerts when mentioned (@username)' },
    { key: 'emailReplies', label: 'Email alerts when someone replies to your comment' },
    { key: 'emailAnnouncements', label: 'Email announcements & site updates' },
  ];

  return (
    <PageTransition>
      <section className="panel relative mb-8 overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-crimson via-crimson-alt to-crimson/70 sm:h-36" aria-hidden="true">
          <div className="h-full w-full bg-[radial-gradient(60%_120%_at_85%_0%,rgba(255,255,255,0.25),transparent_60%)]" />
        </div>
        <div className="flex flex-col gap-4 px-5 pb-6 sm:flex-row sm:items-end sm:px-8">
          <div className="-mt-12 shrink-0 sm:-mt-14">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-24 w-24 rounded-2xl object-cover ring-4 ring-night-surface sm:h-28 sm:w-28" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-night-raised font-display text-3xl font-extrabold uppercase text-crimson-soft ring-4 ring-night-surface sm:h-28 sm:w-28">
                {(user.fullName || user.username).slice(0, 2)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl font-extrabold text-silver sm:text-3xl">{user.fullName || user.username}</h1>
              {(user.role === 'admin' || user.role === 'superadmin') && (
                <span className="eyebrow py-0.5">{user.role === 'superadmin' ? 'Superadmin' : 'Administrator'}</span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-silver-muted">
              {user.fullName ? `@${user.username} • ${user.email}` : user.email}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={save} className="panel order-2 space-y-8 p-5 sm:p-8 lg:order-1">
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-silver">Account settings</h2>
              <p className="mt-0.5 text-sm text-silver-muted">How your name appears across the site.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="acc-fullName" className="field-label">Full Name</label>
                <input
                  id="acc-fullName"
                  type="text"
                  required
                  value={account.fullName}
                  onChange={(e) => setAccount((a) => ({ ...a, fullName: e.target.value }))}
                  className="field"
                />
              </div>
              <div>
                <label htmlFor="acc-username" className="field-label">Username</label>
                <input
                  id="acc-username"
                  type="text"
                  minLength={3}
                  maxLength={30}
                  value={account.username}
                  onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))}
                  className="field"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t border-line pt-6">
            <div>
              <h2 className="font-display text-lg font-bold text-silver">Password</h2>
              <p className="mt-0.5 text-sm text-silver-muted">Leave both fields blank to keep your current password.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="acc-current" className="field-label">Current password</label>
                <input
                  id="acc-current"
                  type="password"
                  autoComplete="current-password"
                  value={account.currentPassword}
                  onChange={(e) => setAccount((a) => ({ ...a, currentPassword: e.target.value }))}
                  className="field"
                  placeholder="Required to change password"
                />
                <p className="mt-1.5 text-xs text-silver-muted">Leave blank if you signed up with Google and have no password yet.</p>
              </div>
              <div>
                <label htmlFor="acc-new" className="field-label">New password</label>
                <input
                  id="acc-new"
                  type="password"
                  minLength={6}
                  autoComplete="new-password"
                  value={account.newPassword}
                  onChange={(e) => setAccount((a) => ({ ...a, newPassword: e.target.value }))}
                  className="field"
                  placeholder="Leave blank to keep current"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-line pt-6">
          <fieldset>
            <legend className="font-display text-lg font-bold text-silver">Notification preferences</legend>
            <p className="mt-0.5 text-sm text-silver-muted">Choose what we tell you about, and where.</p>
            <div className="mt-3 space-y-1">
              {notificationOptions.map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm text-silver transition-colors hover:bg-white/[0.03]"
                >
                  <input
                    type="checkbox"
                    checked={notificationPrefs[option.key]}
                    onChange={(e) => setNotificationPrefs((p) => ({ ...p, [option.key]: e.target.checked }))}
                    className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          </div>

          {message && (
            <p className={message.type === 'success' ? 'alert-success' : 'alert-error'} role="alert">
              {message.text}
            </p>
          )}
          <div className="flex justify-end border-t border-line pt-6">
            <button type="submit" disabled={saving} className="btn btn-primary btn-md">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>

        {/* Renders nothing when monetization is off. */}
        <aside className="order-1 space-y-4 lg:order-2">
          <WalletPanel />
          <nav className="panel p-2" aria-label="Your pages">
            {[
              { to: '/library', label: 'My Library', icon: Library },
              { to: '/library?tab=history', label: 'Reading history', icon: History },
              { to: '/notifications', label: 'Notifications', icon: Bell },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-silver transition-colors hover:bg-white/[0.04]"
              >
                <item.icon className="h-4 w-4 text-crimson-soft" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-4 w-4 text-silver-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </aside>
      </div>
    </PageTransition>
  );
};

export default Profile;

import { useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import WalletPanel from '../components/credits/WalletPanel';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

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

  return (
    <PageTransition>
      <div className="mb-8 flex items-center gap-4">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full border border-line object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-crimson/20 font-display text-xl font-bold uppercase text-crimson-soft">
            {(user.fullName || user.username).slice(0, 2)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-bold text-silver">{user.fullName || user.username}</h1>
          <p className="truncate text-sm text-silver-muted">
            {user.fullName ? `@${user.username} • ${user.email}` : user.email}
          </p>
          {user.role === 'admin' && <p className="text-xs font-medium text-crimson-soft">Administrator</p>}
          {user.role === 'superadmin' && <p className="text-xs font-medium text-crimson-soft">Superadmin</p>}
        </div>
      </div>

      {/* Renders nothing when monetization is off. */}
      <div className="mb-6 max-w-md">
        <WalletPanel />
      </div>

      <form onSubmit={save} className="max-w-md space-y-6 rounded-xl border border-line bg-night-surface p-6">
        <div className="space-y-4">
          <h2 className="font-display text-lg font-bold text-silver">Account Settings</h2>
          <div>
            <label htmlFor="acc-fullName" className="mb-1.5 block text-sm font-medium text-silver">Full Name</label>
            <input
              id="acc-fullName"
              type="text"
              required
              value={account.fullName}
              onChange={(e) => setAccount((a) => ({ ...a, fullName: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acc-username" className="mb-1.5 block text-sm font-medium text-silver">Username</label>
            <input
              id="acc-username"
              type="text"
              minLength={3}
              maxLength={30}
              value={account.username}
              onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acc-current" className="mb-1.5 block text-sm font-medium text-silver">Current password</label>
            <input
              id="acc-current"
              type="password"
              autoComplete="current-password"
              value={account.currentPassword}
              onChange={(e) => setAccount((a) => ({ ...a, currentPassword: e.target.value }))}
              className={inputClass}
              placeholder="Required to change password"
            />
            <p className="mt-1 text-xs text-silver-muted">Leave blank if you signed up with Google and have no password yet.</p>
          </div>
          <div>
            <label htmlFor="acc-new" className="mb-1.5 block text-sm font-medium text-silver">New password</label>
            <input
              id="acc-new"
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={account.newPassword}
              onChange={(e) => setAccount((a) => ({ ...a, newPassword: e.target.value }))}
              className={inputClass}
              placeholder="Leave blank to keep current"
            />
          </div>
        </div>

        <div className="border-t border-line pt-4 space-y-3">
          <h2 className="font-display text-base font-bold text-silver">Notification Preferences</h2>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
              <input
                type="checkbox"
                checked={notificationPrefs.inAppMentions}
                onChange={(e) => setNotificationPrefs((p) => ({ ...p, inAppMentions: e.target.checked }))}
                className="accent-[var(--color-primary)]"
              />
              In-app notifications when mentioned (@username)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
              <input
                type="checkbox"
                checked={notificationPrefs.inAppReplies}
                onChange={(e) => setNotificationPrefs((p) => ({ ...p, inAppReplies: e.target.checked }))}
                className="accent-[var(--color-primary)]"
              />
              In-app notifications when someone replies to your comment
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
              <input
                type="checkbox"
                checked={notificationPrefs.emailMentions}
                onChange={(e) => setNotificationPrefs((p) => ({ ...p, emailMentions: e.target.checked }))}
                className="accent-[var(--color-primary)]"
              />
              Email alerts when mentioned (@username)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
              <input
                type="checkbox"
                checked={notificationPrefs.emailReplies}
                onChange={(e) => setNotificationPrefs((p) => ({ ...p, emailReplies: e.target.checked }))}
                className="accent-[var(--color-primary)]"
              />
              Email alerts when someone replies to your comment
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
              <input
                type="checkbox"
                checked={notificationPrefs.emailAnnouncements}
                onChange={(e) => setNotificationPrefs((p) => ({ ...p, emailAnnouncements: e.target.checked }))}
                className="accent-[var(--color-primary)]"
              />
              Email announcements & site updates
            </label>
          </div>
        </div>

        {message && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              message.type === 'success' ? 'bg-green-500/15 text-green-400' : 'bg-crimson/15 text-crimson-soft'
            }`}
            role="alert"
          >
            {message.text}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="cursor-pointer rounded-full bg-crimson px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </PageTransition>
  );
};

export default Profile;

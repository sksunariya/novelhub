import { useState, useEffect, useCallback } from 'react';
import { Send, Bell, Mail, Users, CheckCircle, AlertCircle } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3.5 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const NotificationsAdmin = () => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [targetAudience, setTargetAudience] = useState('all');
  const [targetSearch, setTargetSearch] = useState('');
  const [targetUser, setTargetUser] = useState(null);
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [inAppChannel, setInAppChannel] = useState(true);
  const [emailChannel, setEmailChannel] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  // Campaign log history state
  const [campaigns, setCampaigns] = useState(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });

  const loadCampaigns = useCallback(() => {
    client
      .get('/admin/notifications/campaigns', { params: { page } })
      .then(({ data }) => {
        setCampaigns(data.campaigns);
        setMeta({ pages: data.pages, total: data.total });
      })
      .catch(() => setCampaigns([]));
  }, [page]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  // Search users for specific target user selection
  useEffect(() => {
    if (targetAudience !== 'specific' || !targetSearch.trim()) {
      setUserSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingUsers(true);
      client
        .get('/admin/users', { params: { search: targetSearch.trim(), limit: 5 } })
        .then(({ data }) => setUserSearchResults(data.users || []))
        .catch(() => setUserSearchResults([]))
        .finally(() => setSearchingUsers(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [targetAudience, targetSearch]);

  const handleDispatch = async (e) => {
    e.preventDefault();
    setStatusMsg(null);
    if (!title.trim() || !message.trim()) {
      setStatusMsg({ type: 'error', text: 'Title and message are required.' });
      return;
    }
    if (!inAppChannel && !emailChannel) {
      setStatusMsg({ type: 'error', text: 'Select at least one delivery channel (In-App or Email).' });
      return;
    }
    if (targetAudience === 'specific' && !targetUser) {
      setStatusMsg({ type: 'error', text: 'Please select a specific target user.' });
      return;
    }

    setDispatching(true);
    const channels = [];
    if (inAppChannel) channels.push('in_app');
    if (emailChannel) channels.push('email');

    try {
      const payload = {
        title: title.trim(),
        message: message.trim(),
        link: link.trim(),
        targetAudience,
        targetUserId: targetAudience === 'specific' ? targetUser._id : null,
        channels,
      };

      const { data } = await client.post('/admin/notifications/dispatch', payload);
      setStatusMsg({ type: 'success', text: data.message || 'Notification campaign dispatched!' });

      // Reset form
      setTitle('');
      setMessage('');
      setLink('');
      setTargetAudience('all');
      setTargetUser(null);
      setTargetSearch('');

      // Refresh log
      loadCampaigns();
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.message || 'Failed to dispatch notification.' });
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-silver">Notification & Campaign Manager</h1>
        <p className="text-sm text-silver-muted">
          Compose real-time custom messages, announcements, or email campaigns directly from the admin portal.
        </p>
      </div>

      <form onSubmit={handleDispatch} className="max-w-2xl space-y-4 rounded-xl border border-line bg-night-surface p-6 shadow-card">
        <h2 className="font-display text-lg font-bold text-silver">Dispatch New Notification</h2>

        <div>
          <label htmlFor="camp-title" className="mb-1.5 block text-sm font-medium text-silver">
            Notification Title
          </label>
          <input
            id="camp-title"
            type="text"
            required
            placeholder="e.g. Special Weekend Event or New Feature Alert"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="camp-message" className="mb-1.5 block text-sm font-medium text-silver">
            Message Body
          </label>
          <textarea
            id="camp-message"
            required
            rows={3}
            maxLength={500}
            placeholder="Write your campaign or custom message content (max 500 characters)..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="camp-link" className="mb-1.5 block text-sm font-medium text-silver">
            Target URL / Path (Optional)
          </label>
          <input
            id="camp-link"
            type="text"
            placeholder="e.g. /browse or /novel/shadow-domain"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="camp-audience" className="mb-1.5 block text-sm font-medium text-silver">
              Target Audience
            </label>
            <select
              id="camp-audience"
              value={targetAudience}
              onChange={(e) => {
                setTargetAudience(e.target.value);
                setTargetUser(null);
                setTargetSearch('');
              }}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="all">All Users (Broadcast)</option>
              <option value="user">Regular Users Only</option>
              <option value="admin">Admin Staff Only</option>
              <option value="specific">Specific User</option>
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-silver">Delivery Channels</span>
            <div className="flex items-center gap-4 pt-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input
                  type="checkbox"
                  checked={inAppChannel}
                  onChange={(e) => setInAppChannel(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                <Bell className="h-4 w-4 text-silver-muted" /> In-App
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                <input
                  type="checkbox"
                  checked={emailChannel}
                  onChange={(e) => setEmailChannel(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                <Mail className="h-4 w-4 text-silver-muted" /> Email
              </label>
            </div>
          </div>
        </div>

        {targetAudience === 'specific' && (
          <div className="space-y-2 rounded-lg border border-line bg-night/50 p-3">
            <label htmlFor="user-search" className="block text-xs font-medium text-silver">
              Search Target User
            </label>
            {targetUser ? (
              <div className="flex items-center justify-between rounded-md border border-line bg-night-surface p-2 text-xs">
                <span className="font-semibold text-silver">
                  {targetUser.fullName ? `${targetUser.fullName} (@${targetUser.username})` : targetUser.username} ({targetUser.email})
                </span>
                <button
                  type="button"
                  onClick={() => setTargetUser(null)}
                  className="text-crimson-soft hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  id="user-search"
                  type="search"
                  placeholder="Type username or email..."
                  value={targetSearch}
                  onChange={(e) => setTargetSearch(e.target.value)}
                  className={inputClass}
                />
                {searchingUsers && <p className="mt-1 text-xs text-silver-muted">Searching...</p>}
                {userSearchResults.length > 0 && (
                  <div className="mt-2 divide-y divide-line rounded-lg border border-line bg-night-raised">
                    {userSearchResults.map((u) => (
                      <button
                        key={u._id}
                        type="button"
                        onClick={() => setTargetUser(u)}
                        className="flex w-full cursor-pointer items-center justify-between p-2 text-left text-xs text-silver hover:bg-night-surface"
                      >
                        <span>{u.fullName || u.username}</span>
                        <span className="text-silver-muted">{u.email}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {statusMsg && (
          <div
            className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
              statusMsg.type === 'success' ? 'bg-green-500/15 text-green-400' : 'bg-crimson/15 text-crimson-soft'
            }`}
          >
            {statusMsg.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={dispatching}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {dispatching ? 'Dispatching...' : 'Dispatch Notification'}
          </button>
        </div>
      </form>

      {/* Campaign Log & Audit Table */}
      <div>
        <h2 className="mb-4 font-display text-xl font-bold text-silver">Dispatch Audit History</h2>
        {campaigns === null ? (
          <Spinner full />
        ) : campaigns.length === 0 ? (
          <p className="rounded-xl border border-line bg-night-surface py-12 text-center text-silver-muted">
            No previous campaign dispatches.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-night-surface text-xs uppercase text-silver-muted">
                <tr>
                  <th className="px-4 py-3">Campaign / Title</th>
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3">Channels</th>
                  <th className="px-4 py-3">Recipients</th>
                  <th className="px-4 py-3">Sent By</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {campaigns.map((camp) => (
                  <tr key={camp._id} className="bg-night transition-colors hover:bg-night-surface">
                    <td className="px-4 py-3">
                      <p className="font-medium text-silver">{camp.title}</p>
                      <p className="truncate text-xs text-silver-muted max-w-xs">{camp.message}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-silver-muted">
                      {camp.targetAudience === 'specific' && camp.targetUser
                        ? `@${camp.targetUser.username}`
                        : camp.targetAudience}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {camp.channels?.includes('in_app') && (
                          <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400">In-App</span>
                        )}
                        {camp.channels?.includes('email') && (
                          <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs text-purple-400">Email</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-silver">{camp.recipientCount}</td>
                    <td className="px-4 py-3 text-silver-muted">{camp.createdBy?.username || 'Admin'}</td>
                    <td className="px-4 py-3 text-silver-muted">{new Date(camp.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />
      </div>
    </div>
  );
};

export default NotificationsAdmin;

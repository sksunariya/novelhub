import { useState, useEffect, useCallback, useMemo } from 'react';
import { Send, Bell, Mail, Users, CheckCircle, AlertCircle } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';
import EmailListRecipients from './EmailListRecipients';
import { parseEmailList, mergeParseResults, MAX_RECIPIENTS } from '../utils/emailList';

const AUDIENCE_LABELS = {
  all: 'All Users (Broadcast)',
  user: 'Regular Users Only',
  admin: 'Admin Staff Only',
  specific: 'Specific User',
  emails: 'Custom Email List',
};

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
  const [inAppChannel, setInAppChannel] = useState(false);
  const [emailChannel, setEmailChannel] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Marketing audience: a pasted list plus any number of uploaded CSVs.
  const [rawEmails, setRawEmails] = useState('');
  const [csvFiles, setCsvFiles] = useState([]);
  const [dispatchSummary, setDispatchSummary] = useState(null);
  // The list as it stood when the admin hit Dispatch. What the confirm modal
  // shows and what gets posted are the same object, so a keystroke landing
  // between confirming and sending cannot change the recipients.
  const [pendingRecipients, setPendingRecipients] = useState(null);

  // Campaign log history state
  const [campaigns, setCampaigns] = useState(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });

  const emailsAudience = targetAudience === 'emails';

  // Debounced copy of the textarea, for the preview only. Re-parsing a
  // 5,000-line paste on every keystroke is measurable; waiting a beat is not.
  const [previewText, setPreviewText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPreviewText(rawEmails), 200);
    return () => clearTimeout(timer);
  }, [rawEmails]);

  // Live counts under the inputs. Advisory only — the authoritative parse
  // happens at submit (below) and again on the server.
  const parsedRecipients = useMemo(
    () => mergeParseResults(parseEmailList(previewText), ...csvFiles.map((file) => file.result)),
    [previewText, csvFiles]
  );

  // The parse that decides what is sent: run against the text as it is right
  // now, not the debounced copy.
  const buildRecipients = useCallback(
    () => mergeParseResults(parseEmailList(rawEmails), ...csvFiles.map((file) => file.result)),
    [rawEmails, csvFiles]
  );

  // An address with no account cannot receive an in-app notification, so this
  // audience is email-only. Forced here and shown as forced below, rather than
  // offering a choice the dispatch would silently override.
  useEffect(() => {
    if (targetAudience !== 'emails') return;
    setInAppChannel(false);
    setEmailChannel(true);
  }, [targetAudience]);

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

  const handleFormSubmit = (e) => {
    e.preventDefault();
    setStatusMsg(null);
    setDispatchSummary(null);
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
    if (targetAudience === 'emails') {
      const recipients = buildRecipients();
      if (!recipients.emails.length) {
        setStatusMsg({
          type: 'error',
          text: recipients.invalidCount
            ? 'None of the entries are valid email addresses. Check the highlighted rows.'
            : 'Add at least one email address, or upload a CSV.',
        });
        return;
      }
      if (recipients.emails.length > MAX_RECIPIENTS) {
        setStatusMsg({
          type: 'error',
          text: `${recipients.emails.length.toLocaleString('en-US')} addresses is over the ${MAX_RECIPIENTS.toLocaleString('en-US')} limit for one campaign. Split it into smaller sends.`,
        });
        return;
      }
      setPendingRecipients(recipients);
    }
    setShowConfirmModal(true);
  };

  const executeDispatch = async () => {
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

      if (targetAudience === 'emails') {
        payload.emails = (pendingRecipients || buildRecipients()).emails;
        // Recorded on the campaign so an audit can tell a hand-typed list from
        // an uploaded one without reading the addresses back.
        payload.recipientSource =
          csvFiles.length && rawEmails.trim() ? 'mixed' : csvFiles.length ? 'csv' : 'manual';
      }

      const { data } = await client.post('/admin/notifications/dispatch', payload);
      setStatusMsg({ type: 'success', text: data.message || 'Notification campaign dispatched!' });
      setDispatchSummary(data.summary || null);

      // Reset form
      setTitle('');
      setMessage('');
      setLink('');
      setTargetAudience('all');
      setTargetUser(null);
      setTargetSearch('');
      setRawEmails('');
      setCsvFiles([]);
      setPendingRecipients(null);
      setInAppChannel(false);
      setEmailChannel(false);
      setShowConfirmModal(false);

      // Refresh log
      loadCampaigns();
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.message || 'Failed to dispatch notification.' });
      setDispatchSummary(null);
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

      <form onSubmit={handleFormSubmit} className="max-w-2xl space-y-4 rounded-xl border border-line bg-night-surface p-6 shadow-card">
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
              <option value="emails">Custom Email List (incl. non-members)</option>
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-silver">Delivery Channels</span>
            <div className="flex items-center gap-4 pt-2">
              <label
                className={`flex items-center gap-2 text-sm ${
                  emailsAudience ? 'cursor-not-allowed text-silver-muted/60' : 'cursor-pointer text-silver'
                }`}
              >
                <input
                  type="checkbox"
                  checked={inAppChannel}
                  disabled={emailsAudience}
                  onChange={(e) => setInAppChannel(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                <Bell className="h-4 w-4 text-silver-muted" /> In-App
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  emailsAudience ? 'cursor-not-allowed text-silver-muted/60' : 'cursor-pointer text-silver'
                }`}
              >
                <input
                  type="checkbox"
                  checked={emailChannel}
                  disabled={emailsAudience}
                  onChange={(e) => setEmailChannel(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                <Mail className="h-4 w-4 text-silver-muted" /> Email
              </label>
            </div>
            {emailsAudience && (
              <p className="mt-1.5 text-xs text-silver-muted">
                Email only — an address without an account has no in-app inbox.
              </p>
            )}
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

        {emailsAudience && (
          <EmailListRecipients
            rawEmails={rawEmails}
            onRawEmailsChange={setRawEmails}
            csvFiles={csvFiles}
            onCsvFilesChange={setCsvFiles}
            parsed={parsedRecipients}
            inputClass={inputClass}
          />
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

        {/* The server's own counts, which are the ones that decided the send. */}
        {dispatchSummary && (
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line/60 bg-night-surface p-3 text-xs sm:grid-cols-4">
            {[
              ['Sent to', dispatchSummary.recipientCount],
              ['Registered', dispatchSummary.matchedUserCount],
              ['New contacts', dispatchSummary.externalCount],
              ['Suppressed', dispatchSummary.suppressedCount],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-semibold uppercase text-silver-muted">{label}</dt>
                <dd className="font-semibold text-silver">{(value || 0).toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
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
                    <td className="px-4 py-3 text-silver-muted">
                      {camp.targetAudience === 'specific' && camp.targetUser ? (
                        `@${camp.targetUser.username}`
                      ) : camp.targetAudience === 'emails' ? (
                        <>
                          <span className="text-silver">Email list</span>
                          <span className="block text-xs">
                            {(camp.matchedUserCount || 0).toLocaleString('en-US')} registered ·{' '}
                            {(camp.externalCount || 0).toLocaleString('en-US')} new
                            {camp.recipientSource ? ` · ${camp.recipientSource}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="capitalize">{camp.targetAudience}</span>
                      )}
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

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg space-y-5 rounded-2xl border border-line bg-night-raised p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold text-silver">
                <Send className="h-5 w-5 text-crimson" /> Verify Campaign Details
              </h3>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="cursor-pointer text-sm text-silver-muted transition-colors hover:text-silver"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-2 rounded-xl border border-line/60 bg-night-surface p-3.5">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-silver-muted">Title:</span>
                  <p className="text-sm font-bold text-silver">{title}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold uppercase text-silver-muted">Message Preview:</span>
                  <p className="whitespace-pre-wrap text-silver leading-relaxed">{message}</p>
                </div>
                {link && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase text-silver-muted">Target Link:</span>
                    <p className="font-mono text-[11px] text-blue-400">{link}</p>
                  </div>
                )}
              </div>

              {emailsAudience && pendingRecipients && (
                <div className="space-y-1.5 rounded-xl border border-line/60 bg-night-surface p-3.5">
                  <span className="text-[10px] font-semibold uppercase text-silver-muted">Recipients:</span>
                  <p className="break-words font-mono text-[11px] leading-relaxed text-silver">
                    {pendingRecipients.emails.slice(0, 8).join(', ')}
                    {pendingRecipients.emails.length > 8 && (
                      <span className="text-silver-muted">
                        {' '}
                        …and {(pendingRecipients.emails.length - 8).toLocaleString('en-US')} more
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-silver-muted">
                    Addresses belonging to a member who turned announcement emails off, or to a banned or
                    closed account, are skipped automatically.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-line/60 bg-night-surface p-3">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-silver-muted">Target Audience:</span>
                  <span className="font-semibold text-silver">
                    {targetAudience === 'specific' && targetUser
                      ? `@${targetUser.username}`
                      : emailsAudience && pendingRecipients
                        ? `${pendingRecipients.emails.length.toLocaleString('en-US')} email address${
                            pendingRecipients.emails.length === 1 ? '' : 'es'
                          }`
                        : AUDIENCE_LABELS[targetAudience]}
                  </span>
                </div>

                <div className="rounded-xl border border-line/60 bg-night-surface p-3">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-silver-muted">Selected Channels:</span>
                  <div className="flex flex-wrap gap-1">
                    {inAppChannel && (
                      <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400">
                        In-App Notification
                      </span>
                    )}
                    {emailChannel && (
                      <span className="rounded-full bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-purple-400">
                        Email Broadcast
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              ⚠️ Please double-check your message text and audience targeting before confirming dispatch.
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="cursor-pointer rounded-full border border-line px-4 py-2 text-xs font-semibold text-silver transition-colors hover:bg-white/10"
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={executeDispatch}
                disabled={dispatching}
                className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-5 py-2 text-xs font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {dispatching ? 'Sending...' : 'Confirm & Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsAdmin;

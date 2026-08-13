import { useState, useEffect, useCallback, useRef } from 'react';
import { Gift, Users, PlayCircle, FlaskConical, AlertTriangle, Send } from 'lucide-react';
import {
  getGrants, previewAudience, createGrant, dryRunGrant, executeGrant, quickSendCredits,
} from '../api/adminConfig';
import { formatRelativeTime } from '../utils/dateUtils';
import Spinner from '../components/Spinner';
import UserPicker from './UserPicker';

const field = 'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none';

const MODES = [
  { value: 'all', label: 'Everyone' },
  { value: 'role', label: 'By role' },
  { value: 'specific', label: 'Specific users' },
  { value: 'query', label: 'Match a rule' },
];

const AMOUNT_MODES = [
  { value: 'fixed', label: 'Fixed amount each', hint: 'Everyone gets the same number of credits.' },
  { value: 'top_up_to', label: 'Top up to', hint: 'Bring every balance up to this figure. Nobody sits below it.' },
  { value: 'match_percent', label: 'Match % of spend', hint: 'A loyalty rebate proportional to what they have spent.' },
];

const GrantsAdmin = () => {
  const [campaigns, setCampaigns] = useState(null);
  const [draft, setDraft] = useState(null);
  const [audience, setAudience] = useState({ total: null, sample: [] });
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [dryRun, setDryRun] = useState(null);
  const [quick, setQuick] = useState(null);
  // The picker keeps whole user objects for its chips; the campaign rule only
  // stores ids, so the two are held separately and joined on save.
  const [picked, setPicked] = useState([]);
  const debounce = useRef(null);

  const load = useCallback(async () => {
    const data = await getGrants({ limit: 20 });
    setCampaigns(data.campaigns);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live count as the rule is edited. This is the point of the builder: nobody
  // should discover the blast radius after pressing send.
  useEffect(() => {
    if (!draft) return undefined;
    setCounting(true);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        setAudience(await previewAudience(draft.audience));
      } catch (error) {
        setAudience({ total: null, sample: [] });
      } finally {
        setCounting(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [draft]);

  const start = () => {
    setQuick(null);
    setPicked([]);
    setDraft({
      name: '',
      amount: 100,
      amountMode: 'fixed',
      expiryDays: 0,
      audience: { mode: 'all' },
      notify: { enabled: true, channels: ['in_app'] },
    });
  };

  const startQuick = () => {
    setDraft(null);
    setPicked([]);
    setQuick({ amount: 100, reason: '', expiryDays: 0, notify: true });
  };

  const setAudienceRule = (changes) =>
    setDraft((prev) => ({ ...prev, audience: { ...prev.audience, ...changes } }));

  const pickUsers = (users) => {
    setPicked(users);
    setAudienceRule({ userIds: users.map((user) => user.id) });
  };

  const setQuery = (changes) =>
    setAudienceRule({ query: { ...(draft.audience.query || {}), ...changes } });

  const save = async () => {
    setBusy('save');
    try {
      const { campaign } = await createGrant(draft);
      setDraft(null);
      setPicked([]);
      setDryRun(null);
      setFlash(`Created "${campaign.name}". Dry run it before executing.`);
      await load();
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not create the campaign');
    } finally {
      setBusy('');
    }
  };

  // Quick send skips the two-step dance, so the confirm carries the exact
  // numbers — this pays out the moment it is accepted.
  const sendQuick = async () => {
    const total = quick.amount * picked.length;
    const who = picked.length === 1 ? picked[0].username : `${picked.length} users`;
    if (!window.confirm(`Send ${quick.amount} credits to ${who} (${total} total) now?`)) return;

    setBusy('quick');
    try {
      const result = await quickSendCredits({
        userIds: picked.map((user) => user.id),
        amount: quick.amount,
        reason: quick.reason,
        expiryDays: quick.expiryDays,
        notify: quick.notify,
      });
      setQuick(null);
      setPicked([]);
      setFlash(`Sent ${result.stats.creditsIssued.toLocaleString()} credits to ${result.stats.granted} user${result.stats.granted === 1 ? '' : 's'}.`);
      await load();
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not send the credits');
    } finally {
      setBusy('');
    }
  };

  const runDry = async (id) => {
    setBusy(id);
    try {
      setDryRun({ id, ...(await dryRunGrant(id)) });
      await load();
    } finally {
      setBusy('');
    }
  };

  const execute = async (campaign) => {
    const confirmed = window.confirm(
      `Issue credits to ${campaign.lastDryRunCount ?? '?'} users? This cannot be undone except by reversing the campaign.`
    );
    if (!confirmed) return;
    setBusy(campaign._id);
    try {
      const result = await executeGrant(campaign._id);
      setFlash(`Granted ${result.stats.creditsIssued.toLocaleString()} credits to ${result.stats.granted} users.`);
      await load();
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not execute the campaign');
    } finally {
      setBusy('');
    }
  };

  if (!campaigns) return <Spinner />;

  const query = draft?.audience?.query || {};

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Free credit grants</h1>
          <p className="text-xs text-silver-muted">Give credits to everyone, a segment, or specific readers.</p>
        </div>
        {!draft && !quick && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startQuick}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-semibold text-silver-muted hover:text-silver"
            >
              <Send className="h-4 w-4" aria-hidden="true" /> Send to a user
            </button>
            <button
              type="button"
              onClick={start}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-soft"
            >
              <Gift className="h-4 w-4" aria-hidden="true" /> New campaign
            </button>
          </div>
        )}
      </div>

      {flash && (
        <p className="mb-4 rounded-lg border border-line bg-night-surface p-3 text-sm text-silver">{flash}</p>
      )}

      {quick && (
        <div className="mb-6 rounded-xl border border-crimson/40 bg-night-surface p-4">
          <p className="mb-1 text-sm font-semibold text-silver">Send credits to specific users</p>
          <p className="mb-3 text-xs text-silver-muted">
            Pays out immediately. It is still recorded as a campaign, so it can be reversed.
          </p>

          <UserPicker value={picked} onChange={setPicked} />

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">Credits each</span>
              <input
                type="number"
                min="1"
                className={field}
                value={quick.amount}
                onChange={(event) => setQuick({ ...quick, amount: Number(event.target.value) })}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-silver-muted">Reason</span>
              <input
                className={field}
                value={quick.reason}
                placeholder="Compensation for the outage"
                onChange={(event) => setQuick({ ...quick, reason: event.target.value })}
              />
              <span className="mt-1 block text-[11px] text-silver-muted">
                Shown to the recipient and kept on the ledger.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">Expire after (days)</span>
              <input
                type="number"
                min="0"
                className={field}
                value={quick.expiryDays}
                onChange={(event) => setQuick({ ...quick, expiryDays: Number(event.target.value) })}
              />
            </label>
            <label className="flex items-end gap-2 text-sm text-silver-muted">
              <input
                type="checkbox"
                checked={quick.notify}
                onChange={(event) => setQuick({ ...quick, notify: event.target.checked })}
              />
              Notify them
            </label>
          </div>

          {picked.length > 0 && quick.amount > 0 && (
            <p className="mt-3 rounded-lg bg-night p-3 text-sm text-silver">
              {picked.length === 1 ? (
                <>
                  <span className="font-semibold">{picked[0].username}</span> goes from{' '}
                  {picked[0].balance.toLocaleString()} to{' '}
                  {(picked[0].balance + quick.amount).toLocaleString()} credits.
                </>
              ) : (
                <>
                  {picked.length} users ·{' '}
                  <span className="font-semibold">{(quick.amount * picked.length).toLocaleString()}</span>{' '}
                  credits in total.
                </>
              )}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={sendQuick}
              disabled={busy === 'quick' || !picked.length || !(quick.amount > 0)}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {busy === 'quick' ? 'Sending...' : 'Send credits'}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuick(null);
                setPicked([]);
              }}
              className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="mb-6 rounded-xl border border-crimson/40 bg-night-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-silver-muted">Campaign name</span>
              <input
                className={field}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Launch week gift"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">How much</span>
              <select
                className={field}
                value={draft.amountMode}
                onChange={(event) => setDraft({ ...draft, amountMode: event.target.value })}
              >
                {AMOUNT_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-silver-muted">
                {AMOUNT_MODES.find((m) => m.value === draft.amountMode)?.hint}
              </span>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">
                {draft.amountMode === 'match_percent' ? 'Percent' : 'Credits'}
              </span>
              <input
                type="number"
                min="0"
                className={field}
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })}
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">Expire after (days)</span>
              <input
                type="number"
                min="0"
                className={field}
                value={draft.expiryDays}
                onChange={(event) => setDraft({ ...draft, expiryDays: Number(event.target.value) })}
              />
              <span className="mt-1 block text-[11px] text-silver-muted">0 means they never expire.</span>
            </label>

            <label className="flex items-end gap-2 text-sm text-silver-muted">
              <input
                type="checkbox"
                checked={draft.notify.enabled}
                onChange={(event) =>
                  setDraft({ ...draft, notify: { ...draft.notify, enabled: event.target.checked } })
                }
              />
              Notify recipients
            </label>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">Who gets it</p>
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => {
                    // Leaving stale userIds on a rule that no longer reads them
                    // would resurface them if the admin switched back.
                    if (mode.value !== 'specific') setPicked([]);
                    setAudienceRule({
                      mode: mode.value,
                      userIds: mode.value === 'specific' ? picked.map((user) => user.id) : [],
                    });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    draft.audience.mode === mode.value
                      ? 'border-crimson bg-crimson/15 text-crimson-soft'
                      : 'border-line text-silver-muted'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {draft.audience.mode === 'role' && (
              <select
                className={`${field} mt-3 max-w-xs`}
                value={draft.audience.role || 'user'}
                onChange={(event) => setAudienceRule({ role: event.target.value })}
              >
                <option value="user">Readers</option>
                <option value="admin">Admins</option>
              </select>
            )}

            {draft.audience.mode === 'specific' && (
              <div className="mt-3 max-w-md">
                <UserPicker value={picked} onChange={pickUsers} />
              </div>
            )}

            {draft.audience.mode === 'query' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-silver-muted">
                  Inactive for at least (days)
                  <input
                    type="number"
                    min="0"
                    className={`${field} mt-1`}
                    value={query.inactiveForDays || ''}
                    onChange={(event) =>
                      setQuery({ inactiveForDays: Number(event.target.value) || undefined })
                    }
                  />
                </label>
                <label className="text-xs text-silver-muted">
                  Balance below
                  <input
                    type="number"
                    min="0"
                    className={`${field} mt-1`}
                    value={query.balanceBelow ?? ''}
                    onChange={(event) =>
                      setQuery({
                        balanceBelow: event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-silver-muted">
                  <input
                    type="checkbox"
                    checked={query.hasEverPurchased === true}
                    onChange={(event) => setQuery({ hasEverPurchased: event.target.checked || undefined })}
                  />
                  Has purchased before
                </label>
                <label className="text-xs text-silver-muted">
                  Cap at first N users
                  <input
                    type="number"
                    min="0"
                    className={`${field} mt-1`}
                    value={draft.audience.limit || ''}
                    onChange={(event) => setAudienceRule({ limit: Number(event.target.value) || 0 })}
                  />
                </label>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-night p-3">
              <Users className="h-4 w-4 text-crimson-soft" aria-hidden="true" />
              <p className="text-sm text-silver">
                {counting ? (
                  'Counting...'
                ) : audience.total === null ? (
                  'Could not count that audience'
                ) : (
                  <>
                    This will target{' '}
                    <span className="font-semibold">{audience.total.toLocaleString()}</span> user
                    {audience.total === 1 ? '' : 's'}
                  </>
                )}
              </p>
              {audience.sample?.length > 0 && (
                <p className="text-[11px] text-silver-muted">
                  e.g. {audience.sample.slice(0, 3).map((u) => u.username).join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy === 'save' || !draft.name || !audience.total}
              className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-50"
            >
              {busy === 'save' ? 'Creating...' : 'Create campaign'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {campaigns.length === 0 && !draft && (
          <p className="rounded-xl border border-line bg-night-surface p-6 text-center text-sm text-silver-muted">
            No campaigns yet.
          </p>
        )}

        {campaigns.map((campaign) => {
          const preview = dryRun && dryRun.id === campaign._id ? dryRun : null;
          const canExecute = campaign.status === 'draft' && campaign.lastDryRunAt;

          return (
            <div key={campaign._id} className="rounded-xl border border-line bg-night-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-silver">{campaign.name}</p>
                  <p className="text-xs text-silver-muted">
                    {campaign.amountMode === 'fixed'
                      ? `${campaign.amount} credits each`
                      : campaign.amountMode === 'top_up_to'
                        ? `top up to ${campaign.amount}`
                        : `${campaign.amount}% of spend`}
                    {' · '}
                    {campaign.status}
                    {campaign.createdAt && ` · ${formatRelativeTime(campaign.createdAt)}`}
                  </p>
                  {campaign.stats?.granted > 0 && (
                    <p className="mt-1 text-xs text-green-400">
                      {campaign.stats.granted.toLocaleString()} granted ·{' '}
                      {campaign.stats.creditsIssued.toLocaleString()} credits issued
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => runDry(campaign._id)}
                    disabled={busy === campaign._id || campaign.status !== 'draft'}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver disabled:opacity-40"
                  >
                    <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Dry run
                  </button>
                  <button
                    type="button"
                    onClick={() => execute(campaign)}
                    disabled={busy === campaign._id || !canExecute}
                    title={canExecute ? '' : 'Dry run first'}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-crimson px-3 py-1.5 text-xs font-semibold text-white hover:bg-crimson-soft disabled:opacity-40"
                  >
                    <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> Execute
                  </button>
                </div>
              </div>

              {preview && (
                <div className="mt-3 rounded-lg border border-line bg-night p-3 text-xs">
                  <p className="flex items-center gap-1.5 text-silver">
                    <AlertTriangle className="h-3.5 w-3.5 text-crimson-soft" aria-hidden="true" />
                    Would issue {preview.creditsIssued.toLocaleString()} credits to{' '}
                    {preview.wouldGrant.toLocaleString()} users
                    {preview.skipped > 0 && `, skipping ${preview.skipped}`}.
                  </p>
                  {/* Free credits carry no cash but do add content owed. */}
                  <p className="mt-1 text-silver-muted">
                    Adds ${(preview.liabilityUsdCents / 100).toFixed(2)} to outstanding content liability.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GrantsAdmin;

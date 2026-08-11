import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, X, RefreshCw, AlertTriangle, Users } from 'lucide-react';
import {
  getPlans,
  createPlan,
  updatePlan,
  syncPlan,
  deletePlan,
  getSubscriptionSummary,
} from '../api/adminConfig';
import Spinner from '../components/Spinner';

const BLANK = {
  name: '',
  tier: '',
  description: '',
  priceUsdCents: 499,
  interval: 'month',
  intervalCount: 1,
  trialDays: 0,
  monthlyCredits: 500,
  active: true,
  perks: {
    freeUnlocks: 'none',
    freeUnlockLimit: 0,
    freeUnlockNovels: [],
    packDiscountPct: 0,
    chapterDiscountPct: 0,
    earlyAccessHours: 0,
    adFree: false,
    profileBadge: '',
    badgeColor: '',
  },
};

const field =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none';

const usd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const FREE_UNLOCK_MODES = [
  { value: 'none', label: 'No free unlocks', help: 'Credits only. The plan still grants cycle credits.' },
  { value: 'all', label: 'Every novel', help: 'All-you-can-read. Paid chapters open with no credit cost.' },
  { value: 'selected_novels', label: 'Selected novels', help: 'Unlimited, but only for the novels you list.' },
  {
    value: 'up_to_n_per_cycle',
    label: 'A set number per cycle',
    help: 'The subscriber claims each one deliberately. Unused unlocks do not roll over.',
  },
];

const PlanForm = ({ plan, onSave, onCancel, onDelete }) => {
  const [draft, setDraft] = useState(plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key, numeric = false) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setDraft((prev) => ({ ...prev, [key]: numeric ? Number(raw) : raw }));
  };

  const setPerk = (key, numeric = false) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setDraft((prev) => ({ ...prev, perks: { ...prev.perks, [key]: numeric ? Number(raw) : raw } }));
  };

  const perks = draft.perks || {};
  const months = draft.interval === 'year' ? 12 : 1;
  const perMonth = Math.round((Number(draft.priceUsdCents) || 0) / months);
  const mode = FREE_UNLOCK_MODES.find((m) => m.value === perks.freeUnlocks);

  // A live plan cannot be repriced in PayPal, so the form says so before the
  // save rather than after.
  const repricing = plan._id && plan.paypalPlanId && Number(draft.priceUsdCents) !== plan.pricedAtUsdCents;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Could not save this plan');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-crimson/40 bg-night-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Name</span>
          <input className={field} value={draft.name} onChange={set('name')} placeholder="Gold" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Tier key</span>
          <input className={field} value={draft.tier} onChange={set('tier')} placeholder="gold" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-silver-muted">Description</span>
          <input className={field} value={draft.description || ''} onChange={set('description')} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Price (USD)</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className={field}
            value={(Number(draft.priceUsdCents) || 0) / 100}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, priceUsdCents: Math.round(Number(event.target.value) * 100) }))
            }
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Billed every</span>
          <select className={field} value={draft.interval} onChange={set('interval')}>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Free trial</span>
          <input type="number" min="0" className={field} value={draft.trialDays} onChange={set('trialDays', true)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Credits each cycle</span>
          <input
            type="number"
            min="0"
            className={field}
            value={draft.monthlyCredits}
            onChange={set('monthlyCredits', true)}
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-silver-muted">
        Effectively {usd(perMonth)}/month
        {draft.trialDays > 0 ? `, after a ${draft.trialDays}-day free trial` : ''}.
      </p>

      <div className="mt-5 border-t border-line pt-4">
        <h4 className="mb-3 text-sm font-semibold text-silver">Perks</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-silver-muted">Free chapter unlocks</span>
            <select className={field} value={perks.freeUnlocks || 'none'} onChange={setPerk('freeUnlocks')}>
              {FREE_UNLOCK_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {mode && <span className="mt-1 block text-xs text-silver-muted">{mode.help}</span>}
          </label>

          {perks.freeUnlocks === 'up_to_n_per_cycle' && (
            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">Unlocks per cycle</span>
              <input
                type="number"
                min="1"
                className={field}
                value={perks.freeUnlockLimit || 0}
                onChange={setPerk('freeUnlockLimit', true)}
              />
            </label>
          )}
          {perks.freeUnlocks === 'selected_novels' && (
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-silver-muted">Novel IDs (one per line)</span>
              <textarea
                rows={3}
                className={field}
                value={(perks.freeUnlockNovels || []).join('\n')}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    perks: {
                      ...prev.perks,
                      freeUnlockNovels: event.target.value.split('\n').map((v) => v.trim()).filter(Boolean),
                    },
                  }))
                }
              />
            </label>
          )}

          <label className="text-sm">
            <span className="mb-1 block text-silver-muted">Chapter discount (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              className={field}
              value={perks.chapterDiscountPct || 0}
              onChange={setPerk('chapterDiscountPct', true)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-silver-muted">Credit pack discount (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              className={field}
              value={perks.packDiscountPct || 0}
              onChange={setPerk('packDiscountPct', true)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-silver-muted">Early access (hours sooner)</span>
            <input
              type="number"
              min="0"
              className={field}
              value={perks.earlyAccessHours || 0}
              onChange={setPerk('earlyAccessHours', true)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-silver-muted">Profile badge</span>
            <input className={field} value={perks.profileBadge || ''} onChange={setPerk('profileBadge')} />
          </label>
          <label className="flex items-center gap-2 text-sm text-silver">
            <input type="checkbox" checked={Boolean(perks.adFree)} onChange={setPerk('adFree')} />
            Ad-free reading
          </label>
          <label className="flex items-center gap-2 text-sm text-silver">
            <input type="checkbox" checked={Boolean(draft.active)} onChange={set('active')} />
            Visible in the store
          </label>
        </div>
      </div>

      {repricing && (
        <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            PayPal cannot change the price of a live plan. Saving and syncing creates a replacement plan for new
            subscribers — everyone already subscribed keeps paying {usd(plan.pricedAtUsdCents)} until they resubscribe.
          </span>
        </p>
      )}

      {error && <p className="mt-3 text-sm text-crimson">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Save size={16} /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-silver"
        >
          <X size={16} /> Cancel
        </button>
        {plan._id && (
          <button
            type="button"
            onClick={() => onDelete(plan)}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-crimson/50 px-4 py-2 text-sm text-crimson"
          >
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>
    </div>
  );
};

const PlansAdmin = () => {
  const [plans, setPlans] = useState([]);
  const [summary, setSummary] = useState(null);
  const [paypalConfigured, setPaypalConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [planData, summaryData] = await Promise.all([
        getPlans(),
        getSubscriptionSummary().catch(() => null),
      ]);
      setPlans(planData.plans || []);
      setPaypalConfigured(planData.paypalConfigured !== false);
      setSummary(summaryData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (draft) => {
    const result = draft._id ? await updatePlan(draft._id, draft) : await createPlan(draft);
    setEditing(null);
    setNotice(result.warning || '');
    await load();
  };

  const sync = async (plan) => {
    setError('');
    setNotice('');
    try {
      const result = await syncPlan(plan._id);
      setNotice(result.notes?.length ? result.notes.join(' ') : `${plan.name} is in sync with PayPal.`);
      await load();
    } catch (syncError) {
      setError(syncError.response?.data?.message || 'Sync failed');
    }
  };

  const remove = async (plan) => {
    setError('');
    try {
      await deletePlan(plan._id);
      setEditing(null);
      await load();
    } catch (deleteError) {
      setError(deleteError.response?.data?.message || 'Could not delete this plan');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-silver">Subscription plans</h1>
          <p className="text-sm text-silver-muted">
            Recurring tiers. Each one is mirrored into PayPal as a billing plan before readers can subscribe.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...BLANK, perks: { ...BLANK.perks } })}
          className="inline-flex items-center gap-2 rounded-lg bg-crimson px-4 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} /> New plan
        </button>
      </header>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Subscribers', value: summary.subscribers },
            { label: 'MRR', value: usd(summary.mrrUsdCents) },
            { label: 'Annualised', value: usd(summary.arrUsdCents) },
            { label: 'Past due', value: summary.pastDue },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-night-surface p-4">
              <p className="text-xs uppercase tracking-wide text-silver-muted">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-silver">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {!paypalConfigured && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          PayPal is not configured, so plans cannot be synced or sold yet. Add credentials under Settings → Payments.
        </p>
      )}
      {notice && <p className="rounded-lg border border-line bg-night-surface p-3 text-sm text-silver">{notice}</p>}
      {error && <p className="rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson">{error}</p>}

      {editing && (
        <PlanForm plan={editing} onSave={save} onCancel={() => setEditing(null)} onDelete={remove} />
      )}

      <div className="space-y-3">
        {plans.map((plan) => (
          <div
            key={plan._id}
            className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-night-surface p-4"
          >
            <div className="min-w-[12rem] flex-1">
              <p className="font-medium text-silver">
                {plan.name}
                {!plan.active && <span className="ml-2 text-xs text-silver-muted">(hidden)</span>}
              </p>
              <p className="text-sm text-silver-muted">
                {usd(plan.priceUsdCents)}/{plan.interval} · {plan.monthlyCredits} credits
                {plan.perks?.freeUnlocks && plan.perks.freeUnlocks !== 'none'
                  ? ` · ${FREE_UNLOCK_MODES.find((m) => m.value === plan.perks.freeUnlocks)?.label.toLowerCase()}`
                  : ''}
              </p>
            </div>

            <div className="flex items-center gap-1 text-sm text-silver-muted">
              <Users size={14} /> {plan.subscribers}
            </div>

            {plan.needsResync ? (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-200">
                {plan.paypalPlanId ? 'Price changed — resync' : 'Not on PayPal'}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">Synced</span>
            )}

            <button
              type="button"
              onClick={() => sync(plan)}
              disabled={!paypalConfigured}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-silver disabled:opacity-40"
            >
              <RefreshCw size={14} /> Sync
            </button>
            <button
              type="button"
              onClick={() => setEditing({ ...plan, perks: { ...BLANK.perks, ...(plan.perks || {}) } })}
              className="rounded-lg border border-line px-3 py-2 text-sm text-silver"
            >
              Edit
            </button>
          </div>
        ))}

        {!plans.length && !editing && (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-silver-muted">
            No plans yet. Create one, then sync it to PayPal to start selling.
          </p>
        )}
      </div>
    </div>
  );
};

export default PlansAdmin;

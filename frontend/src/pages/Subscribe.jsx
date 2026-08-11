import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  getPlans,
  subscribe,
  confirmSubscription,
  cancelSubscription,
} from '../api/monetization';
import { useAuth } from '../context/AuthContext';
import { useMonetization } from '../context/MonetizationContext';
import Spinner from '../components/Spinner';

const usd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

// Survives the redirect to PayPal and back.
const STASH_KEY = 'novelhub:pendingSubscription';

/** Human summary of a plan's perks — the reason someone would pay. */
const perkLines = (plan, creditLabel) => {
  const perks = plan.perks || {};
  const lines = [];

  if (plan.monthlyCredits > 0) {
    lines.push(`${plan.monthlyCredits.toLocaleString()} ${creditLabel} every ${plan.interval}`);
  }
  if (perks.freeUnlocks === 'all') lines.push('Every paid chapter, unlocked');
  if (perks.freeUnlocks === 'selected_novels') lines.push('Unlimited reading on selected novels');
  if (perks.freeUnlocks === 'up_to_n_per_cycle' && perks.freeUnlockLimit) {
    lines.push(`${perks.freeUnlockLimit} free chapter unlocks each ${plan.interval}`);
  }
  if (perks.chapterDiscountPct > 0) lines.push(`${perks.chapterDiscountPct}% off every chapter`);
  if (perks.packDiscountPct > 0) lines.push(`${perks.packDiscountPct}% off credit packs`);
  if (perks.earlyAccessHours > 0) lines.push(`Read new chapters ${perks.earlyAccessHours}h early`);
  if (perks.adFree) lines.push('Ad-free reading');
  if (perks.profileBadge) lines.push(`${perks.profileBadge} badge on your profile`);

  return lines;
};

const PlanCard = ({ plan, creditLabel, current, busy, onChoose }) => {
  const lines = perkLines(plan, creditLabel);
  const isCurrent = current?.plan?.id === plan.id;

  return (
    <div
      className={`flex flex-col rounded-2xl border p-6 ${
        isCurrent ? 'border-crimson bg-crimson/5' : 'border-line bg-night-surface'
      }`}
    >
      <h3 className="text-lg font-semibold text-silver">{plan.name}</h3>
      {plan.description && <p className="mt-1 text-sm text-silver-muted">{plan.description}</p>}

      <p className="mt-4">
        <span className="text-3xl font-semibold text-silver">{usd(plan.priceUsdCents)}</span>
        <span className="text-sm text-silver-muted">/{plan.interval}</span>
      </p>
      {plan.trialDays > 0 && (
        <p className="mt-1 text-sm text-emerald-300">{plan.trialDays} days free, then billed automatically</p>
      )}

      <ul className="mt-5 flex-1 space-y-2 text-sm text-silver">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-crimson" />
            {line}
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy || isCurrent}
        onClick={() => onChoose(plan)}
        className="mt-6 rounded-lg bg-crimson px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isCurrent ? 'Your current plan' : `Subscribe for ${usd(plan.priceUsdCents)}`}
      </button>
    </div>
  );
};

const Subscribe = () => {
  const { user } = useAuth();
  const { labelPlural, subscriptionHeading } = useMonetization();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await getPlans();
      setData(result);
      setStatus({ state: 'ready' });
    } catch {
      setStatus({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Pick up a subscription the reader has just approved.
   *
   * Our own id is put in the return URL when we build it, and mirrored into
   * sessionStorage in case PayPal drops the query string. Either source is
   * enough; confirming twice is harmless because the grant is cycle-keyed.
   */
  useEffect(() => {
    const pendingId = params.get('sub') || sessionStorage.getItem(STASH_KEY);
    if (!pendingId) return undefined;

    let cancelled = false;
    sessionStorage.removeItem(STASH_KEY);

    (async () => {
      setBusy(true);
      try {
        const result = await confirmSubscription(pendingId);
        if (cancelled) return;
        setNotice(
          result.subscription?.entitled
            ? 'You are subscribed. Your credits have been added.'
            : 'PayPal is still processing your subscription. It will activate shortly.'
        );
        await load();
      } catch (confirmError) {
        if (!cancelled) setError(confirmError.response?.data?.message || 'Could not confirm your subscription');
      } finally {
        if (cancelled) return;
        setBusy(false);
        if (params.get('sub')) {
          params.delete('sub');
          setParams(params, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (plan) => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent('/subscribe')}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const origin = window.location.origin;
      const result = await subscribe({
        planId: plan.id,
        cancelUrl: `${origin}/subscribe`,
        // Placeholder replaced below, once the id exists.
        returnUrl: `${origin}/subscribe`,
      });
      if (!result.approveUrl) throw new Error('missing approval link');

      // Stash before navigating away — anything after the assignment may never
      // run, and losing the id means a paid subscription stuck as pending.
      sessionStorage.setItem(STASH_KEY, result.subscriptionId);
      window.location.href = result.approveUrl;
    } catch (subscribeError) {
      setError(subscribeError.response?.data?.message || 'Could not start your subscription');
      setBusy(false);
    }
  };

  const stopSubscription = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await cancelSubscription('');
      setNotice(result.message || 'Your subscription has been cancelled.');
      await load();
    } catch (cancelError) {
      setError(cancelError.response?.data?.message || 'Could not cancel');
    } finally {
      setBusy(false);
    }
  };

  if (status.state === 'loading') return <Spinner full />;
  if (status.state === 'error') {
    return <p className="p-8 text-center text-silver-muted">Could not load plans. Please try again.</p>;
  }

  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-xl font-semibold text-silver">Subscriptions are not available yet</h1>
        <p className="mt-2 text-sm text-silver-muted">
          You can still buy credits from the <Link to="/store" className="text-crimson">store</Link>.
        </p>
      </div>
    );
  }

  const current = data.current;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold text-silver">{subscriptionHeading}</h1>
        <p className="mt-1 text-sm text-silver-muted">
          A recurring plan is the cheapest way to read a lot. Cancel any time.
        </p>
      </header>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <CheckCircle2 size={16} /> {notice}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson">
          <AlertTriangle size={16} /> {error}
        </p>
      )}

      {current && (
        <div className="rounded-xl border border-line bg-night-surface p-5">
          <p className="text-sm text-silver">
            You are on <strong>{current.plan?.name}</strong>
            {current.status === 'past_due' && ' — payment failed, retrying'}
            {current.cancelAtPeriodEnd && ' — ending at the end of this period'}
          </p>
          {current.currentPeriodEnd && (
            <p className="mt-1 text-sm text-silver-muted">
              {current.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}{' '}
              {new Date(current.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
          {current.freeUnlocksRemaining > 0 && (
            <p className="mt-1 text-sm text-silver-muted">
              {current.freeUnlocksRemaining} free unlock{current.freeUnlocksRemaining === 1 ? '' : 's'} left this
              cycle
            </p>
          )}
          {!current.cancelAtPeriodEnd && (
            <button
              type="button"
              onClick={stopSubscription}
              disabled={busy}
              className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-silver-muted disabled:opacity-50"
            >
              Cancel subscription
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {data.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            creditLabel={(labelPlural || 'credits').toLowerCase()}
            current={current}
            busy={busy}
            onChoose={choose}
          />
        ))}
      </div>

      {!data.plans.length && (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-silver-muted">
          No plans are on sale right now.
        </p>
      )}
    </div>
  );
};

export default Subscribe;

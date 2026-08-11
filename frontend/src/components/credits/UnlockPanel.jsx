import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Lock, LogIn, Clock } from 'lucide-react';
import { unlockChapter } from '../../api/monetization';
import { useMonetization } from '../../context/MonetizationContext';
import { REDIRECT_PARAM } from '../../utils/readingGate';
import CreditAmount from './CreditAmount';
import BuyCreditsModal from '../store/BuyCreditsModal';

const formatWhen = (iso) => {
  if (!iso) return 'soon';
  const at = new Date(iso);
  const hours = Math.round((at.getTime() - Date.now()) / 3600000);
  if (hours <= 0) return 'shortly';
  if (hours < 24) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  return `on ${at.toDateString()}`;
};

/**
 * The credits branch of the chapter gate.
 *
 * Kept out of ChapterGate itself so the existing login and engagement branches
 * are untouched — this only renders when the server says the reason is credits
 * or early access.
 */
const UnlockPanel = ({ gate, novel, chapter, user, onUnlocked }) => {
  const { storeEnabled, applyBalance, refreshWallet } = useMonetization();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [buying, setBuying] = useState(false);
  // The balance the reader has *now*, which diverges from the gate's copy the
  // moment they top up without leaving the page.
  const [liveBalance, setLiveBalance] = useState(null);

  const redirect = `${REDIRECT_PARAM}=${encodeURIComponent(`/novel/${novel.slug}/chapter/${chapter.number}`)}`;

  if (gate.reason === 'early_access') {
    return (
      <div className="mt-5 rounded-xl border border-line bg-night p-4">
        <div className="flex items-center gap-2 text-sm text-silver">
          <Clock className="h-4 w-4 text-crimson-soft" aria-hidden="true" />
          Available {formatWhen(gate.availableAt)}
        </div>
        <p className="mt-2 text-xs text-silver-muted">
          This chapter is in its early-access window and is not on sale yet.
        </p>
      </div>
    );
  }

  const price = gate.priceCredits || 0;
  const balance = liveBalance ?? gate.balance ?? 0;
  const shortfall = Math.max(0, price - balance);
  const canAfford = balance >= price;

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await unlockChapter(novel.slug, chapter.number);
      // The response carries the new balance, so no refetch is needed.
      if (typeof result.balance === 'number') applyBalance(result.balance);
      else await refreshWallet();
      await onUnlocked();
    } catch (unlockError) {
      const status = unlockError.response?.status;
      setError(
        status === 402
          ? 'You do not have enough credits for this chapter.'
          : unlockError.response?.data?.message || 'Could not unlock this chapter. Please try again.'
      );
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-line bg-night p-4">
          <span className="text-sm text-silver-muted">This chapter costs</span>
          <span className="text-sm font-semibold text-silver">
            <CreditAmount value={price} />
          </span>
        </div>
        <p className="text-sm text-silver">Log in to unlock it — you will come straight back here.</p>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/login?${redirect}`}
            className="flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" /> Log in
          </Link>
          <Link
            to={`/signup?${redirect}`}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-silver transition-colors hover:border-crimson/60 hover:text-crimson-soft"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-line bg-night p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver-muted">This chapter costs</span>
          <span className="text-sm font-semibold text-silver">
            <CreditAmount value={price} />
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
          <span className="text-sm text-silver-muted">Your balance</span>
          <span className={`text-sm ${canAfford ? 'text-silver' : 'text-crimson-soft'}`}>
            <CreditAmount value={balance} />
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-crimson-soft">{error}</p>}

      {canAfford ? (
        <button
          type="button"
          onClick={unlock}
          disabled={busy}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-crimson px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Lock className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Unlocking...' : `Unlock for ${price}`}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-silver-muted">
            You need <CreditAmount value={shortfall} showIcon={false} /> more.
          </p>
          {storeEnabled ? (
            <button
              type="button"
              onClick={() => setBuying(true)}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-crimson px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
            >
              <Coins className="h-4 w-4" aria-hidden="true" /> Get credits
            </button>
          ) : (
            <p className="text-xs text-silver-muted">The store is closed at the moment.</p>
          )}
        </div>
      )}

      {/* Buying happens over the chapter rather than on another route, so the
          reader never loses their place. On success the balance updates here
          and the unlock button above becomes usable immediately. */}
      <BuyCreditsModal
        open={buying}
        onClose={() => setBuying(false)}
        shortfall={shortfall}
        reason="to unlock this chapter"
        onPurchased={(result) => {
          if (typeof result.balance === 'number') setLiveBalance(result.balance);
        }}
      />
    </div>
  );
};

export default UnlockPanel;

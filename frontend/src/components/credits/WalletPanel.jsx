import { useState, useEffect, useCallback } from 'react';
import { Coins, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { getTransactions, setAutoUnlock } from '../../api/monetization';
import { useMonetization } from '../../context/MonetizationContext';
import { formatRelativeTime } from '../../utils/dateUtils';
import CreditAmount from './CreditAmount';
import Pagination from '../Pagination';
import BuyCreditsModal from '../store/BuyCreditsModal';

const TYPE_LABEL = {
  purchase: 'Purchased',
  grant: 'Gift',
  spend: 'Unlocked',
  refund: 'Refund',
  expire: 'Expired',
  adjustment: 'Adjustment',
  reversal: 'Reversed',
  subscription_grant: 'Subscription',
  referral: 'Referral',
};

const WalletPanel = () => {
  const { enabled, storeEnabled, wallet, allowAutoUnlock, autoUnlockMaxCredits, refreshWallet } =
    useMonetization();
  const [history, setHistory] = useState({ transactions: [], page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [savingAuto, setSavingAuto] = useState(false);
  const [buying, setBuying] = useState(false);

  const load = useCallback(async () => {
    try {
      setHistory(await getTransactions({ page, limit: 10 }));
    } catch (error) {
      setHistory({ transactions: [], page: 1, pages: 1 });
    }
  }, [page]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  if (!enabled) return null;

  const toggleAuto = async (event) => {
    setSavingAuto(true);
    try {
      await setAutoUnlock({
        enabled: event.target.checked,
        maxPriceCredits: autoUnlockMaxCredits,
      });
      await refreshWallet();
    } finally {
      setSavingAuto(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-night-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-silver-muted">Your balance</p>
          <CreditAmount
            value={wallet ? wallet.balance : 0}
            className="mt-1 text-2xl font-bold text-silver"
            iconClass="h-6 w-6"
          />
        </div>
        {storeEnabled && (
          <button
            type="button"
            onClick={() => setBuying(true)}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
          >
            <Coins className="h-4 w-4" aria-hidden="true" /> Get credits
          </button>
        )}
      </div>

      {/* Same dialog as the paywall and the navbar, so the purchase behaves
          identically wherever it is started from. */}
      <BuyCreditsModal open={buying} onClose={() => setBuying(false)} onPurchased={refreshWallet} />

      {wallet && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
          <div>
            <p className="text-xs text-silver-muted">Purchased</p>
            <p className="text-sm text-silver">{(wallet.lifetimePurchased || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-silver-muted">Gifted</p>
            <p className="text-sm text-silver">{(wallet.lifetimeGranted || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-silver-muted">Spent</p>
            <p className="text-sm text-silver">{(wallet.lifetimeSpent || 0).toLocaleString()}</p>
          </div>
        </div>
      )}

      {allowAutoUnlock && (
        <label className="mt-4 flex cursor-pointer items-start gap-2 border-t border-line pt-4 text-sm text-silver-muted">
          <input
            type="checkbox"
            checked={Boolean(wallet?.autoUnlock?.enabled)}
            onChange={toggleAuto}
            disabled={savingAuto}
            className="mt-0.5"
          />
          <span>
            Unlock the next chapter automatically
            <span className="block text-xs">
              Only for chapters costing {autoUnlockMaxCredits} or less.
            </span>
          </span>
        </label>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-silver-muted">History</p>

        {history.transactions.length === 0 ? (
          <p className="text-sm text-silver-muted">Nothing here yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.transactions.map((row) => {
              const positive = row.amount > 0;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg bg-night px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-silver">
                      {row.description || TYPE_LABEL[row.type] || row.type}
                    </p>
                    <p className="text-xs text-silver-muted">
                      {formatRelativeTime(row.createdAt)}
                      {row.novel?.title ? ` · ${row.novel.title}` : ''}
                    </p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-sm tabular-nums ${
                      positive ? 'text-green-400' : 'text-silver-muted'
                    }`}
                  >
                    {positive ? (
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {positive ? '+' : ''}
                    {row.amount.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {history.pages > 1 && <Pagination page={page} pages={history.pages} onChange={setPage} />}
      </div>
    </section>
  );
};

export default WalletPanel;

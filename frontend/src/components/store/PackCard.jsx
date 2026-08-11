import { Info } from 'lucide-react';
import CreditAmount from '../credits/CreditAmount';

const formatMinor = (minor, decimals, symbol) => {
  const major = (minor / 10 ** decimals).toFixed(decimals);
  return `${symbol || ''}${major.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

const PackCard = ({ pack, selected, onSelect }) => {
  const price = pack.price || {};
  const bonus = pack.bonusCredits || 0;
  const usd = `$${(pack.priceUsdCents / 100).toFixed(2)}`;

  return (
    <button
      type="button"
      onClick={() => onSelect(pack)}
      className={`relative flex w-full cursor-pointer flex-col gap-3 rounded-2xl border p-5 text-left transition-colors ${
        selected
          ? 'border-crimson bg-crimson/10'
          : 'border-line bg-night-surface hover:border-crimson/60'
      }`}
    >
      {pack.badge && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-crimson px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          {pack.badge}
        </span>
      )}

      <div>
        <p className="font-display text-lg font-bold text-silver">{pack.name}</p>
        {pack.description && <p className="mt-0.5 text-xs text-silver-muted">{pack.description}</p>}
      </div>

      <div>
        <CreditAmount value={pack.totalCredits} className="text-xl font-semibold text-silver" iconClass="h-5 w-5" />
        {bonus > 0 && (
          <p className="mt-1 text-xs text-crimson-soft">
            {pack.credits.toLocaleString()} + {bonus.toLocaleString()} bonus
          </p>
        )}
      </div>

      <div className="mt-auto border-t border-line pt-3">
        <p className="text-lg font-semibold text-silver">
          {price.formatted || formatMinor(price.minor, price.decimals ?? 2, price.symbol)}
        </p>
        {/* Showing a local figure and charging a different one is the top
            source of payment support tickets, so the difference is stated. */}
        {pack.isEstimate && (
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-silver-muted">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              Approximate. Charged as {usd} — your bank&apos;s rate may differ slightly.
            </span>
          </p>
        )}
      </div>
    </button>
  );
};

export default PackCard;

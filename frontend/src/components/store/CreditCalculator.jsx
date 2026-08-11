import { useState } from 'react';
import { useMonetization } from '../../context/MonetizationContext';
import CreditAmount from '../credits/CreditAmount';

/**
 * "What do I get for X" — a pure function of credits.perUsd, so it stays
 * correct when an admin changes the rate.
 */
const CreditCalculator = () => {
  const { creditsPerUsd, showCalculator } = useMonetization();
  const [usd, setUsd] = useState(10);

  if (!showCalculator) return null;

  const amount = Number(usd) || 0;
  const credits = Math.floor(amount * creditsPerUsd);

  return (
    <div className="rounded-2xl border border-line bg-night-surface p-5">
      <p className="text-sm font-semibold text-silver">Credit calculator</p>
      <p className="mt-1 text-xs text-silver-muted">
        $1 is <CreditAmount value={creditsPerUsd} showIcon={false} />. Bonus credits in the packs above
        make the effective rate better.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-night px-3 py-2">
          <span className="text-sm text-silver-muted">$</span>
          <input
            type="number"
            min="0"
            step="1"
            value={usd}
            onChange={(event) => setUsd(event.target.value)}
            aria-label="Amount in US dollars"
            className="w-20 bg-transparent text-sm text-silver focus:outline-none"
          />
        </div>
        <span className="text-silver-muted">=</span>
        <CreditAmount value={credits} className="text-sm font-semibold text-silver" />
      </div>
    </div>
  );
};

export default CreditCalculator;

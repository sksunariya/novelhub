import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMonetization } from '../../context/MonetizationContext';
import CreditAmount from './CreditAmount';
import BuyCreditsModal from '../store/BuyCreditsModal';

/**
 * Navbar balance chip.
 *
 * Renders nothing when monetization is off, so a free site shows no trace of
 * the credit system rather than an empty wallet.
 *
 * Clicking opens the buy dialog rather than navigating: topping up is a thing
 * you do *while* doing something else, and taking someone out of what they
 * were reading to do it is how a top-up turns into an abandoned session. The
 * /store route still exists for browsing packs deliberately.
 */
const CreditBalance = ({ compact = false }) => {
  const { enabled, storeEnabled, wallet, isLow } = useMonetization();
  const [buying, setBuying] = useState(false);

  if (!enabled || !wallet) return null;

  const className = `flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
    isLow
      ? 'border-crimson/50 bg-crimson/10 text-crimson-soft hover:bg-crimson/20'
      : 'border-line text-silver hover:border-crimson/60 hover:text-crimson-soft'
  }`;

  // With the store closed there is nothing to open, so the chip stays a link to
  // the wallet rather than a button that does nothing useful.
  if (!storeEnabled) {
    return (
      <Link to="/profile" title="Your balance" className={className}>
        <CreditAmount value={wallet.balance} showLabel={!compact} />
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setBuying(true)} title="Get more credits" className={`cursor-pointer ${className}`}>
        <CreditAmount value={wallet.balance} showLabel={!compact} />
      </button>
      <BuyCreditsModal open={buying} onClose={() => setBuying(false)} />
    </>
  );
};

export default CreditBalance;

import { Coins } from 'lucide-react';
import { useMonetization } from '../../context/MonetizationContext';

/**
 * Every credit figure in the app renders through this.
 *
 * The label comes from settings, so renaming credits to "gems" in the admin
 * portal changes every price on the site without a deploy or a find-and-replace.
 */
const CreditAmount = ({ value = 0, showIcon = true, showLabel = true, className = '', iconClass = 'h-4 w-4' }) => {
  const { label } = useMonetization();
  const amount = Number(value) || 0;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {showIcon && <Coins className={`${iconClass} shrink-0 text-crimson-soft`} aria-hidden="true" />}
      <span className="tabular-nums">{amount.toLocaleString()}</span>
      {showLabel && <span>{label(amount).toLowerCase()}</span>}
    </span>
  );
};

export default CreditAmount;

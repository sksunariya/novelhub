import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, AlertTriangle, ChevronDown } from 'lucide-react';
import { getPaymentReadiness } from '../api/adminConfig';

/**
 * Can a reader actually buy and spend credits right now?
 *
 * Five things have to line up, and when one is missing the reader sees a
 * different vague message — "the store is closed", "no packs on sale",
 * "payments are not set up" — none of which reaches the admin. Working out
 * which of the five it was meant guessing. This says it outright.
 *
 * Hidden entirely once everything passes, so a working setup costs no space.
 */
const PaymentReadiness = () => {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getPaymentReadiness()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const warnings = data.checks.filter((check) => !check.ok && check.warnOnly);
  if (data.ready && !warnings.length) return null;

  const rows = expanded ? data.checks : data.checks.filter((check) => !check.ok);

  return (
    <section
      className={`mb-6 rounded-xl border p-4 ${
        data.blockers ? 'border-crimson/40 bg-crimson/5' : 'border-amber-500/40 bg-amber-500/5'
      }`}
      aria-label="Payment setup status"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-silver">
            {data.blockers
              ? `Readers cannot buy credits yet — ${data.blockers} thing${data.blockers === 1 ? '' : 's'} left`
              : 'Payments work, with one caveat'}
          </p>
          <p className="mt-0.5 text-xs text-silver-muted">
            {data.blockers
              ? 'Each of these silently changes what a reader sees.'
              : 'Nothing is blocking a purchase.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="flex cursor-pointer items-center gap-1 text-xs text-silver-muted transition-colors hover:text-silver"
        >
          {expanded ? 'Show only problems' : 'Show all checks'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((check) => {
          const Icon = check.ok ? Check : check.warnOnly ? AlertTriangle : X;
          const tone = check.ok ? 'text-emerald-400' : check.warnOnly ? 'text-amber-300' : 'text-crimson-soft';
          return (
            <li key={check.key} className="flex items-start gap-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
              <div className="min-w-0">
                <span className="text-silver">{check.label}</span>
                {!check.ok && <span className="text-silver-muted"> — {check.fix}</span>}
                <p className="text-xs text-silver-muted">{check.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Link to="/admin/config" className="rounded-full border border-line px-3 py-1.5 text-silver hover:border-crimson/60">
          Settings
        </Link>
        <Link to="/admin/packs" className="rounded-full border border-line px-3 py-1.5 text-silver hover:border-crimson/60">
          Credit packs
        </Link>
        <Link to="/admin/novels" className="rounded-full border border-line px-3 py-1.5 text-silver hover:border-crimson/60">
          Novels
        </Link>
      </div>
    </section>
  );
};

export default PaymentReadiness;

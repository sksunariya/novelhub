import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import useCreditPurchase from './useCreditPurchase';
import PackCard from './PackCard';
import CreditAmount from '../credits/CreditAmount';
import Spinner from '../Spinner';
import { useMonetization } from '../../context/MonetizationContext';

/**
 * Buying credits without leaving the page.
 *
 * The reader hits a paywall at the exact moment they most want to keep
 * reading. Sending them to another route to pay, then asking them to navigate
 * back, spends that intent on wayfinding. This keeps them where they are: the
 * chapter stays behind the dialog and the unlock button is live the moment the
 * balance updates.
 *
 * `shortfall` lets the caller say how many credits are missing, so the pack
 * that actually solves the reader's problem can be pre-selected instead of
 * making them work it out.
 */
const BuyCreditsModal = ({ open, onClose, shortfall = 0, reason = '', onPurchased }) => {
  const { requireTerms, refundPolicy } = useMonetization();
  // Loading is deferred until the dialog is actually opened. This component
  // mounts on every page that shows a balance, and fetching eagerly would cost
  // two API calls per page view for a dialog nobody has opened.
  const purchase = useCreditPurchase({ onPurchased, enabled: open });
  const [accepted, setAccepted] = useState(false);
  const dialogRef = useRef(null);
  const preselected = useRef(false);

  const { config, packs, currency, selected, status, setSelected, paypalClientId } = purchase;

  // Pre-select the cheapest pack that actually covers the shortfall. Choosing
  // for the reader here is a kindness, not a dark pattern: it is the smallest
  // pack that solves the problem, not the largest.
  useEffect(() => {
    if (!open || preselected.current || !packs.length) return;
    preselected.current = true;
    if (!shortfall) return;
    const sufficient = packs
      .filter((pack) => pack.totalCredits >= shortfall)
      .sort((a, b) => a.priceUsdCents - b.priceUsdCents);
    setSelected(sufficient[0] || packs[packs.length - 1]);
  }, [open, packs, shortfall, setSelected]);

  // Reopening must show packs, not the last purchase. The component stays
  // mounted while closed, so without this a reader who buys once sees the
  // "Credits added" screen every subsequent time they open the dialog.
  useEffect(() => {
    if (open) {
      if (status.state === 'done' || status.state === 'error') purchase.reset();
      return;
    }
    preselected.current = false;
    // Acceptance is per purchase, not per session — carrying a tick over to the
    // next one would defeat the point of asking.
    setAccepted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes, and the page behind must not scroll under the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // When the admin requires explicit acceptance, it is required here too. The
  // store page asks for a tick; a dialog that skips it would make the setting
  // depend on which door the reader came through.
  const canCheckout = Boolean(selected) && purchase.storeOpen && (!requireTerms || accepted);

  const body = () => {
    if (status.state === 'loading') return <Spinner />;

    if (config && !config.enabled) {
      return (
        <div className="py-10 text-center">
          <p className="text-sm text-silver-muted">Credits are not on sale at the moment.</p>
        </div>
      );
    }

    if (status.state === 'done') {
      return (
        <div className="py-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" aria-hidden="true" />
          <h3 className="mt-4 font-display text-xl font-bold text-silver">Credits added</h3>
          <p className="mt-2 text-sm text-silver-muted">
            <CreditAmount value={status.credits} showIcon={false} /> added. Your balance is{' '}
            <CreditAmount value={status.balance} showIcon={false} />.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 cursor-pointer rounded-full bg-crimson px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
          >
            Keep reading
          </button>
        </div>
      );
    }

    return (
      <>
        {config?.readOnly && (
          // Without this the PayPal buttons are simply dimmed with no reason
          // given, which reads as the site being broken rather than paused.
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crimson-soft" aria-hidden="true" />
            <span>Purchases are paused for maintenance. Please check back shortly.</span>
          </p>
        )}

        {shortfall > 0 && (
          <p className="mb-4 rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver-muted">
            You need <CreditAmount value={shortfall} showIcon={false} className="text-silver" /> more
            {reason ? ` ${reason}` : ''}.
          </p>
        )}

        {config?.currencies?.length > 1 && (
          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-xs text-silver-muted">Currency</span>
            <select
              value={currency}
              onChange={(event) => purchase.changeCurrency(event.target.value)}
              className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            >
              {config.currencies.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.code} {entry.symbol ? `(${entry.symbol})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} selected={selected?.id === pack.id} onSelect={setSelected} />
          ))}
        </div>

        {!packs.length && (
          <p className="py-8 text-center text-sm text-silver-muted">No credit packs are on sale right now.</p>
        )}

        {status.state === 'error' && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson-soft">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{status.message}</span>
          </p>
        )}

        {requireTerms && (
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-silver-muted">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              I understand credits are used to unlock chapters and are not redeemable for cash.
              {refundPolicy && <span className="mt-1 block">{refundPolicy}</span>}
            </span>
          </label>
        )}

        <div className={`mt-4 ${canCheckout ? '' : 'pointer-events-none opacity-40'}`}>
          {paypalClientId ? (
            <PayPalScriptProvider
              key={`${paypalClientId}:${selected?.chargedIn || 'USD'}`}
              options={{ clientId: paypalClientId, currency: selected?.chargedIn || 'USD' }}
            >
              <PayPalButtons
                style={{ layout: 'vertical', shape: 'pill' }}
                disabled={!canCheckout}
                // Without this the buttons keep the callbacks captured on first
                // mount and would buy the pack first clicked, not the one
                // finally chosen.
                forceReRender={[selected?.id, currency, canCheckout]}
                createOrder={purchase.startOrder}
                onApprove={purchase.finishOrder}
                onError={() => purchase.failPayment()}
                onCancel={purchase.cancelPayment}
              />
            </PayPalScriptProvider>
          ) : (
            <p className="text-xs text-silver-muted">
              Payments are not set up yet. Please try again later.
            </p>
          )}
        </div>

        {selected && (
          <p className="mt-3 text-center text-xs text-silver-muted">
            <CreditAmount value={selected.totalCredits} showIcon={false} /> for {selected.price?.formatted}
            {selected.isEstimate && ` (charged as $${(selected.priceUsdCents / 100).toFixed(2)})`}
          </p>
        )}
      </>
    );
  };

  // Rendered in a portal so the dialog is never clipped by the reader's
  // overflow or transform containers.
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.97, opacity: 0 }}
          transition={{ duration: 0.18 }}
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Buy credits"
          className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-night-raised outline-none"
        >
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="font-display text-lg font-bold text-silver">Get credits</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:text-silver"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">{body()}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default BuyCreditsModal;

import { useEffect, useRef, useState } from 'react';
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js';
import { AlertTriangle, CreditCard, Lock } from 'lucide-react';
import CreditAmount from '../credits/CreditAmount';

/**
 * The checkout block shared by the store page and the buy-credits dialog:
 * what is being bought, the PayPal buttons, and a line on how payment works.
 *
 * The white slab this replaces: PayPal renders its buttons in an iframe with
 * a light colour scheme, the site declares `color-scheme: dark`, and when the
 * two disagree the browser paints an opaque white backdrop behind the iframe.
 * The card sets `color-scheme: light` on the iframe's container so the
 * iframe is transparent and the buttons sit on the site's own theme colours.
 *
 * One exception. "Debit or Credit Card" expands PayPal's card form inside the
 * same iframe, and that form is dark text drawn for a light page — on the
 * theme it would be unreadable. The iframe grows when it opens, so the card
 * watches its own height and switches to a light surface while the form is
 * showing, then back once it closes.
 */

// Two stacked buttons plus PayPal's "Powered by" line come to about 150px.
// The card form is several times that, so anything past this is the form.
const EXPANDED_AT = 220;

const BUTTON_HEIGHT = 44;

/** Placeholder pills while the PayPal SDK loads, so the card doesn't jump. */
const ButtonsSkeleton = () => (
  <div className="space-y-3" aria-hidden="true">
    <div className="h-11 animate-pulse rounded-full bg-[#f5c556]/40" />
    <div className="h-11 animate-pulse rounded-full bg-silver/10" />
  </div>
);

const Buttons = ({ purchase, canCheckout, selected, currency }) => {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();

  if (isRejected) {
    return (
      <p className="flex items-start gap-2 text-sm text-silver-muted">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        PayPal could not be loaded. Check your connection or disable any blocker for this site, then reload.
      </p>
    );
  }

  return (
    <>
      {isPending && <ButtonsSkeleton />}
      <div className={isPending ? 'hidden' : ''}>
        <PayPalButtons
          style={{ layout: 'vertical', shape: 'pill', color: 'gold', label: 'pay', height: BUTTON_HEIGHT }}
          disabled={!canCheckout}
          // Without this the buttons keep the callbacks captured on first
          // mount and would create an order for the pack the reader first
          // clicked, not the one they finally chose.
          forceReRender={[selected?.id, currency, canCheckout]}
          createOrder={purchase.startOrder}
          onApprove={purchase.finishOrder}
          onError={() => purchase.failPayment()}
          onCancel={purchase.cancelPayment}
        />
      </div>
    </>
  );
};

const PayPalCheckout = ({ purchase, canCheckout, blockedReason = '', notConfiguredMessage }) => {
  const { selected, currency, paypalClientId } = purchase;
  const innerRef = useRef(null);
  const [cardFormOpen, setCardFormOpen] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setCardFormOpen(entry.contentRect.height > EXPANDED_AT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [paypalClientId]);

  return (
    <div>
      {/* Order summary: the one line a buyer checks before paying. */}
      {selected ? (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-night/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-silver-muted">You get</p>
            <CreditAmount value={selected.totalCredits} className="mt-0.5 text-lg font-bold text-silver" iconClass="h-5 w-5" />
            {selected.bonusCredits > 0 && (
              <p className="text-xs text-crimson-soft">
                {selected.credits.toLocaleString()} + {selected.bonusCredits.toLocaleString()} bonus
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-silver-muted">You pay</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-silver">{selected.price?.formatted}</p>
            {selected.isEstimate && (
              <p className="text-xs text-silver-muted">charged as ${(selected.priceUsdCents / 100).toFixed(2)}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-center text-sm text-silver-muted">
          Choose a pack to continue.
        </p>
      )}

      {paypalClientId ? (
        <div className="relative mt-4">
          <div
            className={`rounded-2xl border p-4 transition-[background-color,border-color,opacity] duration-300 ${
              cardFormOpen ? 'border-transparent bg-white' : 'border-line bg-night/60'
            } ${canCheckout ? '' : 'pointer-events-none opacity-50'}`}
            style={{ colorScheme: 'light' }}
          >
            <div ref={innerRef}>
            <PayPalScriptProvider
              // The SDK is loaded per currency, so switching settlement
              // currency needs a fresh provider rather than new props.
              key={`${paypalClientId}:${selected?.chargedIn || 'USD'}`}
              options={{
                clientId: paypalClientId,
                currency: selected?.chargedIn || 'USD',
                intent: 'capture',
                'enable-funding': 'card,paylater,venmo',
              }}
            >
              <Buttons purchase={purchase} canCheckout={canCheckout} selected={selected} currency={currency} />
            </PayPalScriptProvider>
            </div>
          </div>
          {/* Dimmed buttons with no explanation read as a broken page. */}
          {!canCheckout && blockedReason && selected && (
            <p className="mt-2 text-center text-xs font-medium text-crimson-soft">{blockedReason}</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-xs text-silver-muted">{notConfiguredMessage || 'Payments are not set up yet. Please try again later.'}</p>
      )}

      <div className="mt-3 flex flex-col items-center gap-1 text-center text-[11px] leading-relaxed text-silver-muted">
        <p className="flex items-center gap-1.5">
          <Lock className="h-3 w-3" aria-hidden="true" /> Secure payment through PayPal
        </p>
        <p className="flex items-center gap-1.5">
          <CreditCard className="h-3 w-3" aria-hidden="true" /> Pay by card without a PayPal account
        </p>
      </div>
    </div>
  );
};

export default PayPalCheckout;

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMonetization } from '../context/MonetizationContext';
import Spinner from '../components/Spinner';
import PackCard from '../components/store/PackCard';
import CreditCalculator from '../components/store/CreditCalculator';
import useCreditPurchase from '../components/store/useCreditPurchase';
import CreditAmount from '../components/credits/CreditAmount';

const Store = () => {
  const { user } = useAuth();
  const { storeHeading, storeSubheading, requireTerms, refundPolicy, subscriptionsEnabled } =
    useMonetization();
  const navigate = useNavigate();

  const [accepted, setAccepted] = useState(false);

  // The order lifecycle lives in a hook shared with BuyCreditsModal, so the
  // page and the dialog cannot drift into behaving differently.
  const purchase = useCreditPurchase();
  const { config, packs, currency, selected, status, setSelected, changeCurrency } = purchase;

  if (status.state === 'loading') return <Spinner />;

  if (config && !config.enabled) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">The store is closed</h1>
        <p className="mt-2 text-sm text-silver-muted">Credits are not on sale at the moment.</p>
        <Link to="/" className="mt-6 inline-block text-sm text-crimson-soft hover:underline">
          Back to browsing
        </Link>
      </div>
    );
  }

  if (status.state === 'done') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" aria-hidden="true" />
        <h1 className="mt-4 font-display text-2xl font-bold text-silver">Credits added</h1>
        <p className="mt-2 text-sm text-silver-muted">
          <CreditAmount value={status.credits} showIcon={false} /> are now in your account. Your balance is{' '}
          <CreditAmount value={status.balance} showIcon={false} />.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white hover:bg-crimson-soft"
          >
            Back to reading
          </button>
          <Link
            to="/profile"
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-silver hover:border-crimson/60"
          >
            View balance
          </Link>
        </div>
      </div>
    );
  }

  const canCheckout = Boolean(selected) && (!requireTerms || accepted) && !config?.readOnly;
  const { paypalClientId } = purchase;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-display text-2xl font-bold text-silver">{storeHeading}</h1>
        {storeSubheading && <p className="mt-1 text-sm text-silver-muted">{storeSubheading}</p>}
        {/* Heavy readers are better off subscribing; hiding that would be selling
            them the worse deal on purpose. */}
        {subscriptionsEnabled && (
          <p className="mt-3 text-sm text-silver-muted">
            Reading a lot?{' '}
            <Link to="/subscribe" className="text-crimson hover:underline">
              A subscription works out cheaper
            </Link>
            .
          </p>
        )}
      </header>

      {config?.readOnly && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-line bg-night-surface p-4 text-sm text-silver-muted">
          <AlertTriangle className="h-4 w-4 text-crimson-soft" aria-hidden="true" />
          Purchases are paused for maintenance. Please check back shortly.
        </div>
      )}

      {config?.currencies?.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs text-silver-muted">Show prices in</span>
          {config.currencies.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => changeCurrency(option.code)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                currency === option.code
                  ? 'border-crimson bg-crimson/15 text-crimson-soft'
                  : 'border-line text-silver-muted hover:text-silver'
              }`}
            >
              {option.symbol} {option.code}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {packs.map((pack) => (
          <PackCard key={pack.id} pack={pack} selected={selected?.id === pack.id} onSelect={setSelected} />
        ))}
      </div>

      {packs.length === 0 && (
        <p className="rounded-xl border border-line bg-night-surface p-6 text-center text-sm text-silver-muted">
          No credit packs are available right now.
        </p>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <CreditCalculator />

        <div className="rounded-2xl border border-line bg-night-surface p-5">
          <p className="text-sm font-semibold text-silver">Checkout</p>

          {!user ? (
            <p className="mt-3 text-sm text-silver-muted">
              <Link to="/login?redirect=/store" className="text-crimson-soft hover:underline">
                Log in
              </Link>{' '}
              to buy credits.
            </p>
          ) : (
            <>
              {requireTerms && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-silver-muted">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I understand credits are used to unlock chapters and are not redeemable for cash.
                    {refundPolicy && <span className="block mt-1">{refundPolicy}</span>}
                  </span>
                </label>
              )}

              {status.state === 'error' && (
                <p className="mt-3 text-sm text-crimson-soft">{status.message}</p>
              )}

              <div className={`mt-4 ${canCheckout ? '' : 'pointer-events-none opacity-40'}`}>
                {paypalClientId ? (
                  <PayPalScriptProvider
                    // The SDK is loaded per currency, so switching settlement
                    // currency needs a fresh provider rather than new props.
                    key={`${paypalClientId}:${selected?.chargedIn || 'USD'}`}
                    options={{ clientId: paypalClientId, currency: selected?.chargedIn || 'USD' }}
                  >
                    <PayPalButtons
                      style={{ layout: 'vertical', shape: 'pill' }}
                      disabled={!canCheckout}
                      // Without this the buttons keep the callbacks captured on
                      // first mount and would create an order for the pack the
                      // reader first clicked, not the one they finally chose.
                      forceReRender={[selected?.id, currency, canCheckout]}
                      createOrder={purchase.startOrder}
                      onApprove={purchase.finishOrder}
                      onError={() => purchase.failPayment()}
                      onCancel={purchase.cancelPayment}
                    />
                  </PayPalScriptProvider>
                ) : (
                  <p className="text-xs text-silver-muted">
                    Payments are not set up yet. An admin needs to add PayPal credentials under
                    Settings → Payments.
                  </p>
                )}
              </div>

              {selected && (
                <p className="mt-3 text-xs text-silver-muted">
                  Buying <CreditAmount value={selected.totalCredits} showIcon={false} /> for{' '}
                  {selected.price?.formatted}
                  {selected.isEstimate && ` (charged as $${(selected.priceUsdCents / 100).toFixed(2)})`}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Store;

import { useState, useEffect, useCallback, useRef } from 'react';
import { getStoreConfig, getPacks, createOrder, captureOrder } from '../../api/monetization';
import { useMonetization } from '../../context/MonetizationContext';

// The client ID normally comes from the server, which reads whatever the admin
// set in the portal. This build-time value is only a fallback for local dev —
// relying on it would mean a rebuild every time PayPal accounts change.
const FALLBACK_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || '';

/**
 * Everything involved in buying credits, in one place.
 *
 * The store page and the buy-credits modal are two presentations of the same
 * transaction. Duplicating the order lifecycle across them is how the two
 * silently diverge — one gets a bug fix, the other keeps the bug, and the one
 * that keeps it is whichever the tests do not cover.
 *
 * The caller supplies the layout; this owns loading, selection, currency and
 * the PayPal order round trip.
 */
export const useCreditPurchase = ({ onPurchased, enabled = true } = {}) => {
  const { applyBalance } = useMonetization();

  const [config, setConfig] = useState(null);
  const [packs, setPacks] = useState([]);
  const [currency, setCurrency] = useState('');
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState({ state: 'loading' });

  // The PayPal SDK captures its callbacks once and never sees a later render,
  // so reading the order id from state inside onApprove yields the value from
  // when the button mounted — undefined. A ref is the only thing both closures
  // agree on. Getting this wrong means a completed payment we never capture.
  const orderIdRef = useRef(null);

  // Survives an unmount mid-payment: if a modal closes while PayPal is open,
  // the capture callback must not write to a dead component.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async (code) => {
    try {
      const [storeConfig, packList] = await Promise.all([getStoreConfig(), getPacks(code)]);
      if (!aliveRef.current) return;
      setConfig(storeConfig);
      setPacks(packList.packs || []);
      if (packList.currency) setCurrency(packList.currency.code);
      setStatus({ state: 'ready' });
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus({ state: 'error', message: 'Could not load the store. Please try again.' });
    }
  }, []);

  // Gated on `enabled` because the modal mounts this hook on every page that
  // shows a balance. Fetching eagerly would mean two API calls on every page
  // view to populate a dialog nobody has opened.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [enabled, load]);

  const changeCurrency = async (code) => {
    setCurrency(code);
    setSelected(null);
    try {
      const packList = await getPacks(code);
      if (!aliveRef.current) return;
      setPacks(packList.packs || []);
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus({ state: 'error', message: 'Could not price packs in that currency.' });
    }
  };

  /**
   * PayPal asks for an order id here. The price is recomputed server-side, so
   * nothing this function sends can influence what the buyer is charged.
   */
  const startOrder = async () => {
    if (!selected) {
      setStatus({ state: 'error', message: 'Please select a credit pack first.' });
      throw new Error('No pack selected');
    }
    const order = await createOrder({ packId: selected.id, currency });
    orderIdRef.current = order.orderId;
    setStatus({ state: 'paying' });
    return order.paypalOrderId;
  };

  const finishOrder = async () => {
    const orderId = orderIdRef.current;
    if (!orderId) {
      setStatus({
        state: 'error',
        message: 'We lost track of that order. If you were charged, your credits will arrive shortly.',
      });
      return;
    }
    try {
      const result = await captureOrder(orderId);
      orderIdRef.current = null;
      // The balance is applied even if the view has gone: the context outlives
      // any one component, and a reader who paid should see the new balance
      // wherever they end up.
      applyBalance(result.balance);
      if (aliveRef.current) {
        setStatus({ state: 'done', credits: result.creditsAdded, balance: result.balance });
      }
      if (onPurchased) onPurchased(result);
    } catch (error) {
      if (!aliveRef.current) return;
      setStatus({
        state: 'error',
        // The webhook is the safety net when this call is what failed rather
        // than the payment, so the copy must not claim the money is lost.
        message:
          error.response?.data?.message ||
          'We could not confirm your payment here. If you were charged, your credits will arrive shortly.',
      });
    }
  };

  const failPayment = (message = 'PayPal could not complete the payment.') =>
    setStatus({ state: 'error', message });

  const cancelPayment = () => setStatus({ state: 'ready' });

  const reset = () => {
    setSelected(null);
    setStatus({ state: 'ready' });
  };

  return {
    config,
    packs,
    currency,
    selected,
    status,
    setSelected,
    changeCurrency,
    startOrder,
    finishOrder,
    failPayment,
    cancelPayment,
    reset,
    reload: load,
    // Convenience for the two views, so neither re-derives it differently.
    storeOpen: Boolean(config?.enabled) && !config?.readOnly,
    paypalClientId: config?.paypalClientId || FALLBACK_CLIENT_ID,
  };
};

export default useCreditPurchase;

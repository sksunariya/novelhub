// Orders: quote, create, capture, credit, refund.
//
// The client capture path and the webhook path are deliberately redundant. The
// client call gives instant feedback; the webhook guarantees delivery if the
// buyer closes the tab mid-capture. They converge because both call
// `creditOrder`, which is guarded by `Order.creditedAt` and by a shared
// idempotency key on the ledger — not by ordering. Either can arrive first,
// both can arrive twice, and the buyer is credited exactly once.

const Order = require('../models/Order');
const CreditPack = require('../models/CreditPack');
const Counter = require('../models/Counter');
const CreditTransaction = require('../models/CreditTransaction');
const paypalService = require('./paypalService');
const fxService = require('./fxService');
const creditService = require('./creditService');
const settingsService = require('./settingsService');
const {
  ORDER_STATUS,
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  CREDIT_REF_TYPES,
  MICROS_PER_CENT,
} = require('../config/constants');

const fail = (message, status = 400, details = null) => Object.assign(new Error(message), { status, details });

const orderNumber = async () => {
  const seq = await Counter.next('order');
  return `NH-${new Date().getFullYear()}-${String(seq).padStart(7, '0')}`;
};

const packSnapshot = (pack) => ({
  id: pack._id,
  name: pack.name,
  credits: pack.credits,
  bonusCredits: pack.bonusCredits,
  priceUsdCents: pack.priceUsdCents,
});

/** Per-user purchase limits, evaluated against completed orders only. */
const assertPackLimits = async (pack, user) => {
  if (pack.limits.perUserTotal > 0) {
    const count = await Order.countDocuments({
      user: user._id,
      pack: pack._id,
      status: ORDER_STATUS.CAPTURED,
    });
    if (count >= pack.limits.perUserTotal) throw fail('You have reached the purchase limit for this pack', 403);
  }
  if (pack.limits.perUserPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await Order.countDocuments({
      user: user._id,
      pack: pack._id,
      status: ORDER_STATUS.CAPTURED,
      createdAt: { $gte: since },
    });
    if (count >= pack.limits.perUserPerDay) throw fail('Daily purchase limit reached for this pack', 429);
  }
  if (pack.visibility.firstPurchaseOnly) {
    const any = await Order.countDocuments({ user: user._id, status: ORDER_STATUS.CAPTURED });
    if (any > 0) throw fail('This offer is for first-time purchases only', 403);
  }
};

/** Packs a given user may buy, priced in their currency. */
const listPacks = async ({ user, currencyCode, ipCountry }) => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('monetization.enabled') || !snapshot.get('store.enabled')) {
    return { enabled: false, packs: [], currency: null };
  }

  const currency = await fxService.resolveCurrency({ requested: currencyCode, user, ipCountry });
  const packs = await CreditPack.find({ active: true }).sort({ sortOrder: 1, priceUsdCents: 1 });
  const now = new Date();

  const priced = [];
  for (const pack of packs) {
    if (!pack.isAvailable(now)) continue;
    if (!pack.allowsCountry(ipCountry)) continue;
    const quote = await fxService.quote(pack.priceUsdCents, currency, { snapshot });
    priced.push({
      id: pack._id,
      name: pack.name,
      slug: pack.slug,
      description: pack.description,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits,
      totalCredits: pack.credits + pack.bonusCredits,
      badge: pack.badge,
      badgeColor: pack.badgeColor,
      imageUrl: pack.imageUrl,
      priceUsdCents: pack.priceUsdCents,
      compareAtUsdCents: pack.compareAtUsdCents,
      price: quote.display,
      chargedIn: quote.settle.currency,
      isEstimate: quote.isEstimate,
    });
  }

  return {
    enabled: true,
    currency: {
      code: currency.code,
      symbol: currency.symbol,
      settlesLocally: !priced.some((p) => p.isEstimate) && currency.paypalSupported,
    },
    packs: priced,
  };
};

/**
 * Create an order and its PayPal counterpart.
 *
 * The price is recomputed here from the pack and the live rate — anything the
 * client sent is ignored — and then locked into the order. Capture verifies
 * against this lock, so tampering between the two is caught.
 */
const createOrder = async ({ user, packId, currencyCode, ipCountry, ipAddress, userAgent, returnUrl, cancelUrl }) => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('monetization.enabled')) throw fail('Purchases are unavailable', 503);
  if (snapshot.get('monetization.readOnlyMode')) throw fail('Purchases are temporarily paused', 503);
  if (!snapshot.get('store.enabled')) throw fail('The store is closed', 503);

  const restricted = snapshot.get('geo.restrictedCountries') || [];
  if (ipCountry && restricted.includes(ipCountry)) {
    throw fail('Purchases are not available in your region', 403);
  }

  const pack = await CreditPack.findOne({ _id: packId, active: true });
  if (!pack || !pack.isAvailable()) throw fail('That pack is not available', 404);
  if (!pack.allowsCountry(ipCountry)) throw fail('That pack is not available in your region', 403);
  await assertPackLimits(pack, user);

  const min = snapshot.get('credits.minPurchaseUsdCents');
  const max = snapshot.get('credits.maxPurchaseUsdCents');
  if (pack.priceUsdCents < min) throw fail('That pack is below the minimum purchase amount', 400);
  if (pack.priceUsdCents > max) throw fail('That pack exceeds the maximum purchase amount', 400);

  const currency = await fxService.resolveCurrency({ requested: currencyCode, user, ipCountry });
  const quote = await fxService.quote(pack.priceUsdCents, currency, { snapshot });

  const ttlMinutes = snapshot.get('store.orderQuoteTtlMinutes');
  const order = new Order({
    orderNumber: await orderNumber(),
    user: user._id,
    pack: pack._id,
    packSnapshot: packSnapshot(pack),
    credits: pack.credits,
    bonusCredits: pack.bonusCredits,
    totalCredits: pack.credits + pack.bonusCredits,
    baseUsdCents: pack.priceUsdCents,
    discountUsdCents: 0,
    netUsdCents: pack.priceUsdCents,
    chargeCurrency: quote.settle.currency,
    chargeAmountMinor: quote.settle.amountMinor,
    chargeDecimals: quote.settle.decimals,
    displayCurrency: quote.display.code,
    displayAmountMinor: quote.display.minor,
    isEstimateDisplay: quote.isEstimate,
    fxRateUsed: quote.rateUsed,
    fxMarkupPct: currency.markupPct,
    fxRateAt: quote.rateAt,
    quoteExpiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    ipAddress,
    ipCountry: ipCountry || '',
    userAgent: (userAgent || '').slice(0, 300),
  });
  order.log('created', 'client', { packId: String(pack._id) });

  const paypalOrder = await paypalService.createOrder({
    order,
    description: `${pack.credits + pack.bonusCredits} credits — ${pack.name}`,
    returnUrl,
    cancelUrl,
  });

  order.paypalOrderId = paypalOrder.id;
  order.log('paypal_order_created', 'client', { paypalOrderId: paypalOrder.id, status: paypalOrder.status });
  await order.save();

  return { order, paypalOrder };
};

/**
 * Grant the credits for a captured order.
 *
 * Safe to call any number of times from any path. `creditedAt` short-circuits
 * repeats, and the ledger key makes the underlying credit idempotent even if
 * two callers pass that check simultaneously.
 */
const creditOrder = async (order, { source = 'client' } = {}) => {
  if (order.creditedAt) return { credited: false, alreadyCredited: true };

  const result = await creditService.credit({
    user: order.user,
    amount: order.totalCredits,
    type: CREDIT_TRANSACTION_TYPES.PURCHASE,
    source: CREDIT_SOURCES.PURCHASE,
    // Cost basis is the cash actually received, so bonus credits correctly
    // dilute the per-credit value rather than inventing revenue.
    costUsdCents: order.netAfterFeeUsdCents || order.netUsdCents,
    idempotencyKey: `order:${order._id}:capture`,
    refType: CREDIT_REF_TYPES.ORDER,
    refId: order._id,
    sourceRef: order._id,
    reason: `order ${order.orderNumber}`,
    description: `Purchased ${order.totalCredits} credits`,
    metadata: { orderNumber: order.orderNumber, paypalCaptureId: order.paypalCaptureId },
  });

  order.creditedAt = new Date();
  order.status = ORDER_STATUS.CAPTURED;
  order.log('credited', source, { transactionId: String(result.transaction._id), replayed: result.replayed });
  await order.save();

  // Notification failures must never undo a credit that already landed.
  if (!result.replayed) {
    const User = require('../models/User');
    const creditNotifications = require('./creditNotificationService');
    const buyer = await User.findById(order.user);
    if (buyer) {
      await creditNotifications.creditsPurchased(buyer, {
        amount: order.totalCredits,
        orderNumber: order.orderNumber,
      });
    }
  }

  return { credited: !result.replayed, alreadyCredited: false, transaction: result.transaction };
};

const readCapture = (paypalResponse) => {
  const unit = (paypalResponse.purchase_units || [])[0] || {};
  const capture = ((unit.payments || {}).captures || [])[0] || {};
  const breakdown = capture.seller_receivable_breakdown || {};
  const toCents = (money) => (money && money.value ? Math.round(parseFloat(money.value) * 100) : 0);
  return {
    id: capture.id,
    status: capture.status,
    currency: (capture.amount || {}).currency_code,
    // Zero-decimal currencies come back without decimals; parseFloat handles both.
    amountMinorRaw: capture.amount ? parseFloat(capture.amount.value) : 0,
    feeUsdCents: toCents(breakdown.paypal_fee),
    netUsdCents: toCents(breakdown.net_amount),
    payerId: ((paypalResponse.payer || {}).payer_id) || '',
    payerEmail: ((paypalResponse.payer || {}).email_address) || '',
  };
};

/**
 * Capture an approved order and credit it.
 *
 * The amount check is the point: if what PayPal captured does not match what we
 * locked, we flag the order and credit nothing.
 */
const captureOrder = async (order, { source = 'client' } = {}) => {
  if (order.creditedAt) return { order, alreadyCredited: true };
  if (order.status === ORDER_STATUS.EXPIRED || order.status === ORDER_STATUS.CANCELLED) {
    throw fail('This order is no longer valid', 409);
  }

  const response = await paypalService.captureOrder(order.paypalOrderId);
  const capture = readCapture(response);

  if (capture.status !== 'COMPLETED') {
    order.status = ORDER_STATUS.FAILED;
    order.failureReason = `capture status ${capture.status}`;
    order.log('capture_failed', source, capture);
    await order.save();
    throw fail('Payment was not completed', 402, { status: capture.status });
  }

  // What was locked at creation, in the same units PayPal reports.
  const expected = order.chargeAmountMinor / 10 ** order.chargeDecimals;
  const currencyMatches = capture.currency === order.chargeCurrency;
  const amountMatches = Math.abs(capture.amountMinorRaw - expected) < 0.005;

  if (!currencyMatches || !amountMatches) {
    order.status = ORDER_STATUS.DISPUTED;
    order.failureReason = `captured ${capture.amountMinorRaw} ${capture.currency}, expected ${expected} ${order.chargeCurrency}`;
    order.log('amount_mismatch', source, { capture, expected, expectedCurrency: order.chargeCurrency });
    await order.save();
    throw fail('Payment amount did not match the order', 409);
  }

  order.paypalCaptureId = capture.id;
  order.paypalPayerId = capture.payerId;
  order.paypalPayerEmail = capture.payerEmail;
  order.paypalFeeUsdCents = capture.feeUsdCents;
  order.netAfterFeeUsdCents = capture.netUsdCents || order.netUsdCents;
  order.status = ORDER_STATUS.APPROVED;
  order.log('captured', source, { captureId: capture.id, fee: capture.feeUsdCents });
  await order.save();

  const deductFees = await settingsService.get('analytics.deductPaymentFees');
  if (!deductFees) order.netAfterFeeUsdCents = order.netUsdCents;

  await creditOrder(order, { source });
  return { order, alreadyCredited: false };
};

/**
 * Reverse a refunded or disputed order.
 *
 * Credits already spent cannot always be taken back; the configured policy
 * decides whether the balance is allowed to go negative.
 */
const clawbackOrder = async (order, { refundedUsdCents = null, source = 'webhook' } = {}) => {
  if (!order.creditedAt) return { clawedBack: 0 };
  if (order.creditsClawedBack >= order.totalCredits) return { clawedBack: 0 };

  const snapshot = await settingsService.snapshot();
  const allowNegative = snapshot.get('credits.allowNegativeBalance');
  const balance = await creditService.getBalance(order.user);

  const owed = order.totalCredits - order.creditsClawedBack;
  const take = allowNegative ? owed : Math.min(owed, balance);

  let reclaimed = 0;
  if (take > 0) {
    try {
      await creditService.debit({
        user: order.user,
        amount: take,
        type: CREDIT_TRANSACTION_TYPES.REFUND,
        idempotencyKey: `refund:${order.paypalCaptureId || order._id}`,
        refType: CREDIT_REF_TYPES.ORDER,
        refId: order._id,
        reason: 'order refunded',
        description: `Refund for order ${order.orderNumber}`,
        // Without this the debit enforces balance >= amount and refuses the
        // very clawback the setting exists to permit.
        allowNegative,
      });
      reclaimed = take;
    } catch (error) {
      // The money has already left PayPal, so a failed clawback is recorded
      // rather than thrown — the refund itself must not be undone.
      if (error.status !== 402) throw error;
      order.log('clawback_shortfall', source, { owed, balance });
    }
    order.creditsClawedBack += reclaimed;
  }

  order.refundedUsdCents = refundedUsdCents === null ? order.netUsdCents : refundedUsdCents;
  order.status =
    order.refundedUsdCents >= order.netUsdCents ? ORDER_STATUS.REFUNDED : ORDER_STATUS.PARTIALLY_REFUNDED;
  order.log('clawback', source, { credits: take });
  await order.save();

  return { clawedBack: take, shortfall: owed - take };
};

/** Expire stale unpaid orders so the price lock means something. */
const expireStaleOrders = async () => {
  const result = await Order.updateMany(
    { status: ORDER_STATUS.CREATED, quoteExpiresAt: { $lt: new Date() } },
    { $set: { status: ORDER_STATUS.EXPIRED } }
  );
  return { expired: result.modifiedCount || 0 };
};

/** Lifetime cash recognized against a user's purchases, for support views. */
const orderRevenueSummary = async (orderId) => {
  const rows = await CreditTransaction.find({ refType: CREDIT_REF_TYPES.ORDER, refId: orderId });
  return rows.reduce((sum, row) => sum + (row.attributedUsdMicros || 0), 0) / MICROS_PER_CENT;
};

module.exports = {
  listPacks,
  createOrder,
  captureOrder,
  creditOrder,
  clawbackOrder,
  expireStaleOrders,
  orderRevenueSummary,
  readCapture,
};

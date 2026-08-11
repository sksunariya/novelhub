const Order = require('../models/Order');
const orderService = require('../services/orderService');
const fxService = require('../services/fxService');
const paypalService = require('../services/paypalService');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');
const { ORDER_STATUS } = require('../config/constants');

/** Buyer country, from whichever header the admin configured. */
const detectCountry = async (req) => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('geo.enabled')) return '';
  const source = snapshot.get('geo.source');
  if (source === 'off') return '';
  const header =
    source === 'custom_header' ? snapshot.get('geo.customHeaderName').toLowerCase() : 'cf-ipcountry';
  const value = req.headers[header];
  return value ? String(value).toUpperCase().slice(0, 2) : snapshot.get('geo.fallbackCountry');
};

// GET /api/store/config
const getStoreConfig = asyncHandler(async (req, res) => {
  const snapshot = await settingsService.snapshot();
  const [currencies, configured, credentials] = await Promise.all([
    fxService.listEnabled(),
    paypalService.isConfigured(),
    paypalService.credentials(),
  ]);
  res.json({
    enabled: snapshot.get('monetization.enabled') && snapshot.get('store.enabled'),
    readOnly: snapshot.get('monetization.readOnlyMode'),
    paymentsConfigured: configured,
    // The PayPal client ID is public by design — it is embedded in their JS SDK
    // on every checkout page. Serving it here is what lets an admin configure
    // PayPal from the portal; the alternative is a build-time env var, which
    // means a rebuild to change accounts and a setting that silently does
    // nothing. The secret stays server-side and is never in this payload.
    paypalClientId: configured ? credentials.clientId : '',
    paypalEnvironment: credentials.environment,
    creditsPerUsd: snapshot.get('credits.perUsd'),
    creditLabel: {
      singular: snapshot.get('credits.labelSingular'),
      plural: snapshot.get('credits.labelPlural'),
    },
    showCalculator: snapshot.get('credits.showCalculator'),
    heading: snapshot.get('store.heading'),
    subheading: snapshot.get('store.subheading'),
    layout: snapshot.get('store.layout'),
    requireTerms: snapshot.get('store.requireTermsAcceptance'),
    refundPolicy: snapshot.get('tax.refundPolicyText'),
    currencies,
    detectedCountry: await detectCountry(req),
  });
});

// GET /api/store/packs?currency=EUR
const getPacks = asyncHandler(async (req, res) => {
  const ipCountry = await detectCountry(req);
  const result = await orderService.listPacks({
    user: req.user,
    currencyCode: req.query.currency,
    ipCountry,
  });
  res.json(result);
});

/**
 * Where PayPal should send the buyer back to.
 *
 * Derived server-side rather than trusted from the request body: the client
 * has never sent these, and PayPal's live API rejects the whole order when the
 * experience block is present without them. Falls back to CLIENT_URL so a
 * request with no Origin header still produces something valid.
 */
const returnUrls = (req) => {
  const origin = req.headers.origin || '';
  const base = (/^https?:\/\//.test(origin) ? origin : process.env.CLIENT_URL || '').replace(/\/+$/, '');
  if (!base) return {};
  return { returnUrl: `${base}/store?paypal=return`, cancelUrl: `${base}/store?paypal=cancel` };
};

// POST /api/store/orders
const createOrder = asyncHandler(async (req, res) => {
  const { packId, currency } = req.body || {};
  const fallback = returnUrls(req);
  const returnUrl = req.body?.returnUrl || fallback.returnUrl;
  const cancelUrl = req.body?.cancelUrl || fallback.cancelUrl;
  if (!packId) return res.status(400).json({ message: 'packId is required' });

  const { order, paypalOrder } = await orderService.createOrder({
    user: req.user,
    packId,
    currencyCode: currency,
    ipCountry: await detectCountry(req),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    returnUrl: returnUrl || `${process.env.CLIENT_URL || ''}/store/success`,
    cancelUrl: cancelUrl || `${process.env.CLIENT_URL || ''}/store`,
  });

  res.status(201).json({
    orderId: order._id,
    orderNumber: order.orderNumber,
    paypalOrderId: paypalOrder.id,
    status: paypalOrder.status,
    charge: {
      currency: order.chargeCurrency,
      amountMinor: order.chargeAmountMinor,
      decimals: order.chargeDecimals,
    },
    display: {
      currency: order.displayCurrency,
      amountMinor: order.displayAmountMinor,
      isEstimate: order.isEstimateDisplay,
    },
    totalCredits: order.totalCredits,
    expiresAt: order.quoteExpiresAt,
  });
});

// POST /api/store/orders/:id/capture
const captureOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) return res.status(404).json({ message: 'Order not found' });

  const result = await orderService.captureOrder(order, { source: 'client' });
  const balance = await require('../services/creditService').getBalance(req.user);

  res.json({
    orderNumber: order.orderNumber,
    status: order.status,
    creditsAdded: order.totalCredits,
    alreadyCredited: result.alreadyCredited,
    balance,
  });
});

// GET /api/store/orders
const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id, status: { $ne: ORDER_STATUS.CREATED } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments({ user: req.user._id, status: { $ne: ORDER_STATUS.CREATED } }),
  ]);

  res.json({
    orders: orders.map((order) => ({
      id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      credits: order.totalCredits,
      charged: {
        currency: order.chargeCurrency,
        amountMinor: order.chargeAmountMinor,
        decimals: order.chargeDecimals,
      },
      pack: order.packSnapshot,
      refundedUsdCents: order.refundedUsdCents,
      createdAt: order.createdAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

module.exports = { getStoreConfig, getPacks, createOrder, captureOrder, listOrders };

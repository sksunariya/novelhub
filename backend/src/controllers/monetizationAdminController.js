// Admin CRUD for the monetization catalogue.
//
// Without these the engine has nothing to sell: no packs means an empty store,
// no currencies means USD only, no pricing rules means static prices.

const CreditPack = require('../models/CreditPack');
const Currency = require('../models/Currency');
const PricingRule = require('../models/PricingRule');
const Wallet = require('../models/Wallet');
const Order = require('../models/Order');
const CreditTransaction = require('../models/CreditTransaction');
const AdminAuditLog = require('../models/AdminAuditLog');
const User = require('../models/User');
const fxService = require('../services/fxService');
const creditService = require('../services/creditService');
const creditNotifications = require('../services/creditNotificationService');
const settingsService = require('../services/settingsService');
const paypalService = require('../services/paypalService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { parsePagination } = require('./novelController');
const { uniqueSlug } = require('../utils/slugify');
const {
  CREDIT_TRANSACTION_TYPES,
  CREDIT_SOURCES,
  CREDIT_REF_TYPES,
  MICROS_PER_CENT,
} = require('../config/constants');

const audit = (req, action, entity, entityId, changes, note = '') =>
  AdminAuditLog.create({
    actor: req.user._id,
    actorLabel: req.user.username || req.user.email,
    action,
    entity,
    entityId: String(entityId || ''),
    changes,
    note,
    ip: req.ip,
    userAgent: (req.headers['user-agent'] || '').slice(0, 300),
  });

// ---------------------------------------------------------------- packs

const listPacks = asyncHandler(async (req, res) => {
  const packs = await CreditPack.find({}).sort({ sortOrder: 1, priceUsdCents: 1 });
  const snapshot = await settingsService.snapshot();
  const creditsPerUsd = snapshot.get('credits.perUsd');
  res.json({
    packs: packs.map((pack) => ({
      ...pack.toJSON(),
      // What the buyer effectively pays per credit, bonus included — the
      // number that tells an admin whether their tiers actually reward volume.
      effectiveCreditsPerUsd: pack.priceUsdCents
        ? +(((pack.credits + pack.bonusCredits) / pack.priceUsdCents) * 100).toFixed(1)
        : 0,
      baselineCreditsPerUsd: creditsPerUsd,
    })),
  });
});

const createPack = asyncHandler(async (req, res) => {
  const { name, credits, priceUsdCents } = req.body || {};
  if (!name || !credits || !priceUsdCents) {
    return res.status(400).json({ message: 'name, credits and priceUsdCents are required' });
  }
  const pack = await CreditPack.create({
    ...req.body,
    slug: await uniqueSlug(CreditPack, name),
    credits: Number(credits),
    bonusCredits: Number(req.body.bonusCredits || 0),
    priceUsdCents: Number(priceUsdCents),
  });
  await audit(req, 'pack.create', 'creditPack', pack._id, [{ key: 'name', before: null, after: pack.name }]);
  res.status(201).json({ pack });
});

const updatePack = asyncHandler(async (req, res) => {
  const pack = await CreditPack.findById(req.params.id);
  if (!pack) return res.status(404).json({ message: 'Pack not found' });

  const before = pack.toObject();
  const editable = [
    'name', 'description', 'credits', 'bonusCredits', 'priceUsdCents', 'compareAtUsdCents',
    'badge', 'badgeColor', 'imageUrl', 'sortOrder', 'active', 'visibility', 'limits',
    'availableFrom', 'availableUntil',
  ];
  const changes = [];
  for (const field of editable) {
    if (req.body[field] === undefined) continue;
    if (JSON.stringify(before[field]) === JSON.stringify(req.body[field])) continue;
    changes.push({ key: field, before: before[field], after: req.body[field] });
    pack[field] = req.body[field];
  }
  await pack.save();
  if (changes.length) await audit(req, 'pack.update', 'creditPack', pack._id, changes);
  res.json({ pack, changed: changes.length });
});

const deletePack = asyncHandler(async (req, res) => {
  const pack = await CreditPack.findById(req.params.id);
  if (!pack) return res.status(404).json({ message: 'Pack not found' });
  // Soft delete: orders reference this pack and receipts must keep resolving.
  await pack.softDelete();
  await audit(req, 'pack.delete', 'creditPack', pack._id, [{ key: 'deleted', before: false, after: true }]);
  res.json({ message: 'Pack removed' });
});

const reorderPacks = asyncHandler(async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ message: 'order must be an array of pack ids' });
  await Promise.all(order.map((id, index) => CreditPack.updateOne({ _id: id }, { sortOrder: index })));
  res.json({ message: 'Packs reordered' });
});

// ------------------------------------------------------------ currencies

const listCurrencies = asyncHandler(async (req, res) => {
  const [currencies, packs, snapshot] = await Promise.all([
    Currency.find({}).sort({ isDefault: -1, code: 1 }),
    CreditPack.find({ active: true }).sort({ priceUsdCents: 1 }).limit(1),
    settingsService.snapshot(),
  ]);

  // Live preview: what the cheapest pack costs in each currency right now, so
  // an admin can see the effect of a markup or rounding change before saving.
  const sample = packs[0];
  const rows = [];
  for (const currency of currencies) {
    let preview = null;
    if (sample) {
      try {
        const quote = await fxService.quote(sample.priceUsdCents, currency, { snapshot });
        preview = { formatted: quote.display.formatted, settlesIn: quote.settle.currency, isEstimate: quote.isEstimate };
      } catch (error) {
        preview = { error: error.message };
      }
    }
    rows.push({ ...currency.toObject(), stale: currency.isStale(snapshot.get('fx.staleAfterHours')), preview });
  }
  res.json({ currencies: rows, samplePack: sample ? sample.name : null });
});

const upsertCurrency = asyncHandler(async (req, res) => {
  const code = String(req.body.code || req.params.code || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return res.status(400).json({ message: 'code must be a 3-letter ISO-4217 code' });

  let currency = await Currency.findOne({ code });
  const before = currency ? currency.toObject() : null;
  if (!currency) currency = new Currency({ code });

  const editable = [
    'name', 'symbol', 'symbolPosition', 'enabled', 'decimals', 'settlementMode',
    'rateSource', 'manualRate', 'markupPct', 'rounding', 'minChargeMinor', 'isDefault',
  ];
  for (const field of editable) {
    if (req.body[field] !== undefined) currency[field] = req.body[field];
  }
  await currency.save();

  if (currency.isDefault) {
    await Currency.updateMany({ _id: { $ne: currency._id } }, { isDefault: false });
  }

  await audit(req, before ? 'currency.update' : 'currency.create', 'currency', currency._id, [
    { key: code, before: before && before.settlementMode, after: currency.settlementMode },
  ]);

  // The model may have overridden what was asked for — surface why.
  const notes = [];
  if (req.body.settlementMode === 'local' && !currency.paypalSupported) {
    notes.push(`PayPal cannot settle in ${code}; charges will be made in USD and ${code} shown as an estimate.`);
  }
  if (req.body.decimals !== undefined && currency.decimals !== Number(req.body.decimals)) {
    notes.push(`${code} does not support decimal amounts, so decimals were forced to 0.`);
  }
  res.json({ currency, notes });
});

const seedCurrencies = asyncHandler(async (req, res) => {
  res.json(await fxService.seedDefaults());
});

const refreshRates = asyncHandler(async (req, res) => {
  const result = await fxService.refreshRates();
  await audit(req, 'currency.refreshRates', 'currency', '', [], JSON.stringify(result));
  res.status(result.ok ? 200 : 502).json(result);
});

// --------------------------------------------------------- pricing rules

const listPricingRules = asyncHandler(async (req, res) => {
  res.json({ rules: await PricingRule.find({}).sort({ priority: -1, updatedAt: -1 }) });
});

const createPricingRule = asyncHandler(async (req, res) => {
  if (!req.body.name) return res.status(400).json({ message: 'name is required' });
  const rule = await PricingRule.create({ ...req.body, createdBy: req.user._id });
  await audit(req, 'pricingRule.create', 'pricingRule', rule._id, [{ key: 'name', before: null, after: rule.name }]);
  res.status(201).json({ rule });
});

const updatePricingRule = asyncHandler(async (req, res) => {
  const rule = await PricingRule.findById(req.params.id);
  if (!rule) return res.status(404).json({ message: 'Rule not found' });
  const before = rule.toObject();
  Object.assign(rule, req.body);
  await rule.save();
  await audit(req, 'pricingRule.update', 'pricingRule', rule._id, [
    { key: 'action', before: before.action, after: rule.action },
  ]);
  res.json({ rule });
});

const deletePricingRule = asyncHandler(async (req, res) => {
  const rule = await PricingRule.findByIdAndDelete(req.params.id);
  if (!rule) return res.status(404).json({ message: 'Rule not found' });
  await audit(req, 'pricingRule.delete', 'pricingRule', req.params.id, []);
  res.json({ message: 'Rule deleted' });
});

// --------------------------------------------------------------- wallets

const listWallets = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = req.query.sort === 'spend' ? { lifetimeSpendUsdCents: -1 } : { balance: -1 };

  const filter = {};
  if (req.query.search) {
    const users = await User.find({
      $or: [
        { username: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
      ],
    }).distinct('_id');
    filter.user = { $in: users };
  }

  const [wallets, total] = await Promise.all([
    Wallet.find(filter)
      .populate({ path: 'user', select: 'username email', options: { withDeleted: true } })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Wallet.countDocuments(filter),
  ]);
  res.json({ wallets, total, page, pages: Math.ceil(total / limit) });
});

const getWalletDetail = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.params.userId }).populate({
    path: 'user',
    select: 'username email createdAt',
    options: { withDeleted: true },
  });
  if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

  const [transactions, orders, deferred] = await Promise.all([
    CreditTransaction.find({ user: req.params.userId }).sort({ createdAt: -1 }).limit(50),
    Order.find({ user: req.params.userId }).sort({ createdAt: -1 }).limit(20),
    creditService.getDeferredRevenueMicros(req.params.userId),
  ]);

  res.json({
    wallet,
    transactions,
    orders,
    unspentValueUsdCents: Math.round(deferred / MICROS_PER_CENT),
  });
});

/**
 * Manual balance adjustment.
 *
 * Requires a reason, is capped by the safety setting, and writes to both the
 * ledger and the audit log — this is the one place an admin can create credits
 * out of nothing, so it leaves the most trace.
 */
const adjustWallet = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body || {};
  const delta = Number(amount);
  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ message: 'amount must be a non-zero whole number' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: 'A reason is required for manual adjustments' });
  }

  const snapshot = await settingsService.snapshot();
  const capValue = snapshot.get('safety.maxManualAdjustmentCredits');
  if (capValue && Math.abs(delta) > capValue) {
    return res.status(403).json({ message: `Adjustments are capped at ${capValue} credits` });
  }

  const user = await User.findById(req.params.userId);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const key = `admin-adjust:${req.user._id}:${Date.now()}`;
  let result;
  if (delta > 0) {
    result = await creditService.credit({
      user,
      amount: delta,
      type: CREDIT_TRANSACTION_TYPES.ADJUSTMENT,
      source: CREDIT_SOURCES.ADJUSTMENT,
      costUsdCents: 0,
      idempotencyKey: key,
      refType: CREDIT_REF_TYPES.ADMIN,
      refId: req.user._id,
      reason: String(reason).trim(),
      description: 'Balance adjusted by an administrator',
      createdBy: req.user._id,
    });
    await creditNotifications.creditsGranted(user, { amount: delta, reason: String(reason).trim() });
  } else {
    result = await creditService.debit({
      user,
      amount: Math.abs(delta),
      type: CREDIT_TRANSACTION_TYPES.ADJUSTMENT,
      idempotencyKey: key,
      refType: CREDIT_REF_TYPES.ADMIN,
      refId: req.user._id,
      reason: String(reason).trim(),
      description: 'Balance adjusted by an administrator',
      createdBy: req.user._id,
    });
  }

  await audit(req, 'wallet.adjust', 'wallet', req.params.userId, [
    { key: 'balance', before: result.transaction.balanceAfter - result.transaction.amount, after: result.transaction.balanceAfter },
  ], String(reason).trim());

  res.json({ balance: result.transaction.balanceAfter, transaction: result.transaction });
});

// ---------------------------------------------------------------- orders

const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.orderNumber) filter.orderNumber = req.query.orderNumber;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate({ path: 'user', select: 'username email', options: { withDeleted: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ orders, total, page, pages: Math.ceil(total / limit) });
});

const refundOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (!order.paypalCaptureId) return res.status(400).json({ message: 'This order was never captured' });

  const orderService = require('../services/orderService');
  await paypalService.refundCapture(order.paypalCaptureId, {
    amountMinor: order.chargeAmountMinor,
    currency: order.chargeCurrency,
    note: (req.body && req.body.note) || 'Refunded by support',
  });
  const result = await orderService.clawbackOrder(order, { source: 'admin' });

  const user = await User.findById(order.user);
  if (user) await creditNotifications.refundProcessed(user, { amount: result.clawedBack, orderNumber: order.orderNumber });

  await audit(req, 'order.refund', 'order', order._id, [
    { key: 'status', before: 'captured', after: order.status },
  ]);
  res.json({ order, ...result });
});

// ---------------------------------------------------------------- paypal

/**
 * GET /api/admin/monetization/paypal/test
 *
 * Ask PayPal for a token with the configured credentials. Without this the
 * first sign that PayPal is misconfigured is a reader failing to check out,
 * which is both the worst place to find out and the hardest to diagnose.
 *
 * Never echoes the credentials back — only whether they work.
 */
const testPaypal = asyncHandler(async (req, res) => {
  const result = await paypalService.testConnection();
  const { clientId, environment } = await paypalService.credentials();

  res.json({
    ok: result.ok,
    environment: result.environment || environment,
    // Enough to tell two accounts apart without exposing the credential.
    clientIdHint: clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-4)}` : '',
    webhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    error: result.ok ? undefined : result.error,
  });
});

/**
 * GET /api/admin/monetization/readiness
 *
 * Can a reader actually buy credits and spend them right now?
 *
 * Five separate things have to line up, and when one is missing the reader
 * sees a different vague message with no hint as to the cause — "the store is
 * closed", "no packs on sale", "payments are not set up". None of that reaches
 * the admin, so diagnosing it means guessing. This answers it directly.
 */
const readiness = asyncHandler(async (req, res) => {
  const snapshot = await settingsService.snapshot();
  const Chapter = require('../models/Chapter');

  const [packCount, paidChapters, paypalOk] = await Promise.all([
    CreditPack.countDocuments({ active: true }),
    Chapter.countDocuments({ accessType: 'paid' }),
    paypalService.isConfigured(),
  ]);

  const freeQuota = snapshot.get('pricing.defaultFreeChapterCount');
  const globalPrice = snapshot.get('pricing.defaultChapterCredits');

  const checks = [
    {
      key: 'monetization',
      label: 'Monetization is on',
      ok: snapshot.get('monetization.enabled'),
      fix: 'Settings → Monetization → General',
      detail: 'The master switch. While off, every chapter is free and the store is hidden.',
    },
    {
      key: 'store',
      label: 'The store is open',
      ok: snapshot.get('store.enabled'),
      fix: 'Settings → Monetization → Store',
      detail: 'Controls whether readers can buy credits at all.',
    },
    {
      key: 'packs',
      label: 'At least one credit pack',
      ok: packCount > 0,
      fix: 'Credit packs → New pack',
      detail: packCount > 0 ? `${packCount} on sale.` : 'With no pack there is nothing for a reader to buy.',
    },
    {
      key: 'paypal',
      label: 'PayPal is configured',
      ok: paypalOk,
      fix: 'Settings → Payments → PayPal',
      detail: paypalOk
        ? 'Credentials are present. Use Test connection to confirm they work.'
        : 'Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
    },
    {
      key: 'webhook',
      label: 'Webhook is set',
      ok: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      // Not fatal, so it is reported as a warning rather than a blocker.
      warnOnly: true,
      fix: 'PAYPAL_WEBHOOK_ID in the environment',
      detail:
        'Without it, a buyer who closes the tab mid-payment never receives their credits, ' +
        'because the browser capture call is the only path left.',
    },
    {
      key: 'pricing',
      label: 'Something costs credits',
      ok: paidChapters > 0 || globalPrice > 0,
      fix: 'Novels → Chapters → Set prices',
      detail:
        paidChapters > 0
          ? `${paidChapters} chapter${paidChapters === 1 ? '' : 's'} priced individually.`
          : `No chapter sets its own price. The site default is ${globalPrice} credits after the ` +
            `first ${freeQuota} free chapters.`,
    },
  ];

  const blockers = checks.filter((check) => !check.ok && !check.warnOnly);
  res.json({ ready: blockers.length === 0, blockers: blockers.length, checks });
});

// ------------------------------------------------------------- templates

const listTemplates = asyncHandler(async (req, res) => {
  res.json({ templates: await creditNotifications.listTemplates() });
});

const updateTemplate = asyncHandler(async (req, res) => {
  const NotificationTemplate = require('../models/NotificationTemplate');
  const { key, channel } = req.params;
  const { enabled, subject, body } = req.body || {};

  const template = await NotificationTemplate.findOneAndUpdate(
    { key, channel },
    {
      $set: {
        ...(enabled !== undefined ? { enabled: enabled === true || enabled === 'true' } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(body !== undefined ? { body } : {}),
        updatedBy: req.user._id,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await audit(req, 'template.update', 'notificationTemplate', `${key}:${channel}`, [
    { key: 'enabled', before: null, after: template.enabled },
  ]);
  res.json({ template });
});

module.exports = {
  listPacks, createPack, updatePack, deletePack, reorderPacks,
  listCurrencies, upsertCurrency, seedCurrencies, refreshRates,
  listPricingRules, createPricingRule, updatePricingRule, deletePricingRule,
  listWallets, getWalletDetail, adjustWallet,
  listOrders, refundOrder,
  testPaypal, readiness,
  listTemplates, updateTemplate,
};

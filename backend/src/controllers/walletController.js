const Wallet = require('../models/Wallet');
const CreditTransaction = require('../models/CreditTransaction');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');
const { serializeWallet, serializeTransaction } = require('../utils/serializers');
const { parsePagination } = require('./novelController');

// GET /api/wallet
const getWallet = asyncHandler(async (req, res) => {
  const [wallet, snapshot] = await Promise.all([Wallet.getOrCreate(req.user._id), settingsService.snapshot()]);
  res.json({
    wallet: serializeWallet(wallet, { creditLabel: snapshot.get('credits.labelPlural') }),
    enabled: snapshot.get('monetization.enabled'),
    lowBalanceThreshold: snapshot.get('credits.lowBalanceThreshold'),
  });
});

// GET /api/wallet/transactions
const getTransactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { user: req.user._id };
  if (req.query.type) filter.type = req.query.type;
  const [transactions, total] = await Promise.all([
    CreditTransaction.find(filter)
      .populate({ path: 'novel', select: 'title slug', options: { withDeleted: true } })
      .populate({ path: 'chapter', select: 'number title', options: { withDeleted: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    CreditTransaction.countDocuments(filter),
  ]);
  res.json({
    transactions: transactions.map((row) => ({
      ...serializeTransaction(row),
      novel: row.novel ? { title: row.novel.title, slug: row.novel.slug } : null,
      chapter: row.chapter ? { number: row.chapter.number, title: row.chapter.title } : null,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

// PUT /api/wallet/auto-unlock
const updateAutoUnlock = asyncHandler(async (req, res) => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('pricing.allowAutoUnlock')) {
    return res.status(403).json({ message: 'Auto-unlock is disabled' });
  }
  const ceiling = snapshot.get('pricing.autoUnlockMaxCredits');
  const { enabled, maxPriceCredits, novels } = req.body || {};

  const wallet = await Wallet.getOrCreate(req.user._id);
  if (enabled !== undefined) wallet.autoUnlock.enabled = enabled === true || enabled === 'true';
  if (maxPriceCredits !== undefined) {
    const requested = Number(maxPriceCredits);
    if (!Number.isInteger(requested) || requested < 0) {
      return res.status(400).json({ message: 'maxPriceCredits must be a whole number' });
    }
    // The admin ceiling wins over whatever the reader asks for.
    wallet.autoUnlock.maxPriceCredits = Math.min(requested, ceiling);
  }
  if (Array.isArray(novels)) wallet.autoUnlock.novels = novels;
  await wallet.save();

  res.json({ autoUnlock: wallet.autoUnlock, ceiling });
});

module.exports = { getWallet, getTransactions, updateAutoUnlock };

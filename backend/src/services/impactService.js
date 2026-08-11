// Impact previews.
//
// Several settings look like a single number and are not. Changing
// credits-per-USD silently revalues every outstanding balance; lowering the
// free-chapter count paywalls chapters people are already reading. An admin
// should see the blast radius before committing, not discover it afterwards.
//
// Resolvers are keyed by the `impact` name in the registry, so a new impactful
// setting either names an existing resolver or adds one here — nothing else
// needs to know.

const Wallet = require('../models/Wallet');
const Novel = require('../models/Novel');
const Chapter = require('../models/Chapter');
const ChapterAccess = require('../models/ChapterAccess');
const CreditBucket = require('../models/CreditBucket');
const registry = require('../config/settingsRegistry');
const settingsService = require('./settingsService');
const { resolveChapterPrice } = require('../utils/chapterPricing');
const { MICROS_PER_CENT } = require('../config/constants');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/**
 * Outstanding credits are a claim on content. Changing the rate does not
 * reprice packs, but it does change what every existing balance is worth.
 */
const revalueBalances = async (current, next) => {
  const [row] = await Wallet.aggregate([
    { $match: { balance: { $gt: 0 } } },
    { $group: { _id: null, credits: { $sum: '$balance' }, holders: { $sum: 1 } } },
  ]);
  const credits = row ? row.credits : 0;
  if (!credits) {
    return { severity: 'low', summary: 'No outstanding balances, so nothing is revalued.', facts: [] };
  }

  const before = Math.round((credits / current) * 100);
  const after = Math.round((credits / next) * 100);
  const direction = after > before ? 'increases' : 'decreases';

  return {
    severity: after === before ? 'low' : 'high',
    summary:
      `${plural(credits, 'outstanding credit')} held by ${plural(row.holders, 'reader')}. ` +
      `Their content value ${direction} from ${money(before)} to ${money(after)}. Pack prices are unchanged.`,
    facts: [
      { label: 'Outstanding credits', value: credits.toLocaleString() },
      { label: 'Worth today', value: money(before) },
      { label: 'Worth after', value: money(after) },
      { label: 'Holders affected', value: row.holders.toLocaleString() },
    ],
  };
};

/**
 * Walk every published chapter and count how many change between free and
 * paid. Exact rather than estimated, because "some chapters" is not a number
 * anyone can act on.
 */
const repriceChapters = async (key, next) => {
  const snapshot = await settingsService.snapshot();
  const PricingRule = require('../models/PricingRule');
  const rules = await PricingRule.find({ active: true }).sort({ priority: -1 });

  const base = {
    defaultChapterCredits: snapshot.get('pricing.defaultChapterCredits'),
    defaultFreeChapterCount: snapshot.get('pricing.defaultFreeChapterCount'),
    defaultFreeAfterDays: snapshot.get('pricing.defaultFreeAfterDays'),
    roundToNearestCredits: snapshot.get('pricing.roundToNearestCredits'),
    freezeFreeCountByOriginalNumber: snapshot.get('safety.freezeFreeCountByOriginalNumber'),
  };
  const changed = {
    ...base,
    ...(key === 'pricing.defaultChapterCredits' ? { defaultChapterCredits: next } : {}),
    ...(key === 'pricing.defaultFreeChapterCount' ? { defaultFreeChapterCount: next } : {}),
  };

  const novels = await Novel.find({ published: true }).select('genres status monetization');
  const byNovel = new Map(novels.map((novel) => [String(novel._id), novel]));
  const chapters = await Chapter.find({ published: true }).select(
    'novel number originalNumber accessType priceCredits freeAfterDays wordCount publishedAt createdAt'
  );

  let becomingPaid = 0;
  let becomingFree = 0;
  let repriced = 0;
  const affectedNovels = new Set();

  for (const chapter of chapters) {
    const novel = byNovel.get(String(chapter.novel));
    if (!novel) continue;
    const before = resolveChapterPrice({ novel, chapter, rules, config: base });
    const after = resolveChapterPrice({ novel, chapter, rules, config: changed });
    if (before.free === after.free && before.priceCredits === after.priceCredits) continue;

    affectedNovels.add(String(chapter.novel));
    if (before.free && !after.free) becomingPaid += 1;
    else if (!before.free && after.free) becomingFree += 1;
    else repriced += 1;
  }

  // Readers who already paid for something that is about to be free are the
  // part an admin most needs to know about.
  const alreadyPaid = becomingFree
    ? await ChapterAccess.countDocuments({ creditsSpent: { $gt: 0 } })
    : 0;

  if (!affectedNovels.size) {
    return { severity: 'low', summary: 'No chapter changes price or access under this value.', facts: [] };
  }

  const parts = [];
  if (becomingPaid) parts.push(`${plural(becomingPaid, 'chapter')} become paid`);
  if (becomingFree) parts.push(`${plural(becomingFree, 'chapter')} become free`);
  if (repriced) parts.push(`${plural(repriced, 'chapter')} change price`);

  return {
    severity: becomingPaid > 0 ? 'high' : 'medium',
    summary: `${parts.join(', ')} across ${plural(affectedNovels.size, 'novel')}.`,
    facts: [
      { label: 'Becoming paid', value: becomingPaid.toLocaleString() },
      { label: 'Becoming free', value: becomingFree.toLocaleString() },
      { label: 'Reprised', value: repriced.toLocaleString() },
      { label: 'Novels affected', value: affectedNovels.size.toLocaleString() },
      ...(alreadyPaid ? [{ label: 'Existing paid unlocks', value: alreadyPaid.toLocaleString() }] : []),
    ],
  };
};

/** Turning monetization off frees the whole catalogue and hides the store. */
const monetizationKillSwitch = async (current, next) => {
  if (next === current) return { severity: 'low', summary: 'No change.', facts: [] };

  if (!next) {
    const [paid, liability] = await Promise.all([
      ChapterAccess.countDocuments({ creditsSpent: { $gt: 0 } }),
      CreditBucket.aggregate([
        { $match: { remaining: { $gt: 0 } } },
        { $group: { _id: null, micros: { $sum: '$remainingCostMicros' } } },
      ]),
    ]);
    const deferred = liability[0] ? Math.round(liability[0].micros / MICROS_PER_CENT) : 0;
    return {
      severity: 'high',
      summary:
        'Every chapter becomes free and the store is hidden. Existing balances are kept but cannot be spent, ' +
        `and ${money(deferred)} of paid-for credits stay unredeemed.`,
      facts: [
        { label: 'Paid unlocks so far', value: paid.toLocaleString() },
        { label: 'Unredeemed credit value', value: money(deferred) },
      ],
    };
  }

  const [chapters, packs] = await Promise.all([
    Chapter.countDocuments({ published: true }),
    require('../models/CreditPack').countDocuments({ active: true }),
  ]);
  return {
    severity: 'high',
    summary: packs
      ? `Paywalls become active across ${plural(chapters, 'published chapter')}.`
      : `Paywalls become active across ${plural(chapters, 'published chapter')}, but no credit packs are on sale — ` +
        'readers will hit a wall with no way to buy credits.',
    facts: [
      { label: 'Published chapters', value: chapters.toLocaleString() },
      { label: 'Packs on sale', value: packs.toLocaleString() },
    ],
  };
};

/** Ranking weights: show the top 20 the new formula would produce. */
const previewRankings = async (current, next) => {
  const weights = { views: 1, recentViews: 3, rating: 2, engagement: 1.5, revenue: 0, ageDecay: 0.5, ...(next || {}) };
  const novels = await Novel.find({ published: true })
    .select('title views weeklyViews ratingAvg ratingCount createdAt')
    .limit(500);

  const score = (novel) => {
    const ageDays = (Date.now() - novel.createdAt.getTime()) / 86400000;
    return (
      (weights.views || 0) * Math.log1p(novel.views || 0) +
      (weights.recentViews || 0) * Math.log1p(novel.weeklyViews || 0) +
      (weights.rating || 0) * (novel.ratingAvg || 0) -
      (weights.ageDecay || 0) * Math.log1p(ageDays)
    );
  };

  const ranked = novels
    .map((novel) => ({ title: novel.title, score: +score(novel).toFixed(2) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    severity: 'medium',
    summary: `These weights would rank ${plural(ranked.length, 'novel')} as shown.`,
    facts: ranked.map((row, index) => ({ label: `${index + 1}. ${row.title}`, value: String(row.score) })),
  };
};

const RESOLVERS = { revalueBalances, repriceChapters, monetizationKillSwitch, previewRankings };

/**
 * Preview the effect of a proposed change. Read-only — nothing is written.
 */
const preview = async (key, rawValue) => {
  const def = registry.get(key);
  if (!def) throw Object.assign(new Error('Unknown setting'), { status: 404 });

  const parsed = registry.coerceAndValidate(key, rawValue);
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });

  const current = await settingsService.get(key);
  if (!def.impact || !RESOLVERS[def.impact]) {
    return { key, hasPreview: false, severity: 'low', summary: '', facts: [] };
  }

  // repriceChapters needs the key to know which value moved.
  const result =
    def.impact === 'repriceChapters'
      ? await repriceChapters(key, parsed.value)
      : await RESOLVERS[def.impact](current, parsed.value);

  return { key, hasPreview: true, current, next: parsed.value, ...result };
};

module.exports = { preview, RESOLVERS };

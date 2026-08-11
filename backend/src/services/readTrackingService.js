// Read tracking.
//
// Every write here is best-effort: analytics must never break reading. Failures
// are logged and swallowed rather than surfaced to the reader.

const ChapterRead = require('../models/ChapterRead');
const GateImpression = require('../models/GateImpression');
const ChapterStatsDaily = require('../models/ChapterStatsDaily');
const settingsService = require('./settingsService');
const { resolveReader, isBot, dayKey } = require('../utils/readerIdentity');

/** Should this request count at all? */
const shouldTrack = async (req, reader) => {
  const snapshot = await settingsService.snapshot();
  if (snapshot.get('views.filterBots') && isBot(req.headers['user-agent'])) return false;
  if (!snapshot.get('views.countAnonymous') && reader.anonymous) return false;
  return true;
};

const bumpDaily = async (fields, { chapter, novel, chapterNumber, day }) => {
  await ChapterStatsDaily.updateOne(
    { day, chapter },
    { $inc: fields, $setOnInsert: { novel, chapterNumber } },
    { upsert: true }
  ).catch((error) => {
    if (error.code !== 11000) throw error;
  });
};

/**
 * Record that someone read a chapter.
 *
 * Returns `{ firstTime }` so the caller knows whether this was a new unique
 * reader — which is what the retention curve counts.
 */
const recordRead = async (req, res, { chapter, novel }) => {
  try {
    const reader = resolveReader(req, res);
    if (!reader) return null;
    if (!(await shouldTrack(req, reader))) return null;

    const now = new Date();
    const day = dayKey(now);

    // Upsert first, then detect whether we created it. `upsertedCount` is the
    // cheapest reliable signal for "new unique reader".
    const result = await ChapterRead.updateOne(
      { readerKey: reader.readerKey, chapter: chapter._id },
      {
        $set: { lastReadAt: now, user: reader.user },
        $inc: { readCount: 1 },
        $setOnInsert: {
          novel: novel._id,
          chapterNumber: chapter.number,
          firstReadAt: now,
        },
      },
      { upsert: true }
    );

    const firstTime = Boolean(result.upsertedCount);
    await bumpDaily(
      { reads: 1, ...(firstTime ? { uniqueReaders: 1 } : {}) },
      { chapter: chapter._id, novel: novel._id, chapterNumber: chapter.number, day }
    );

    return { firstTime, readerKey: reader.readerKey };
  } catch (error) {
    console.error('[readTracking] recordRead failed:', error.message);
    return null;
  }
};

/**
 * Record that a reader was shown a wall.
 *
 * Deduped per reader per chapter per day, so refreshing a locked page twenty
 * times does not inflate the funnel denominator.
 */
const recordGateImpression = async (req, res, { chapter, novel, reason, priceCredits = 0, balance = 0, canAfford = false }) => {
  try {
    const reader = resolveReader(req, res);
    if (!reader) return null;
    if (!(await shouldTrack(req, reader))) return null;

    const day = dayKey();
    try {
      await GateImpression.create({
        readerKey: reader.readerKey,
        user: reader.user,
        chapter: chapter._id,
        novel: novel._id,
        chapterNumber: chapter.number,
        reason,
        priceCredits,
        balanceAtTime: balance,
        couldAfford: canAfford,
        day,
      });
    } catch (error) {
      if (error.code === 11000) return { deduped: true }; // already seen today
      throw error;
    }

    await bumpDaily(
      { gateImpressions: 1 },
      { chapter: chapter._id, novel: novel._id, chapterNumber: chapter.number, day }
    );
    return { recorded: true };
  } catch (error) {
    console.error('[readTracking] recordGateImpression failed:', error.message);
    return null;
  }
};

/** Called on unlock so conversion sits alongside readership in one rollup. */
const recordUnlock = async ({ chapter, novel, chapterNumber, creditsSpent, attributedUsdMicros }) => {
  try {
    await bumpDaily(
      { unlocks: 1, creditsSpent: creditsSpent || 0, attributedUsdMicros: attributedUsdMicros || 0 },
      { chapter, novel, chapterNumber, day: dayKey() }
    );
  } catch (error) {
    console.error('[readTracking] recordUnlock failed:', error.message);
  }
};

module.exports = { recordRead, recordGateImpression, recordUnlock, shouldTrack };

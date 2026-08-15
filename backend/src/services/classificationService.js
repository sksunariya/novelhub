// Content classification seam.
//
// Today: a null provider that returns "no opinion" on everything. Banned-word
// lists in communityGuardService (Phase 5) do the actual work, and they catch
// the lazy 20%.
//
// Later: a real provider — Perspective API, OpenAI moderation, Hive — plugs in
// at `setProvider()` and every call site keeps working.
//
// WHY THE NULL PROVIDER SHIPS FIRST, rather than nothing at all: the call sites
// in Phase 5 get written once, against a stable response shape. Retrofitting
// classification later would mean revisiting every guard, every report record
// and the moderation queue's sort order.
//
// TWO DESIGN DECISIONS worth knowing:
//
//   1. `SELF_HARM` is NOT a removal category. It routes to support resources.
//      Silently deleting someone's cry for help is the worst available outcome,
//      so the action map treats it differently from every other category.
//   2. Scores are stored on the Report even when no action is taken. Without
//      them there is no data to calibrate thresholds against later, and
//      thresholds picked without data are guesses.

const CATEGORIES = {
  TOXICITY: 'toxicity',
  SEVERE_TOXICITY: 'severeToxicity',
  THREAT: 'threat',
  HARASSMENT: 'harassment',
  HATE: 'hate',
  SEXUAL: 'sexual',
  SEXUAL_MINORS: 'sexualMinors',
  SELF_HARM: 'selfHarm',
  SPAM: 'spam',
  VIOLENCE: 'violence',
};

const ACTIONS = {
  ALLOW: 'allow',
  FLAG: 'flag',
  HIDE: 'hide',
  BLOCK: 'block',
  SUPPORT: 'support', // self-harm: publish, and surface resources to the author
  ESCALATE: 'escalate', // sexualMinors: straight to the restricted safety queue
};

/**
 * The shape every provider must return.
 *
 * `available: false` is how a caller distinguishes "nothing was flagged" from
 * "nothing was checked" — a distinction that matters when deciding whether a
 * post is safe to auto-approve.
 */
const emptyResult = () => ({
  available: false,
  provider: 'none',
  scores: {},
  flagged: [],
  action: ACTIONS.ALLOW,
  reason: null,
  checkedAt: null,
});

const nullProvider = {
  name: 'none',
  available: false,
  classify: async () => emptyResult(),
};

let provider = nullProvider;

/**
 * Install a provider.
 *
 *   classificationService.setProvider({
 *     name: 'perspective',
 *     available: true,
 *     classify: async (text, ctx) => ({ scores: { toxicity: 0.91 } }),
 *   });
 *
 * The provider only has to return `scores`. Thresholds, action mapping and the
 * self-harm and minor-safety special cases stay here, so swapping vendors never
 * changes policy.
 */
const setProvider = (impl) => {
  if (!impl || typeof impl.classify !== 'function') {
    throw new Error('A classification provider needs a classify(text, context) function');
  }
  provider = { available: true, ...impl };
  return provider;
};

const resetProvider = () => {
  provider = nullProvider;
};

// Defaults. Phase 5 moves these into the settings registry so they are tunable
// from the admin portal against real score data.
const DEFAULT_THRESHOLDS = {
  [CATEGORIES.SEXUAL_MINORS]: { escalate: 0.5 },
  [CATEGORIES.SEVERE_TOXICITY]: { block: 0.9, hide: 0.8, flag: 0.6 },
  [CATEGORIES.THREAT]: { block: 0.9, hide: 0.75, flag: 0.5 },
  [CATEGORIES.HATE]: { block: 0.9, hide: 0.75, flag: 0.5 },
  [CATEGORIES.HARASSMENT]: { hide: 0.85, flag: 0.6 },
  [CATEGORIES.SEXUAL]: { hide: 0.9, flag: 0.7 },
  [CATEGORIES.VIOLENCE]: { flag: 0.8 },
  [CATEGORIES.TOXICITY]: { flag: 0.8 },
  [CATEGORIES.SPAM]: { hide: 0.95, flag: 0.8 },
  [CATEGORIES.SELF_HARM]: { support: 0.6 },
};

// Severity order. The most serious matched action wins, so a post that is both
// spammy and threatening is treated as threatening.
const ACTION_RANK = {
  [ACTIONS.ALLOW]: 0,
  [ACTIONS.SUPPORT]: 1,
  [ACTIONS.FLAG]: 2,
  [ACTIONS.HIDE]: 3,
  [ACTIONS.BLOCK]: 4,
  [ACTIONS.ESCALATE]: 5,
};

/**
 * Map scores to a single action.
 *
 * Pure, exported, and testable without a provider — which is the point. The
 * policy is the part worth testing; the vendor call is not.
 */
const decide = (scores = {}, thresholds = DEFAULT_THRESHOLDS) => {
  let action = ACTIONS.ALLOW;
  const flagged = [];
  let reason = null;

  for (const [category, score] of Object.entries(scores)) {
    const rules = thresholds[category];
    if (!rules || typeof score !== 'number') continue;

    // Check most severe first so a score over `block` is not reported as `flag`.
    for (const candidate of [ACTIONS.ESCALATE, ACTIONS.BLOCK, ACTIONS.HIDE, ACTIONS.FLAG, ACTIONS.SUPPORT]) {
      const threshold = rules[candidate];
      if (threshold === undefined || score < threshold) continue;
      flagged.push({ category, score, action: candidate });
      if (ACTION_RANK[candidate] > ACTION_RANK[action]) {
        action = candidate;
        reason = category;
      }
      break;
    }
  }

  return { action, flagged, reason };
};

/**
 * Classify a piece of text.
 *
 * Never throws and never blocks a publish on a provider failure — a moderation
 * assist that takes the site down when a vendor has an outage is worse than no
 * assist. A failed check returns `available: false`, which Phase 5 can treat as
 * "do not auto-approve" without treating it as "reject".
 *
 * @param {string} text
 * @param {object} context  { targetType, spaceId, userId, thresholds }
 */
const classify = async (text, context = {}) => {
  if (!provider.available || typeof text !== 'string' || !text.trim()) {
    return emptyResult();
  }

  try {
    const raw = await provider.classify(text, context);
    const scores = (raw && raw.scores) || {};
    const { action, flagged, reason } = decide(scores, context.thresholds || DEFAULT_THRESHOLDS);
    return {
      available: true,
      provider: provider.name || 'unknown',
      scores,
      flagged,
      action,
      reason,
      checkedAt: new Date(),
    };
  } catch (error) {
    console.error('[classification] provider failed:', error.message);
    return { ...emptyResult(), provider: provider.name || 'unknown', error: error.message };
  }
};

/** Self-harm is handled as support, never as a removal. */
const isSupportCase = (result) => result && result.action === ACTIONS.SUPPORT;

/** Minor-safety goes straight to the restricted queue, bypassing normal moderation. */
const requiresSafetyEscalation = (result) => result && result.action === ACTIONS.ESCALATE;

module.exports = {
  classify,
  decide,
  setProvider,
  resetProvider,
  isSupportCase,
  requiresSafetyEscalation,
  getProvider: () => ({ name: provider.name, available: provider.available }),
  CATEGORIES,
  ACTIONS,
  ACTION_RANK,
  DEFAULT_THRESHOLDS,
};

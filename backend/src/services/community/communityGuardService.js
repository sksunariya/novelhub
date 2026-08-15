// Pre-publish guard.
//
// Runs on every post and comment before it is saved, extending the pattern
// `contentGuardService` already sets for chapters. Each check either rejects
// with a specific, actionable reason, or lets the content through with an
// automatic report attached for a human to look at.
//
// THE ORDERING PRINCIPLE: cheapest and most certain checks first. A banned-word
// scan is free and unambiguous; a classifier call is slow and probabilistic.
// Rejecting early means the expensive checks only run on content that has
// already passed the obvious ones.
//
// THE SELF-HARM PATH IS DIFFERENT ON PURPOSE. It does not block, hide, or
// remove. It publishes and surfaces support resources to the author. Silently
// deleting someone's cry for help is the worst available outcome, and treating
// it as a policy violation is close behind.

const Post = require('../../models/Post');
const classificationService = require('../classificationService');
const jobDispatcher = require('../jobDispatcher');
const { POST_STATUS } = require('../../config/constants');

const reject = (message, field = null) =>
  Object.assign(new Error(message), { status: 400, field, guard: true });

/**
 * Normalise text for matching.
 *
 * Lowercase, strip diacritics, collapse the character substitutions people use
 * to evade a word list. Without this, a list containing "spam" misses "sp4m",
 * "s p a m" and "spаm" with a Cyrillic а.
 */
const normalizeForMatching = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Which banned words appear?
 *
 * Word-boundary matched against the normalised text, so "class" does not trip
 * on a list containing "ass" — the classic false positive that makes word
 * lists infuriating rather than useful.
 */
const findBannedWords = (text, words = []) => {
  if (!words.length) return [];
  const haystack = ` ${normalizeForMatching(text)} `;
  return words.filter((word) => {
    const needle = normalizeForMatching(word);
    return needle && haystack.includes(` ${needle} `);
  });
};

const extractUrls = (text) => {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  return matches.map((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
};

/**
 * The guard.
 *
 * @returns {{ status, reports, supportResources }} — `status` is the POST_STATUS
 * the content should be saved with. Throws to reject outright.
 */
const check = async ({ user, space, settings, perms, content, targetType = 'post' }) => {
  const text = `${content.title || ''} ${content.bodyText || content.body || ''}`;
  const reports = [];
  let status = POST_STATUS.PUBLISHED;
  let supportResources = false;

  // --- account gates ------------------------------------------------------
  // Cheapest possible check, and the one that stops throwaway-account spam
  // before anything else runs.
  const minAgeHours = settings.get('spaces.posting.minAccountAgeHours');
  if (minAgeHours > 0 && !perms.isAdmin) {
    const eligibleAt = new Date(new Date(user.createdAt).getTime() + minAgeHours * 3600_000);
    if (eligibleAt > new Date()) {
      throw reject(`Your account needs to be ${minAgeHours} hours old to post here`);
    }
  }

  // --- lockdown -----------------------------------------------------------
  // A moderator's emergency brake during a raid. Checked before anything
  // expensive, because during a raid volume is the problem.
  if (space.lockdown && space.lockdown.enabled && !perms.isModerator) {
    const stillLocked = !space.lockdown.until || new Date(space.lockdown.until) > new Date();
    if (stillLocked) {
      const karma = (user.karma && user.karma.total) || 0;
      if (karma < (space.lockdown.minKarma || 0)) {
        throw reject('This space is temporarily limited to established members');
      }
      const ageHours = (Date.now() - new Date(user.createdAt).getTime()) / 3600_000;
      if (ageHours < (space.lockdown.minAccountAgeHours || 0)) {
        throw reject('This space is temporarily limited to established members');
      }
    }
  }

  // --- banned words -------------------------------------------------------
  // Global list plus the space's own. Action is admin-configurable because the
  // right answer differs by community: block for a slur list, flag for a list
  // of words that are usually but not always a problem.
  const globalWords = settings.get('spaces.moderation.bannedWords') || [];
  const spaceWords = space.bannedWords || [];
  const hits = findBannedWords(text, [...globalWords, ...spaceWords]);

  if (hits.length) {
    const action = settings.get('spaces.moderation.bannedWordAction');
    if (action === 'block') {
      // Deliberately does not name the word. Telling someone exactly which
      // term tripped the filter is a free tutorial in evading it.
      throw reject('That contains something this space does not allow');
    }
    if (action === 'hide') status = POST_STATUS.HIDDEN;
    reports.push({ reason: 'rule_violation', source: 'banned_word', detail: hits.length });
  }

  // --- link policy --------------------------------------------------------
  const urls = extractUrls(text);
  if (urls.length) {
    if (!settings.get('spaces.posting.allowLinks')) {
      throw reject('Links are not allowed here');
    }

    const minKarma = settings.get('spaces.posting.minKarmaToLink');
    const karma = (user.karma && user.karma.total) || 0;
    if (minKarma > 0 && karma < minKarma && !perms.isModerator) {
      // The cheapest effective spam brake there is: link spam needs karma, and
      // karma needs real participation.
      throw reject(`You need ${minKarma} karma to post links here`);
    }

    const blocklist = settings.get('spaces.posting.linkDomainBlocklist') || [];
    const blocked = urls.find((domain) =>
      blocklist.some((d) => domain === d || domain.endsWith(`.${d}`))
    );
    if (blocked) throw reject('Links to that site are not allowed');

    const allowlist = settings.get('spaces.posting.linkDomainAllowlist') || [];
    if (allowlist.length) {
      const disallowed = urls.find(
        (domain) => !allowlist.some((d) => domain === d || domain.endsWith(`.${d}`))
      );
      if (disallowed) throw reject('Links to that site are not allowed here');
    }
  }

  // --- duplicate detection ------------------------------------------------
  // Same link, same space, recently. Catches the bot that posts the same
  // referral URL across every space it can reach.
  const windowHours = settings.get('spaces.moderation.duplicateWindowHours');
  if (windowHours > 0 && content.link && content.link.url) {
    const duplicate = await Post.findOne({
      space: space._id,
      'link.url': content.link.url,
      status: POST_STATUS.PUBLISHED,
      createdAt: { $gte: new Date(Date.now() - windowHours * 3600_000) },
    })
      .select('_id')
      .lean();
    if (duplicate) throw reject('That link was already posted here recently');
  }

  // --- new-user approval queue -------------------------------------------
  // The most effective spam control available, at the cost of moderator time —
  // which is why it is off by default and per-space.
  const approvalPosts = settings.get('spaces.moderation.newUserApprovalPosts');
  if (approvalPosts > 0 && !perms.isModerator && targetType === 'post') {
    // eslint-disable-next-line global-require
    const SpaceMember = require('../../models/SpaceMember');
    const member = await SpaceMember.findOne({ space: space._id, user: user._id })
      .select('approvedPostCount')
      .lean();
    if (!member || (member.approvedPostCount || 0) < approvalPosts) {
      status = POST_STATUS.PENDING;
    }
  }

  // --- classification -----------------------------------------------------
  // Last, because it is the slowest and the only probabilistic check. Returns
  // "no opinion" until a provider is installed, so this is a no-op today.
  const classified = await classificationService.classify(text, {
    targetType,
    spaceId: String(space._id),
    userId: String(user._id),
  });

  if (classified.available) {
    const { ACTIONS } = classificationService;

    if (classified.action === ACTIONS.ESCALATE) {
      // Straight past ordinary moderation to the restricted queue.
      jobDispatcher.enqueue('safety.escalate', {
        targetType,
        reason: classified.reason,
        userId: String(user._id),
      });
      throw reject('That could not be posted');
    }

    if (classified.action === ACTIONS.BLOCK) throw reject('That could not be posted');
    if (classified.action === ACTIONS.HIDE) status = POST_STATUS.HIDDEN;

    if (classified.action === ACTIONS.SUPPORT) {
      // NOT a removal and NOT a flag. The content publishes normally and the
      // author is shown support resources. Deleting this, or treating it as a
      // violation, is the worst thing the system could do here.
      supportResources = true;
    } else if (classified.action !== ACTIONS.ALLOW) {
      reports.push({
        reason: classified.reason || 'other',
        source: 'automod',
        scores: classified.scores,
      });
    }
  }

  return { status, reports, supportResources, classified };
};

/**
 * Open the automatic reports the guard decided were warranted.
 *
 * Separate from `check` so the content id exists first — an automod report has
 * to point at something.
 */
const fileAutoReports = async ({ reports, targetType, target, space, author }) => {
  if (!reports.length) return { filed: 0 };
  // eslint-disable-next-line global-require
  const Report = require('../../models/Report');

  await Report.insertMany(
    reports.map((report) => ({
      targetType,
      target,
      space: space._id,
      contentAuthor: author,
      reporter: null,
      reporterType: 'automated',
      reason: report.reason,
      // Automod reports never carry instant-hide severity. A classifier
      // deciding on its own that something vanishes immediately is exactly the
      // failure mode the severity tiers exist to avoid.
      severity: 2,
      source: report.source,
      classificationScores: report.scores || null,
      details: 'Flagged automatically for review',
    })),
    { ordered: false }
  );

  return { filed: reports.length };
};

module.exports = {
  check,
  fileAutoReports,
  findBannedWords,
  normalizeForMatching,
  extractUrls,
};

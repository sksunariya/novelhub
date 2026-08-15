// Report thresholds, severity weighting, and the abuse resistance that makes
// a community-policed system work rather than become a weapon.

const reportService = require('../src/services/community/reportService');
const Report = require('../src/models/Report');
const registry = require('../src/config/settingsRegistry');

const REASONS = registry.get('spaces.moderation.reportReasons').default;

describe('reporter weighting', () => {
  it('gives a trusted flagger more weight', () => {
    expect(reportService.reporterWeight({ trustedFlagger: true })).toBeGreaterThan(
      reportService.reporterWeight({ karma: { total: 100 } })
    );
  });

  it('discounts a reporter with negative karma', () => {
    // Someone the community has consistently downvoted should not be able to
    // hide content as easily as everyone else.
    expect(reportService.reporterWeight({ karma: { total: -10 } })).toBeLessThan(1);
  });

  it('never lets one reporter reach the default threshold alone', () => {
    // The whole point of counting distinct reporters. A single person — even a
    // trusted flagger — must not be able to hide anything by themselves at
    // ordinary severity.
    const threshold = registry.get('spaces.moderation.autoHideReports').default;
    const heaviest = Math.max(
      reportService.reporterWeight({ trustedFlagger: true }),
      reportService.reporterWeight({ karma: { total: 999999 } })
    );
    expect(heaviest).toBeLessThan(threshold);
  });

  it('treats an anonymous report as ordinary weight', () => {
    expect(reportService.reporterWeight(null)).toBe(1);
  });
});

describe('severity', () => {
  it('resolves a known reason to its configured severity', () => {
    expect(reportService.severityFor('minor_safety', REASONS)).toBe(5);
    expect(reportService.severityFor('off_topic', REASONS)).toBe(1);
    expect(reportService.severityFor('spam', REASONS)).toBe(2);
  });

  it('defaults an unknown reason to the lowest severity', () => {
    // Fail toward "needs a quorum", never toward "hide immediately".
    expect(reportService.severityFor('nonsense', REASONS)).toBe(1);
    expect(reportService.severityFor('spam', [])).toBe(1);
  });

  it('reserves instant hiding for the reasons where delay is the harm', () => {
    const instant = REASONS.filter((r) => r.severity >= reportService.INSTANT_HIDE_SEVERITY);
    const keys = instant.map((r) => r.key).sort();
    expect(keys).toEqual(['hate', 'minor_safety', 'self_harm', 'violence']);
  });

  it('keeps ordinary annoyances well below the instant threshold', () => {
    // "Off topic" must never hide anything on one click.
    for (const key of ['off_topic', 'other', 'misinformation', 'spam', 'rule_violation']) {
      expect(reportService.severityFor(key, REASONS)).toBeLessThan(
        reportService.INSTANT_HIDE_SEVERITY
      );
    }
  });

  it('routes only minor-safety reasons to the restricted queue', () => {
    // Hate speech hides immediately but belongs in ordinary moderation. Only
    // minor safety goes to the queue with legal preservation attached.
    expect(reportService.SAFETY_ESCALATION_REASONS.has('minor_safety')).toBe(true);
    expect(reportService.SAFETY_ESCALATION_REASONS.has('hate')).toBe(false);
    expect(reportService.SAFETY_ESCALATION_REASONS.has('spam')).toBe(false);
  });
});

describe('Report model shape', () => {
  it('enforces one report per person per item', () => {
    // Without this, one angry user hides anything by clicking five times.
    const unique = Report.schema
      .indexes()
      .find(([, options]) => options && options.unique);
    expect(unique).toBeTruthy();
    expect(unique[0]).toEqual({ targetType: 1, target: 1, reporter: 1 });
  });

  it('snapshots the content as reported', () => {
    // A user reports a post, the author edits it into something innocuous, and
    // without this the reviewer sees nothing wrong and dismisses it.
    expect(Report.schema.path('snapshot.title')).toBeDefined();
    expect(Report.schema.path('snapshot.body')).toBeDefined();
    expect(Report.schema.path('snapshot.capturedAt')).toBeDefined();
  });

  it('supports reports from people without an account', () => {
    // The DSA requires ANYONE to be able to report illegal content.
    expect(Report.schema.path('reporterEmail')).toBeDefined();
    expect(Report.schema.path('reporter').options.required).toBeFalsy();
  });

  it('carries claim fields so two moderators cannot double-action', () => {
    expect(Report.schema.path('claimedBy')).toBeDefined();
    expect(Report.schema.path('claimedAt')).toBeDefined();
  });

  it('sorts the queue by severity before recency', () => {
    const queueIndex = Report.schema
      .indexes()
      .find(([spec]) => spec.status === 1 && spec.severity === -1);
    expect(queueIndex).toBeTruthy();
  });

  it('indexes reporter history, which is how brigading is spotted', () => {
    const specs = Report.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ reporter: 1, createdAt: -1 }));
  });
});

describe('threshold settings', () => {
  it('defaults to needing several distinct reporters', () => {
    const threshold = registry.get('spaces.moderation.autoHideReports').default;
    expect(threshold).toBeGreaterThan(1);
  });

  it('lets an admin disable auto-hiding entirely', () => {
    expect(registry.get('spaces.moderation.autoHideReports').min).toBe(0);
  });

  it('caps how many reports one person can file per day', () => {
    // Blunts someone working through a list of everything they dislike.
    const cap = registry.get('spaces.moderation.maxReportsPerUserPerDay');
    expect(cap.default).toBeGreaterThan(0);
  });
});

describe('statement of reasons — DSA Article 17', () => {
  const StatementOfReasons = require('../src/models/StatementOfReasons');

  it('separates an illegal-content ground from a terms violation', () => {
    // The distinction drives what else is required and is the primary axis of
    // a transparency report.
    expect(Object.values(StatementOfReasons.GROUNDS)).toEqual(['illegal_content', 'terms_violation']);
    expect(StatementOfReasons.schema.path('legalBasis')).toBeDefined();
  });

  it('discloses whether the decision was automated', () => {
    // An explicit Article 17 disclosure, not an implementation detail.
    expect(StatementOfReasons.schema.path('automated')).toBeDefined();
    expect(StatementOfReasons.schema.path('automatedDetail.classifier')).toBeDefined();
    expect(StatementOfReasons.schema.path('automatedDetail.score')).toBeDefined();
  });

  it('cites a rule by stable id and freezes its text', () => {
    // Rules get edited. A statement citing "rule 3" that later points at
    // different text is worse than no citation.
    expect(StatementOfReasons.schema.path('ruleId')).toBeDefined();
    expect(StatementOfReasons.schema.path('ruleText')).toBeDefined();
  });

  it('records an appeal deadline', () => {
    expect(StatementOfReasons.schema.path('appealable')).toBeDefined();
    expect(StatementOfReasons.schema.path('appealDeadline')).toBeDefined();
  });

  it('is immutable except for the two delivery timestamps', () => {
    const hooks = StatementOfReasons.schema.s.hooks._pres;
    for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
      expect(hooks.get(op)).toBeDefined();
    }
  });

  it('indexes what a transparency report aggregates over', () => {
    const specs = StatementOfReasons.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ ground: 1, restrictionType: 1, createdAt: -1 }));
    expect(specs).toContain(JSON.stringify({ automated: 1, createdAt: -1 }));
  });

  it('covers restrictions beyond content removal', () => {
    // Article 17 covers account suspension and feature restriction too, not
    // just taking a post down.
    const types = Object.values(StatementOfReasons.RESTRICTION_TYPES);
    expect(types).toEqual(expect.arrayContaining([
      'content_removed', 'content_hidden', 'account_suspended', 'feature_restricted',
    ]));
  });
});

describe('appeals', () => {
  const Appeal = require('../src/models/Appeal');

  it('lets both the author and the reporter appeal', () => {
    // A mechanism that only hears authors is half a mechanism.
    expect(Appeal.schema.path('appellantRole').options.enum).toEqual(['author', 'reporter']);
  });

  it('refuses review by whoever made the original decision', () => {
    // Otherwise the mechanism is the same person confirming they were right.
    const appeal = new Appeal({
      appellant: '507f1f77bcf86cd799439011',
      appellantRole: 'author',
      targetType: 'post',
      target: '507f1f77bcf86cd799439012',
      reason: 'x',
      originalDecisionBy: '507f1f77bcf86cd799439013',
    });
    expect(appeal.canBeReviewedBy({ _id: '507f1f77bcf86cd799439013' })).toBe(false);
    expect(appeal.canBeReviewedBy({ _id: '507f1f77bcf86cd799439014' })).toBe(true);
    expect(appeal.canBeReviewedBy(null)).toBe(false);
  });

  it('allows anyone to review when no original decider is recorded', () => {
    const appeal = new Appeal({
      appellant: '507f1f77bcf86cd799439011',
      appellantRole: 'author',
      targetType: 'post',
      target: '507f1f77bcf86cd799439012',
      reason: 'x',
    });
    expect(appeal.canBeReviewedBy({ _id: '507f1f77bcf86cd799439013' })).toBe(true);
  });

  it('allows one appeal per person per decision', () => {
    const unique = Appeal.schema.indexes().find(([, o]) => o && o.unique);
    expect(unique[0]).toEqual({ statement: 1, appellant: 1 });
  });

  it('queues oldest first, which is the fair order', () => {
    const specs = Appeal.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ status: 1, createdAt: 1 }));
  });
});

describe('mod log', () => {
  const ModAction = require('../src/models/ModAction');

  it('is immutable', () => {
    const hooks = ModAction.schema.s.hooks._pres;
    for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
      expect(hooks.get(op)).toBeDefined();
    }
  });

  it('keeps an actor label that survives account deletion', () => {
    expect(ModAction.schema.path('actorLabel')).toBeDefined();
  });

  it('indexes by actor role, which is how admin abuse is found', () => {
    const specs = ModAction.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(specs).toContain(JSON.stringify({ actorRole: 1, createdAt: -1 }));
  });

  it('separates the private note from the public entry', () => {
    expect(ModAction.schema.path('note')).toBeDefined();
    expect(ModAction.schema.path('publiclyVisible')).toBeDefined();
  });
});

describe('automod guard', () => {
  const guard = require('../src/services/community/communityGuardService');

  it('collapses the substitutions used to evade a word list', () => {
    for (const variant of ['sp4m', 'SPAM', 'spám', '$pam']) {
      expect(guard.normalizeForMatching(variant)).toBe('spam');
    }
  });

  it('matches on word boundaries, so "class" does not trip on "ass"', () => {
    // The classic false positive that makes word lists infuriating rather
    // than useful.
    expect(guard.findBannedWords('this class is great', ['ass'])).toEqual([]);
    expect(guard.findBannedWords('assemble the parts', ['ass'])).toEqual([]);
    expect(guard.findBannedWords('what an ass', ['ass'])).toEqual(['ass']);
  });

  it('catches evaded spellings', () => {
    expect(guard.findBannedWords('sp4m offer', ['spam'])).toEqual(['spam']);
  });

  it('returns nothing for an empty list', () => {
    expect(guard.findBannedWords('anything at all', [])).toEqual([]);
  });

  it('extracts link domains without the www prefix', () => {
    expect(guard.extractUrls('see https://www.evil.com/a and http://ok.org/b'))
      .toEqual(['evil.com', 'ok.org']);
    expect(guard.extractUrls('no links here')).toEqual([]);
  });
});

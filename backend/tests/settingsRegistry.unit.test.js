const registry = require('../src/config/settingsRegistry');
const { TYPES } = require('../src/config/settings/types');

describe('settings registry', () => {
  it('loads without a malformed declaration', () => {
    expect(registry.all().length).toBeGreaterThan(50);
    expect(registry.sections().length).toBeGreaterThan(5);
  });

  it('every declared default passes its own validation', () => {
    for (const def of registry.all()) {
      const error = TYPES[def.type].validate(def.default, def);
      expect(error ? `${def.key}: ${error}` : null).toBeNull();
    }
  });

  it('has no duplicate keys', () => {
    const keys = registry.keys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never marks a secret as public', () => {
    for (const def of registry.all()) {
      if (def.secret) {
        expect(registry.describe(def).public).toBe(false);
      }
    }
    const publicKeys = registry.publicKeys();
    for (const key of registry.secretKeys()) {
      expect(publicKeys).not.toContain(key);
    }
  });

  it('omits secret defaults from the described metadata', () => {
    const described = registry.describe(registry.get('paypal.clientSecret'));
    expect(described.secret).toBe(true);
    expect(described.default).toBeNull();
    expect(described.envVar).toBe('PAYPAL_CLIENT_SECRET');
  });

  describe('coercion', () => {
    it('reads booleans from multipart string bodies', () => {
      expect(registry.coerceAndValidate('monetization.enabled', 'true')).toEqual({ ok: true, value: true });
      expect(registry.coerceAndValidate('monetization.enabled', 'false')).toEqual({ ok: true, value: false });
      expect(registry.coerceAndValidate('monetization.enabled', true)).toEqual({ ok: true, value: true });
    });

    it('rejects a non-boolean for a boolean setting', () => {
      expect(registry.coerceAndValidate('monetization.enabled', 'yes').ok).toBe(false);
    });

    it('reads integers from strings but rejects floats and junk', () => {
      expect(registry.coerceAndValidate('credits.perUsd', '250')).toEqual({ ok: true, value: 250 });
      expect(registry.coerceAndValidate('credits.perUsd', '1.5').ok).toBe(false);
      expect(registry.coerceAndValidate('credits.perUsd', 'abc').ok).toBe(false);
      expect(registry.coerceAndValidate('credits.perUsd', '').ok).toBe(false);
    });

    it('enforces min and max', () => {
      expect(registry.coerceAndValidate('credits.perUsd', '0').ok).toBe(false);
      expect(registry.coerceAndValidate('ranking.trendingWindowDays', '400').ok).toBe(false);
      expect(registry.coerceAndValidate('ranking.trendingWindowDays', '30').ok).toBe(true);
    });

    it('rejects negative money and accepts whole cents', () => {
      expect(registry.coerceAndValidate('credits.minPurchaseUsdCents', '-1').ok).toBe(false);
      expect(registry.coerceAndValidate('credits.minPurchaseUsdCents', '999')).toEqual({ ok: true, value: 999 });
    });

    it('validates enum membership', () => {
      expect(registry.coerceAndValidate('pricing.gateStacking', 'both').ok).toBe(true);
      expect(registry.coerceAndValidate('pricing.gateStacking', 'whatever').ok).toBe(false);
    });

    it('accepts multiselect as an array, a JSON string or a comma list', () => {
      expect(registry.coerceAndValidate('grants.defaultChannels', ['email'])).toEqual({ ok: true, value: ['email'] });
      expect(registry.coerceAndValidate('grants.defaultChannels', '["email","in_app"]').value).toEqual([
        'email',
        'in_app',
      ]);
      expect(registry.coerceAndValidate('grants.defaultChannels', 'email, in_app').value).toEqual(['email', 'in_app']);
    });

    it('rejects unknown multiselect options', () => {
      const result = registry.coerceAndValidate('grants.defaultChannels', ['carrier_pigeon']);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/carrier_pigeon/);
    });

    it('validates string patterns', () => {
      expect(registry.coerceAndValidate('currency.default', 'EUR').ok).toBe(true);
      expect(registry.coerceAndValidate('currency.default', 'eur').ok).toBe(false);
      expect(registry.coerceAndValidate('geo.fallbackCountry', 'IN').ok).toBe(true);
      expect(registry.coerceAndValidate('geo.fallbackCountry', 'IND').ok).toBe(false);
    });

    it('validates cron expressions by field count', () => {
      expect(registry.coerceAndValidate('expiry.sweepCron', '0 3 * * *').ok).toBe(true);
      expect(registry.coerceAndValidate('expiry.sweepCron', '0 3 * *').ok).toBe(false);
    });

    it('validates JSON array shape', () => {
      expect(
        registry.coerceAndValidate('pricing.bulkDiscountTiers', '[{"minChapters":5,"discountPct":10}]').ok
      ).toBe(true);
      const missing = registry.coerceAndValidate('pricing.bulkDiscountTiers', '[{"minChapters":5}]');
      expect(missing.ok).toBe(false);
      expect(missing.error).toMatch(/discountPct/);
      expect(registry.coerceAndValidate('pricing.bulkDiscountTiers', 'not json').ok).toBe(false);
    });

    it('rejects an unknown key', () => {
      expect(registry.coerceAndValidate('nope.not.a.setting', '1')).toEqual({
        ok: false,
        error: 'unknown setting',
      });
    });
  });

  it('builds a lowercase search index covering key, label and help', () => {
    const entry = registry.searchIndex().find((row) => row.key === 'credits.perUsd');
    expect(entry.haystack).toContain('credits per usd');
    expect(entry.haystack).toBe(entry.haystack.toLowerCase());
  });
});

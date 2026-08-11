// Setting types: how a declared value is coerced from request input and validated.
//
// Every type exposes `coerce(raw, def)` -> value and `validate(value, def)` ->
// error string or null. Coercion is deliberately lenient about request encoding
// (multipart bodies send everything as strings) but strict about the result.

const CRON_FIELD_COUNT = 5;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const toBool = (raw) => {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;
  return null;
};

const bounded = (value, def) => {
  if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
  if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
  return null;
};

const TYPES = {
  boolean: {
    coerce: (raw) => toBool(raw),
    validate: (value) => (typeof value === 'boolean' ? null : 'must be true or false'),
  },

  integer: {
    coerce: (raw) => {
      if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
      if (typeof raw !== 'string' || raw.trim() === '') return null;
      return /^-?\d+$/.test(raw.trim()) ? parseInt(raw, 10) : null;
    },
    validate: (value, def) => {
      if (!Number.isInteger(value)) return 'must be a whole number';
      return bounded(value, def);
    },
  },

  number: {
    coerce: (raw) => {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
      if (typeof raw !== 'string' || raw.trim() === '') return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    },
    validate: (value, def) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      return bounded(value, def);
    },
  },

  // Money is always stored as integer minor units. Never a float.
  money_usd_cents: {
    coerce: (raw) => TYPES.integer.coerce(raw),
    validate: (value, def) => {
      if (!Number.isInteger(value)) return 'must be a whole number of cents';
      if (value < 0) return 'cannot be negative';
      return bounded(value, def);
    },
  },

  string: {
    coerce: (raw) => (typeof raw === 'string' ? raw.trim() : raw === null ? '' : null),
    validate: (value, def) => {
      if (typeof value !== 'string') return 'must be text';
      if (def.maxLength && value.length > def.maxLength) return `must be ${def.maxLength} characters or fewer`;
      if (def.pattern && value && !new RegExp(def.pattern).test(value)) return def.patternHint || 'has an invalid format';
      return null;
    },
  },

  text: {
    coerce: (raw) => (typeof raw === 'string' ? raw : raw === null ? '' : null),
    validate: (value, def) => {
      if (typeof value !== 'string') return 'must be text';
      if (def.maxLength && value.length > def.maxLength) return `must be ${def.maxLength} characters or fewer`;
      return null;
    },
  },

  enum: {
    coerce: (raw) => (typeof raw === 'string' ? raw.trim() : null),
    validate: (value, def) =>
      def.options.some((option) => option.value === value) ? null : `must be one of: ${def.options.map((o) => o.value).join(', ')}`,
  },

  multiselect: {
    coerce: (raw) => {
      if (Array.isArray(raw)) return raw.map((entry) => String(entry).trim());
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()) : null;
          } catch (error) {
            return null;
          }
        }
        return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
      }
      return null;
    },
    validate: (value, def) => {
      if (!Array.isArray(value)) return 'must be a list';
      if (def.options) {
        const allowed = new Set(def.options.map((option) => option.value));
        const unknown = value.filter((entry) => !allowed.has(entry));
        if (unknown.length) return `unknown option(s): ${unknown.join(', ')}`;
      }
      if (def.maxItems && value.length > def.maxItems) return `at most ${def.maxItems} items`;
      return null;
    },
  },

  color: {
    coerce: (raw) => (typeof raw === 'string' ? raw.trim() : null),
    validate: (value) => (HEX_COLOR.test(value) ? null : 'must be a hex color like #dc2626'),
  },

  cron: {
    coerce: (raw) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : null),
    validate: (value) =>
      value.split(' ').length === CRON_FIELD_COUNT ? null : 'must be a 5-field cron expression, e.g. 0 3 * * *',
  },

  // Free-form structured config (rate tables, discount tiers, region multipliers).
  json: {
    coerce: (raw) => {
      if (raw && typeof raw === 'object') return raw;
      if (typeof raw !== 'string') return null;
      try {
        return JSON.parse(raw);
      } catch (error) {
        return null;
      }
    },
    validate: (value, def) => {
      if (value === null || typeof value !== 'object') return 'must be valid JSON';
      if (def.arrayOf && !Array.isArray(value)) return 'must be a JSON array';
      if (def.itemShape && Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          const row = value[i];
          if (!row || typeof row !== 'object') return `row ${i + 1} must be an object`;
          for (const field of def.itemShape) {
            if (row[field] === undefined) return `row ${i + 1} is missing "${field}"`;
          }
        }
      }
      return null;
    },
  },
};

module.exports = { TYPES };

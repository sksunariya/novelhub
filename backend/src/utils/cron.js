// Minimal 5-field cron evaluator.
//
// Written rather than pulled in, for the same reason the rest of this codebase
// calls PayPal with native fetch: the whole need is "does this expression match
// this minute", and a dependency for that is more surface than value.
//
//   ┌───────── minute       0-59
//   │ ┌─────── hour         0-23
//   │ │ ┌───── day of month 1-31
//   │ │ │ ┌─── month        1-12
//   │ │ │ │ ┌─ day of week  0-6  (0 = Sunday)
//   * * * * *
//
// Supported per field: *, N, N-M, N-M/S, */S, and comma-separated lists.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
];

const parseField = (raw, { min, max, name }) => {
  const values = new Set();

  for (const part of String(raw).split(',')) {
    const token = part.trim();
    if (!token) throw new Error(`empty ${name} field`);

    const [range, stepRaw] = token.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid step in ${name}: ${token}`);

    let from;
    let to;
    if (range === '*') {
      from = min;
      to = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      from = a;
      to = b;
    } else {
      from = Number(range);
      to = stepRaw === undefined ? from : max; // "5/10" means "from 5, every 10"
    }

    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new Error(`invalid ${name} value: ${token}`);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values;
};

/** Parse an expression into per-field sets. Throws on anything malformed. */
const parseCron = (expression) => {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== FIELDS.length) {
    throw new Error(`cron expression must have ${FIELDS.length} fields, got ${parts.length}`);
  }
  return FIELDS.map((field, index) => ({
    ...field,
    values: parseField(parts[index], field),
    wildcard: parts[index].trim() === '*',
  }));
};

const isValidCron = (expression) => {
  try {
    parseCron(expression);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Does this expression fire at this minute?
 *
 * Follows the standard quirk: when both day-of-month and day-of-week are
 * restricted, either matching is enough (cron ORs them). When only one is
 * restricted, that one must match.
 */
const matches = (expression, date = new Date()) => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parseCron(expression);

  if (!minute.values.has(date.getMinutes())) return false;
  if (!hour.values.has(date.getHours())) return false;
  if (!month.values.has(date.getMonth() + 1)) return false;

  const domMatch = dayOfMonth.values.has(date.getDate());
  const dowMatch = dayOfWeek.values.has(date.getDay());

  if (dayOfMonth.wildcard && dayOfWeek.wildcard) return true;
  if (dayOfMonth.wildcard) return dowMatch;
  if (dayOfWeek.wildcard) return domMatch;
  return domMatch || dowMatch;
};

/** Next firing time at or after `from`, for display in the admin portal. */
const nextRun = (expression, from = new Date()) => {
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  // A year of minutes is a safe ceiling for any valid 5-field expression.
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matches(expression, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
};

module.exports = { parseCron, isValidCron, matches, nextRun };

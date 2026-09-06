import { useState, useEffect } from 'react';
import { Calendar, GitCompareArrows } from 'lucide-react';

/**
 * The window control for every revenue view.
 *
 * One row above the charts, in the order the eye needs it: how far back, how
 * finely, and against what. Presets carry the common cases so the custom
 * inputs — which take four clicks — stay out of the way until they are wanted.
 *
 * Range state lives with the caller rather than here, because three panels read
 * the same window and a picker that owned it would let them drift apart.
 */

export const PRESETS = [
  { id: '7d', label: '7 days', days: 7, granularity: 'day' },
  { id: '30d', label: '30 days', days: 30, granularity: 'day' },
  { id: '90d', label: '90 days', days: 90, granularity: 'week' },
  { id: '12m', label: '12 months', days: 365, granularity: 'month' },
  { id: 'all', label: 'All time', days: 1825, granularity: 'month' },
];

export const DEFAULT_RANGE = { preset: '30d', days: 30, from: '', to: '', granularity: 'day', compare: true };

const GRANULARITIES = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
];

/** Only the keys the API understands, and only when they carry meaning. */
export const toQuery = (range) => ({
  ...(range.from && range.to ? { from: range.from, to: range.to } : { days: range.days }),
  granularity: range.granularity,
  compare: range.compare ? 'true' : 'false',
});

const chip = (active) =>
  `cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:text-silver'
  }`;

const RangePicker = ({ range, onChange, timezone }) => {
  const [custom, setCustom] = useState(Boolean(range.from && range.to));
  const [draft, setDraft] = useState({ from: range.from, to: range.to });

  useEffect(() => {
    setDraft({ from: range.from, to: range.to });
  }, [range.from, range.to]);

  const applyPreset = (preset) => {
    setCustom(false);
    onChange({ ...range, preset: preset.id, days: preset.days, from: '', to: '', granularity: preset.granularity });
  };

  // Applied only once both ends exist; a half-entered range would otherwise
  // fire a query for a window the admin has not finished describing.
  const applyCustom = (next) => {
    setDraft(next);
    if (next.from && next.to && next.from <= next.to) {
      onChange({ ...range, preset: 'custom', from: next.from, to: next.to });
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-3 rounded-xl border border-line bg-night-surface p-3">
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => applyPreset(preset)}
            className={chip(!custom && range.preset === preset.id)}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" onClick={() => setCustom((value) => !value)} className={chip(custom)}>
          <Calendar className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Custom
        </button>
      </div>

      {custom && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(event) => applyCustom({ ...draft, from: event.target.value })}
            aria-label="From date"
            className="rounded-lg border border-line bg-night px-2 py-1 text-xs text-silver [color-scheme:dark]"
          />
          <span className="text-xs text-silver-muted">to</span>
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(event) => applyCustom({ ...draft, to: event.target.value })}
            aria-label="To date"
            className="rounded-lg border border-line bg-night px-2 py-1 text-xs text-silver [color-scheme:dark]"
          />
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <div className="flex items-center gap-1 rounded-full border border-line p-0.5">
          {GRANULARITIES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange({ ...range, granularity: option.id })}
              className={chip(range.granularity === option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...range, compare: !range.compare })}
          title="Compare with the equal-length period immediately before"
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            range.compare
              ? 'border-crimson/40 bg-crimson/10 text-crimson-soft'
              : 'border-line text-silver-muted hover:text-silver'
          }`}
        >
          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
          Compare
        </button>
      </div>

      {timezone && (
        <p className="w-full text-[11px] text-silver-muted">
          Days are counted in {timezone}.
        </p>
      )}
    </div>
  );
};

export default RangePicker;

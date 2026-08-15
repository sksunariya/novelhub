import { Flame, Sparkles, TrendingUp, BarChart3, Swords, Rows3, Rows2, LayoutList } from 'lucide-react';
import { useCommunity } from '../../context/CommunityContext';

// Sticky sort and density bar.
//
// A radiogroup rather than a row of buttons: sorts are mutually exclusive, and
// that is what a radiogroup means to assistive tech. Buttons would announce as
// eight unrelated controls.

const SORTS = [
  { key: 'hot', label: 'Hot', icon: Flame },
  { key: 'new', label: 'New', icon: Sparkles },
  { key: 'top', label: 'Top', icon: BarChart3 },
  { key: 'rising', label: 'Rising', icon: TrendingUp },
  { key: 'controversial', label: 'Controversial', icon: Swords },
];

const TIMEFRAMES = [
  ['hour', 'Past hour'], ['day', 'Today'], ['week', 'This week'],
  ['month', 'This month'], ['year', 'This year'], ['all', 'All time'],
];

const DENSITIES = [
  { key: 'card', label: 'Card', icon: Rows2 },
  { key: 'compact', label: 'Compact', icon: Rows3 },
  { key: 'classic', label: 'Classic', icon: LayoutList },
];

const SortBar = ({ timeframe, onTimeframe }) => {
  const { sort, setSort, density, setDensity } = useCommunity();

  return (
    <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-night-surface/95 p-2 backdrop-blur">
      <div role="radiogroup" aria-label="Sort posts" className="flex flex-wrap gap-1">
        {SORTS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={sort === key}
            onClick={() => setSort(key)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              sort === key ? 'bg-crimson text-white' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Only meaningful for Top — showing it always would imply the other
          sorts are time-filtered when they are not. */}
      {sort === 'top' && (
        <select
          value={timeframe}
          onChange={(e) => onTimeframe(e.target.value)}
          aria-label="Timeframe"
          className="cursor-pointer rounded-full border border-line bg-night px-3 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none"
        >
          {TIMEFRAMES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      )}

      <div role="radiogroup" aria-label="Feed density" className="ml-auto flex gap-1">
        {DENSITIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={density === key}
            aria-label={label}
            title={label}
            onClick={() => setDensity(key)}
            className={`cursor-pointer rounded p-1.5 transition-colors ${
              density === key ? 'bg-night-raised text-silver' : 'text-silver-muted hover:text-silver'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default SortBar;

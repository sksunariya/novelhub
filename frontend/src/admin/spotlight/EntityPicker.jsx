import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { searchEntities } from '../../api/spotlight';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

// Find something to pin.
//
// The type list comes from the backend registry, so this component never learns
// what a novel or a space is — adding a featurable entity server-side makes it
// appear here with no frontend change. That is the whole reason the registry
// exists rather than a switch statement.
//
// Debounced, and the response is DISCARDED IF STALE. Typing "dragon" fires
// requests for "dra", "drag", "drago"; without the sequence check they can land
// out of order and leave results for "drag" on screen under the word "dragon".

const EntityPicker = ({ types, onPick }) => {
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);

  const pickable = types.filter((t) => !t.standalone);

  useEffect(() => {
    if (!type && pickable.length) setType(pickable[0].key);
  }, [type, pickable]);

  useEffect(() => {
    if (!type) return undefined;
    const mine = ++sequence.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchEntities(type, query)
        .then((data) => {
          if (mine !== sequence.current) return; // a later keystroke already won
          setResults(data.results || []);
        })
        .catch(() => { if (mine === sequence.current) setResults([]); })
        .finally(() => { if (mine === sequence.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [type, query]);

  return (
    <div className="rounded-lg border border-line bg-night-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sm:w-40">
          <span className="sr-only">What to search</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            {pickable.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, or leave blank for the top results"
            aria-label="Search for something to feature"
            className={`${inputClass} pl-9`}
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-silver-muted" aria-hidden="true" />
          )}
        </div>
      </div>

      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto" aria-live="polite">
        {results.map((result) => (
          <li key={`${result.type}:${result.refId}`}>
            <button
              type="button"
              onClick={() => onPick(result)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-crimson/40 hover:bg-night-raised"
            >
              {result.thumb ? (
                <img src={result.thumb} alt="" aria-hidden="true" className="h-10 w-8 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-10 w-8 shrink-0 rounded bg-night-raised" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-silver">{result.label}</span>
                {result.subtitle && (
                  <span className="block truncate text-xs text-silver-muted">{result.subtitle}</span>
                )}
              </span>
              <Plus className="h-4 w-4 shrink-0 text-crimson" aria-hidden="true" />
            </button>
          </li>
        ))}
        {!loading && !results.length && (
          <li className="p-2 text-sm text-silver-muted">Nothing found.</li>
        )}
      </ul>
    </div>
  );
};

export default EntityPicker;

import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { searchConfig } from '../../api/adminConfig';

/**
 * Command palette over the settings registry.
 *
 * With this many settings, search is how anyone finds anything — it is not a
 * nicety. Backed by the same registry index the server exposes, so it matches
 * on key, label and help text without the frontend duplicating any of it.
 */
const SettingsSearch = ({ open, onClose, onPick }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await searchConfig(query.trim());
        setResults(data.results || []);
        setActive(0);
      } catch (error) {
        setResults([]);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  const onKeyDown = (event) => {
    if (event.key === 'Escape') return onClose();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      return setActive((i) => Math.min(i + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      return setActive((i) => Math.max(i - 1, 0));
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      return onPick(results[active].key);
    }
    return undefined;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-night-surface shadow-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Search settings"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-silver-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search all settings..."
            aria-label="Search settings"
            className="w-full bg-transparent text-sm text-silver placeholder:text-silver-muted focus:outline-none"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto">
          {results.map((row, index) => (
            <li key={row.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => onPick(row.key)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                  index === active ? 'bg-crimson/10' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-silver">{row.label}</span>
                  <span className="block truncate text-[11px] text-silver-muted">{row.key}</span>
                </span>
                {row.value !== undefined && (
                  <span className="shrink-0 truncate text-xs text-silver-muted">
                    {typeof row.value === 'object' ? '…' : String(row.value)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {query.trim() && results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-silver-muted">No settings match that.</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default SettingsSearch;

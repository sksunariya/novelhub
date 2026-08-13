import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { searchGrantUsers } from '../api/adminConfig';

const field =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none';

/**
 * Search-and-select for users.
 *
 * Holds the full selected objects rather than bare ids so the chips can show a
 * username without a second round trip — the parent only ever needs the ids,
 * which it reads off `value`.
 */
const UserPicker = ({ value = [], onChange, placeholder = 'Search by username or email' }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounce = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    const query = term.trim();
    clearTimeout(debounce.current);
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const data = await searchGrantUsers(query);
        setResults(data.users || []);
        setOpen(true);
      } catch (error) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [term]);

  // A click outside should dismiss the results, not leave them hovering over
  // the rest of the form.
  useEffect(() => {
    const handler = (event) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const add = useCallback(
    (user) => {
      if (!value.some((picked) => String(picked.id) === String(user.id))) {
        onChange([...value, user]);
      }
      setTerm('');
      setResults([]);
      setOpen(false);
    },
    [value, onChange]
  );

  const remove = (id) => onChange(value.filter((user) => String(user.id) !== String(id)));

  const unpicked = results.filter(
    (user) => !value.some((picked) => String(picked.id) === String(user.id))
  );

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted"
          aria-hidden="true"
        />
        <input
          className={`${field} pl-9`}
          value={term}
          placeholder={placeholder}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      </div>

      {open && (searching || term.trim().length >= 2) && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-night-surface shadow-lg">
          {searching && <li className="px-3 py-2 text-xs text-silver-muted">Searching...</li>}
          {!searching && unpicked.length === 0 && (
            <li className="px-3 py-2 text-xs text-silver-muted">No matching users</li>
          )}
          {!searching &&
            unpicked.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => add(user)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm text-silver hover:bg-night"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.username}</span>
                    <span className="block truncate text-[11px] text-silver-muted">{user.email}</span>
                  </span>
                  {/* What they already hold, so a gift can be judged in context. */}
                  <span className="shrink-0 text-[11px] text-silver-muted">
                    {user.balance.toLocaleString()} cr
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}

      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((user) => (
            <span
              key={user.id}
              className="flex items-center gap-1.5 rounded-full border border-crimson/40 bg-crimson/10 px-2.5 py-1 text-xs text-crimson-soft"
            >
              {user.username}
              <button
                type="button"
                onClick={() => remove(user.id)}
                aria-label={`Remove ${user.username}`}
                className="cursor-pointer text-crimson-soft/70 hover:text-crimson-soft"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserPicker;

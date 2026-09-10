import { useState } from 'react';
import { X, ArrowUp, ArrowDown, Trash2, Save, Sparkles } from 'lucide-react';
import EntityPicker from './EntityPicker';
import { ICON_NAMES, ACCENT_NAMES, iconFor, accentFor } from '../../components/home/railStyle';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';
const labelClass = 'block text-sm text-silver-muted';

const LAYOUTS = [
  { value: 'carousel', label: 'Carousel', help: 'A scrolling row. The default, and right for anything with more than four items.' },
  { value: 'grid', label: 'Grid', help: 'Everything visible at once. Best for posts, which are read rather than browsed.' },
  { value: 'spotlight', label: 'Spotlight', help: 'One item, given real room. Uses only the first thing in the rail.' },
  { value: 'poll', label: 'Poll', help: 'A poll, answerable without leaving the homepage. Needs a rail that resolves to a poll post.' },
  { value: 'pulse', label: 'Activity strip', help: 'The live ticker. Carries no items of its own — its content is real site activity.' },
  { value: 'banner', label: 'Banner', help: 'A full-width message with one button. For announcements and campaigns.' },
];

const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'anon', label: 'Signed out only' },
  { value: 'authed', label: 'Signed in only' },
  { value: 'members', label: 'Members of a space' },
  { value: 'non_members', label: 'Signed in, not in any space' },
];

// The audience worth explaining, because it is the one that does real work.
const AUDIENCE_HELP = {
  non_members: 'The best place for "find your first space". Nobody who has already joined one will see it.',
  anon: 'Only visitors who are not signed in. Use it for the pitch you would not show a regular.',
  members: 'Only people who belong to at least one space.',
};

/** A datetime-local input needs "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO string. */
const toLocalInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const RailEditor = ({ rail, types, onSave, onCancel, saving }) => {
  const [form, setForm] = useState(() => ({
    title: rail.title || '',
    subtitle: rail.subtitle || '',
    icon: rail.icon || 'Sparkles',
    accent: rail.accent || 'crimson',
    layout: rail.layout || 'carousel',
    source: rail.source || 'auto',
    audience: rail.audience || 'all',
    maxItems: rail.maxItems || 12,
    viewAllUrl: rail.viewAllUrl || '',
    viewAllLabel: rail.viewAllLabel || 'View all',
    isActive: rail.isActive !== false,
    startAt: toLocalInput(rail.startAt),
    endAt: toLocalInput(rail.endAt),
    items: rail.items || [],
    query: {
      kind: 'novels', novelSort: 'trending', novelStatus: '', genre: '',
      feedSort: 'hot', timeframe: 'week', minScore: 0, postType: '',
      spaceSort: 'active', featuredOnly: false,
      linkedType: 'novel', followTrending: true,
      ...(rail.query || {}),
    },
  }));

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setQuery = (patch) => setForm((prev) => ({ ...prev, query: { ...prev.query, ...patch } }));

  const addItem = (result) => {
    if (form.items.some((item) => String(item.refId) === String(result.refId) && item.type === result.type)) return;
    set({
      items: [...form.items, {
        type: result.type, refId: result.refId, label: result.label,
        thumb: result.thumb || '', url: result.url || '', note: '', badge: '',
        order: form.items.length,
      }],
    });
  };

  const moveItem = (index, direction) => {
    const next = [...form.items];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ items: next.map((item, i) => ({ ...item, order: i })) });
  };

  const patchItem = (index, patch) =>
    set({ items: form.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });

  const removeItem = (index) =>
    set({ items: form.items.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i })) });

  const submit = (event) => {
    event.preventDefault();
    onSave({
      ...form,
      maxItems: Number(form.maxItems) || 12,
      // Empty string is not a date. Sending one stores an Invalid Date, which
      // then compares false against every window and silently hides the rail.
      startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
      endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      query: { ...form.query, minScore: Number(form.query.minScore) || 0 },
    });
  };

  const Icon = iconFor(form.icon);
  const accent = accentFor(form.accent);
  const isPulse = form.layout === 'pulse';

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-line bg-night-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-silver">
          <Icon className={`h-5 w-5 ${accent.text}`} aria-hidden="true" />
          {rail._id ? 'Edit rail' : 'New rail'}
        </h3>
        <button type="button" onClick={onCancel} aria-label="Close editor"
          className="cursor-pointer rounded p-1 text-silver-muted hover:bg-night-raised hover:text-silver">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* ---------------------------------------------------------- identity */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Title
          <input value={form.title} onChange={(e) => set({ title: e.target.value })}
            required maxLength={80} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Subtitle <span className="text-xs">(optional)</span>
          <input value={form.subtitle} onChange={(e) => set({ subtitle: e.target.value })}
            maxLength={200} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Icon
          <select value={form.icon} onChange={(e) => set({ icon: e.target.value })} className={`${inputClass} mt-1`}>
            {ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Accent
          <select value={form.accent} onChange={(e) => set({ accent: e.target.value })} className={`${inputClass} mt-1`}>
            {ACCENT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      {/* ------------------------------------------------------------ layout */}
      <div>
        <span className={labelClass}>Layout</span>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {LAYOUTS.map((option) => (
            <label key={option.value}
              className={`cursor-pointer rounded-lg border p-2.5 text-xs transition-colors ${
                form.layout === option.value ? `${accent.border} ${accent.bg}` : 'border-line hover:border-crimson/40'
              }`}>
              <input type="radio" name="layout" value={option.value} className="sr-only"
                checked={form.layout === option.value} onChange={() => set({ layout: option.value })} />
              <span className="block font-semibold text-silver">{option.label}</span>
              <span className="mt-0.5 block leading-snug text-silver-muted">{option.help}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------ source */}
      {!isPulse && (
        <div>
          <span className={labelClass}>Where the contents come from</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-lg border p-2.5 text-xs transition-colors ${
              form.source === 'manual' ? `${accent.border} ${accent.bg}` : 'border-line hover:border-crimson/40'}`}>
              <input type="radio" name="source" className="sr-only"
                checked={form.source === 'manual'} onChange={() => set({ source: 'manual' })} />
              <span className="block font-semibold text-silver">Hand-picked</span>
              <span className="mt-0.5 block leading-snug text-silver-muted">
                You choose exactly what appears, in order. Stays put until you change it — which also means it goes stale if you don't.
              </span>
            </label>
            <label className={`cursor-pointer rounded-lg border p-2.5 text-xs transition-colors ${
              form.source === 'auto' ? `${accent.border} ${accent.bg}` : 'border-line hover:border-crimson/40'}`}>
              <input type="radio" name="source" className="sr-only"
                checked={form.source === 'auto'} onChange={() => set({ source: 'auto' })} />
              <span className="block font-semibold text-silver">Automatic</span>
              <span className="mt-0.5 block leading-snug text-silver-muted">
                Refills itself from a query every time the page loads. Never stale, never exactly what you would have chosen.
              </span>
            </label>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ manual items */}
      {!isPulse && form.source === 'manual' && (
        <div className="space-y-3">
          <EntityPicker types={types} onPick={addItem} />

          {form.items.length > 0 ? (
            <ol className="space-y-2">
              {form.items.map((item, index) => (
                <li key={`${item.type}:${item.refId}:${index}`}
                  className="flex items-start gap-2 rounded-lg border border-line bg-night p-2">
                  <span className="mt-1 w-5 shrink-0 text-center text-xs text-silver-muted">{index + 1}</span>
                  {item.thumb
                    ? <img src={item.thumb} alt="" aria-hidden="true" className="h-12 w-9 shrink-0 rounded object-cover" />
                    : <span className="h-12 w-9 shrink-0 rounded bg-night-raised" aria-hidden="true" />}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-sm text-silver">
                      {item.label}
                      <span className="ml-1.5 rounded bg-night-raised px-1.5 py-0.5 text-xs text-silver-muted">{item.type}</span>
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      <input value={item.note} onChange={(e) => patchItem(index, { note: e.target.value })}
                        placeholder="Why it's here — shown on the card" maxLength={300}
                        aria-label={`Note for ${item.label}`} className={inputClass} />
                      <input value={item.badge} onChange={(e) => patchItem(index, { badge: e.target.value })}
                        placeholder="Badge (optional)" maxLength={40}
                        aria-label={`Badge for ${item.label}`} className={inputClass} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0}
                      aria-label={`Move ${item.label} up`}
                      className="cursor-pointer rounded p-1 text-silver-muted hover:bg-night-raised hover:text-silver disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => moveItem(index, 1)} disabled={index === form.items.length - 1}
                      aria-label={`Move ${item.label} down`}
                      className="cursor-pointer rounded p-1 text-silver-muted hover:bg-night-raised hover:text-silver disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => removeItem(index)}
                      aria-label={`Remove ${item.label}`}
                      className="cursor-pointer rounded p-1 text-silver-muted hover:bg-night-raised hover:text-rose-400">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-lg border border-dashed border-line p-3 text-sm text-silver-muted">
              Nothing pinned yet. A hand-picked rail with no items does not render at all.
            </p>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- auto query */}
      {!isPulse && form.source === 'auto' && (
        <div className="space-y-3 rounded-lg border border-line bg-night p-3">
          <label className={labelClass}>
            What to pull
            <select value={form.query.kind} onChange={(e) => setQuery({ kind: e.target.value })}
              className={`${inputClass} mt-1`}>
              <option value="novels">Novels</option>
              <option value="posts">Community posts</option>
              <option value="spaces">Spaces</option>
              <option value="linked_posts">Discussion about a novel</option>
            </select>
          </label>

          {form.query.kind === 'novels' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelClass}>
                Order by
                <select value={form.query.novelSort} onChange={(e) => setQuery({ novelSort: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  <option value="featured">Marked featured</option>
                  <option value="trending">Trending this week</option>
                  <option value="popular">Most read</option>
                  <option value="rating">Highest rated</option>
                  <option value="newest">Newest</option>
                  <option value="updated">Recently updated</option>
                </select>
              </label>
              <label className={labelClass}>
                Status
                <select value={form.query.novelStatus} onChange={(e) => setQuery({ novelStatus: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  <option value="">Any</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                  <option value="hiatus">Hiatus</option>
                </select>
              </label>
              <label className={labelClass}>
                Genre
                <input value={form.query.genre} onChange={(e) => setQuery({ genre: e.target.value })}
                  placeholder="Any" className={`${inputClass} mt-1`} />
              </label>
            </div>
          )}

          {form.query.kind === 'posts' && (
            <div className="grid gap-3 sm:grid-cols-4">
              <label className={labelClass}>
                Sort
                <select value={form.query.feedSort} onChange={(e) => setQuery({ feedSort: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  <option value="hot">Hot</option>
                  <option value="new">New</option>
                  <option value="top">Top</option>
                  <option value="rising">Rising</option>
                </select>
              </label>
              <label className={labelClass}>
                Window
                <select value={form.query.timeframe} onChange={(e) => setQuery({ timeframe: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  {['day', 'week', 'month', 'year', 'all'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Type
                <select value={form.query.postType} onChange={(e) => setQuery({ postType: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  <option value="">Any</option>
                  <option value="text">Text</option>
                  <option value="image">Image</option>
                  <option value="link">Link</option>
                  <option value="poll">Poll</option>
                </select>
              </label>
              <label className={labelClass}>
                Min score
                <input type="number" min={0} value={form.query.minScore}
                  onChange={(e) => setQuery({ minScore: e.target.value })} className={`${inputClass} mt-1`} />
              </label>
              <p className="text-xs text-silver-muted sm:col-span-4">
                Only ever pulls from spaces that are already public and in good standing — a quarantined space
                cannot reach the homepage through this.
              </p>
            </div>
          )}

          {form.query.kind === 'spaces' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Order by
                <select value={form.query.spaceSort} onChange={(e) => setQuery({ spaceSort: e.target.value })}
                  className={`${inputClass} mt-1`}>
                  <option value="active">Most active this week</option>
                  <option value="members">Largest</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
              <label className="flex items-end gap-2 text-sm text-silver-muted">
                <input type="checkbox" checked={form.query.featuredOnly}
                  onChange={(e) => setQuery({ featuredOnly: e.target.checked })}
                  className="h-4 w-4 accent-red-600" />
                Only spaces marked featured
              </label>
            </div>
          )}

          {form.query.kind === 'linked_posts' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-silver-muted">
                <input type="checkbox" checked={form.query.followTrending}
                  onChange={(e) => setQuery({ followTrending: e.target.checked })}
                  className="h-4 w-4 accent-red-600" />
                Follow whatever is trending
              </label>
              <p className="text-xs text-silver-muted">
                Finds the most-read novel that actually has discussion attached, and shows that discussion.
                This is the row that turns a reader into a member: it is about the thing they were already reading,
                not a general invitation to a forum.
              </p>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------- audience and scheduling */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Who sees it
          <select value={form.audience} onChange={(e) => set({ audience: e.target.value })}
            className={`${inputClass} mt-1`}>
            {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          {AUDIENCE_HELP[form.audience] && (
            <span className="mt-1 block text-xs text-silver-muted">{AUDIENCE_HELP[form.audience]}</span>
          )}
        </label>
        <label className={labelClass}>
          Live from <span className="text-xs">(optional)</span>
          <input type="datetime-local" value={form.startAt}
            onChange={(e) => set({ startAt: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Live until <span className="text-xs">(optional)</span>
          <input type="datetime-local" value={form.endAt}
            onChange={(e) => set({ endAt: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Max items
          <input type="number" min={1} max={40} value={form.maxItems}
            onChange={(e) => set({ maxItems: e.target.value })} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          "View all" link <span className="text-xs">(optional)</span>
          <input value={form.viewAllUrl} onChange={(e) => set({ viewAllUrl: e.target.value })}
            placeholder="/browse" className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          "View all" label
          <input value={form.viewAllLabel} onChange={(e) => set({ viewAllLabel: e.target.value })}
            maxLength={40} className={`${inputClass} mt-1`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm text-silver-muted">
          <input type="checkbox" checked={form.isActive}
            onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4 accent-red-600" />
          Live on the homepage
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-crimson px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-60">
            <Save className="h-4 w-4" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save rail'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default RailEditor;

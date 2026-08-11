// Per-novel pricing, for the novel editor.
//
// Mirrors ReadingGateFields: an `override` switch decides whether any of this
// applies at all. Without that switch, opening a novel in the editor would pin
// it to whatever the site defaults happened to be that day — and a later change
// to the global price would silently skip every novel ever edited.

export const DEFAULT_MONETIZATION = {
  monetized: true,
  freeChapterCount: 0,
  defaultChapterPriceCredits: 0,
  freeAfterDays: 0,
};

export const EMPTY_MONETIZATION = { ...DEFAULT_MONETIZATION, override: false };

/** Model shape → form shape. */
export const toMonetizationForm = (monetization) => ({
  ...DEFAULT_MONETIZATION,
  monetized: monetization?.monetized !== false,
  freeChapterCount: monetization?.freeChapterCount ?? 0,
  defaultChapterPriceCredits: monetization?.defaultChapterPriceCredits ?? 0,
  freeAfterDays: monetization?.freeAfterDays ?? 0,
  override: Boolean(monetization?.override),
});

/** Form shape → request body. Numbers are coerced here so the API never guesses. */
export const monetizationPayload = (form) => ({
  override: Boolean(form.override),
  monetized: Boolean(form.monetized),
  freeChapterCount: Number(form.freeChapterCount) || 0,
  defaultChapterPriceCredits: Number(form.defaultChapterPriceCredits) || 0,
  freeAfterDays: Number(form.freeAfterDays) || 0,
});

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const MonetizationFields = ({ value, onChange, creditLabel = 'credits' }) => {
  const set = (key, numeric = false) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    onChange({ ...value, [key]: numeric ? Number(raw) : raw });
  };

  return (
    <div className="rounded-xl border border-line bg-night p-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-silver">
        <input
          type="checkbox"
          checked={Boolean(value.override)}
          onChange={set('override')}
          className="accent-[var(--color-primary)]"
        />
        Price this novel differently
      </label>
      <p className="mt-1 text-xs text-silver-muted">
        Off means it follows the site-wide pricing in Settings → Monetization.
      </p>

      {value.override && (
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
            <input
              type="checkbox"
              checked={Boolean(value.monetized)}
              onChange={set('monetized')}
              className="accent-[var(--color-primary)]"
            />
            Charge for this novel
          </label>

          {value.monetized && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-silver-muted">First chapters free</span>
                <input
                  type="number"
                  min="0"
                  value={value.freeChapterCount}
                  onChange={set('freeChapterCount', true)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-silver-muted">Price per chapter</span>
                <input
                  type="number"
                  min="0"
                  value={value.defaultChapterPriceCredits}
                  onChange={set('defaultChapterPriceCredits', true)}
                  className={inputClass}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-silver-muted">Free after (days)</span>
                <input
                  type="number"
                  min="0"
                  value={value.freeAfterDays}
                  onChange={set('freeAfterDays', true)}
                  className={inputClass}
                  placeholder="0 = never"
                />
              </label>
            </div>
          )}

          {value.monetized && (
            <p className="text-xs text-silver-muted">
              Chapters {Number(value.freeChapterCount) + 1} and up cost{' '}
              {Number(value.defaultChapterPriceCredits) || 0} {creditLabel}, unless a chapter sets its own price.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MonetizationFields;

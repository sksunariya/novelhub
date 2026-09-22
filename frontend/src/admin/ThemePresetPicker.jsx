import { Check } from 'lucide-react';
import { THEME_PRESETS, matchPreset } from '../theme/presets';

// Palette picker for the settings page.
//
// A miniature of the site rather than five dots: a page background with a card
// on it, a line of body text, a line of accent text and a brand button. That is
// what an admin is actually choosing between, and it makes an unusable
// combination obvious before it reaches a reader.

const Swatch = ({ colors }) => (
  <span
    className="flex h-16 items-center gap-2 rounded-lg p-2 ring-1 ring-inset ring-white/10"
    style={{ background: colors.background }}
    aria-hidden="true"
  >
    <span
      className="flex h-full flex-1 flex-col justify-center gap-1.5 rounded-md px-2 ring-1 ring-inset ring-white/5"
      style={{ background: colors.surface }}
    >
      <span className="block h-1.5 w-full rounded-full opacity-80" style={{ background: colors.text }} />
      <span className="block h-1.5 w-2/3 rounded-full" style={{ background: colors.accent }} />
    </span>
    <span
      className="h-7 w-12 shrink-0 rounded-full"
      style={{ background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})` }}
    />
  </span>
);

const ThemePresetPicker = ({ value, onSelect }) => {
  const active = matchPreset(value);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-silver">Presets</p>
        <p className="text-xs text-silver-muted">
          {active ? `Using “${active.name}”` : 'Custom palette'} · previewed here, live for readers when you save
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEME_PRESETS.map((preset) => {
          const selected = active?.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset.colors)}
              aria-pressed={selected}
              className={`cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? 'border-crimson-soft/60 bg-crimson/10 ring-1 ring-inset ring-crimson-soft/40'
                  : 'border-line bg-night hover:border-crimson-soft/40'
              }`}
            >
              <Swatch colors={preset.colors} />
              <span className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-silver">
                {preset.name}
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-crimson-soft" aria-hidden="true" />}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-silver-muted">{preset.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ThemePresetPicker;

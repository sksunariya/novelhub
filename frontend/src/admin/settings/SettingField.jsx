import { useState } from 'react';
import { RotateCcw, Lock, AlertTriangle } from 'lucide-react';

/**
 * Renders any setting from its registry declaration.
 *
 * This is the whole point of the registry: one component switching on `type`,
 * rather than 171 hand-written fields that drift from the backend the first
 * time someone changes a bound. Adding setting number 172 needs no change here.
 */

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const Row = ({ def, isDefault, error, onReset, children }) => (
  <div
    className={`border-l-2 py-3 pl-3 ${
      // A left accent marks anything moved away from its default, so config
      // drift is visible at a glance rather than needing a diff.
      isDefault ? 'border-transparent' : 'border-crimson/60'
    }`}
  >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={def.key} className="flex flex-wrap items-center gap-2 text-sm font-medium text-silver">
          {def.label}
          {def.unit && <span className="text-xs font-normal text-silver-muted">({def.unit})</span>}
          {isDefault && (
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-silver-muted">
              Default
            </span>
          )}
          {def.requiresConfirmation && (
            <span title="Changing this has wide effects">
              <AlertTriangle className="h-3 w-3 text-crimson-soft" aria-hidden="true" />
            </span>
          )}
        </label>
        {def.help && <p className="mt-0.5 text-xs text-silver-muted">{def.help}</p>}
      </div>
      {!isDefault && !def.secret && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to default"
          aria-label={`Reset ${def.label} to default`}
          className="shrink-0 cursor-pointer text-silver-muted transition-colors hover:text-crimson-soft"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>

    <div className="mt-2 max-w-md">{children}</div>
    {error && <p className="mt-1 text-xs text-crimson-soft">{error}</p>}
  </div>
);

const MultiSelect = ({ def, value, onChange }) => {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(value) ? value : [];

  // A declared option set becomes checkboxes; a free list becomes tags.
  if (def.options) {
    return (
      <div className="flex flex-wrap gap-2">
        {def.options.map((option) => {
          const on = list.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(on ? list.filter((v) => v !== option.value) : [...list, option.value])}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                on ? 'border-crimson bg-crimson/15 text-crimson-soft' : 'border-line text-silver-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {list.map((entry) => (
          <span key={entry} className="flex items-center gap-1 rounded-full bg-night-raised px-2 py-0.5 text-xs text-silver">
            {entry}
            <button
              type="button"
              onClick={() => onChange(list.filter((v) => v !== entry))}
              aria-label={`Remove ${entry}`}
              className="cursor-pointer text-silver-muted hover:text-crimson-soft"
            >
              ×
            </button>
          </span>
        ))}
        {list.length === 0 && <span className="text-xs text-silver-muted">Empty</span>}
      </div>
      <input
        type="text"
        value={draft}
        placeholder="Type and press Enter"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !draft.trim()) return;
          event.preventDefault();
          onChange([...list, draft.trim()]);
          setDraft('');
        }}
        className={inputClass}
      />
    </div>
  );
};

const JsonField = ({ def, value, onChange, onValidity }) => {
  const [text, setText] = useState(() => JSON.stringify(value ?? (def.arrayOf ? [] : {}), null, 2));
  const [invalid, setInvalid] = useState(false);

  return (
    <>
      <textarea
        id={def.key}
        rows={Math.min(12, Math.max(4, text.split('\n').length))}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            onChange(JSON.parse(next));
            setInvalid(false);
            onValidity?.(true);
          } catch (error) {
            // Hold the last valid value; the field reports itself unsaveable
            // rather than silently sending malformed JSON.
            setInvalid(true);
            onValidity?.(false);
          }
        }}
        className={`${inputClass} font-mono text-xs ${invalid ? 'border-crimson' : ''}`}
      />
      {invalid && <p className="mt-1 text-xs text-crimson-soft">Not valid JSON yet</p>}
    </>
  );
};

const SettingField = ({ def, value, isDefault, error, onChange, onReset, onValidity }) => {
  if (def.secret) {
    return (
      <Row def={def} isDefault error={error}>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {/* Secrets are never returned, so the UI reports only whether one is set. */}
          <span>{value === true ? 'Configured' : 'Not configured'}</span>
          {def.envVar && <code className="ml-auto text-xs text-silver-muted">{def.envVar}</code>}
        </div>
      </Row>
    );
  }

  const common = { id: def.key, className: inputClass };

  const control = () => {
    switch (def.type) {
      case 'boolean':
        // The knob is positioned from `left`, not from wherever the button's
        // default padding happens to put it. Without an explicit left the
        // browser's own button padding shifts the starting point, and the "on"
        // position ends up past the right edge of the track.
        //
        // Geometry: 44px track, 20px knob, 2px inset each side, so the travel
        // is exactly 20px (translate-x-5) and both ends sit flush.
        return (
          <button
            id={def.key}
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            aria-label={def.label}
            onClick={() => onChange(!value)}
            className={`relative box-border inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-crimson focus-visible:ring-offset-2 focus-visible:ring-offset-night ${
              value ? 'bg-crimson' : 'bg-night-raised border border-line'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                value ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        );

      case 'integer':
      case 'number':
      case 'money_usd_cents':
        return (
          <div className="flex items-center gap-2">
            {def.type === 'money_usd_cents' && <span className="text-sm text-silver-muted">$</span>}
            <input
              {...common}
              type="number"
              value={def.type === 'money_usd_cents' ? (value ?? 0) / 100 : (value ?? '')}
              min={def.type === 'money_usd_cents' && def.min != null ? def.min / 100 : def.min}
              max={def.type === 'money_usd_cents' && def.max != null ? def.max / 100 : def.max}
              step={def.type === 'integer' || def.type === 'money_usd_cents' ? 1 : 'any'}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === '') return onChange('');
                // Money is entered in dollars and stored in integer cents.
                return onChange(
                  def.type === 'money_usd_cents' ? Math.round(Number(raw) * 100) : Number(raw)
                );
              }}
            />
          </div>
        );

      case 'enum':
        return (
          <select {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
            {def.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'multiselect':
        return <MultiSelect def={def} value={value} onChange={onChange} />;

      case 'color':
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value || '#000000'}
              onChange={(event) => onChange(event.target.value)}
              aria-label={def.label}
              className="h-9 w-12 cursor-pointer rounded border border-line bg-night"
            />
            <input {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
          </div>
        );

      case 'text':
        return (
          <textarea
            {...common}
            rows={3}
            maxLength={def.maxLength}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      case 'json':
        return <JsonField def={def} value={value} onChange={onChange} onValidity={onValidity} />;

      case 'cron':
        return (
          <input
            {...common}
            className={`${inputClass} font-mono`}
            placeholder="0 3 * * *"
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        );

      default:
        return (
          <input
            {...common}
            type="text"
            maxLength={def.maxLength}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  };

  return (
    <Row def={def} isDefault={isDefault} error={error} onReset={onReset}>
      {control()}
    </Row>
  );
};

export default SettingField;

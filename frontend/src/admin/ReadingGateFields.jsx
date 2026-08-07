import { Lock } from 'lucide-react';
import {
  GATE_RECURRENCE,
  RECURRENCE_OPTIONS,
  REQUIREMENT_OPTIONS,
} from '../utils/readingGate';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

export const DEFAULT_READING_GATE = {
  loginEnabled: false,
  loginAfterChapter: 0,
  engagementEnabled: false,
  engagementAfterChapter: 0,
  recurrence: GATE_RECURRENCE.ONCE,
  everyChapters: 10,
  chapterNumbers: [],
  requirements: [],
  escalateAfterChapter: 0,
  escalatedRequirements: [],
  message: '',
};

export const toGateForm = (gate) => ({ ...DEFAULT_READING_GATE, ...(gate || {}) });

export const gatePayload = (gate) => ({
  ...gate,
  chapterNumbers: Array.isArray(gate.chapterNumbers) ? gate.chapterNumbers.join(',') : gate.chapterNumbers,
});

const RequirementChecklist = ({ legend, hint, selected, onToggle }) => (
  <fieldset>
    <legend className="mb-1 block text-sm font-medium text-silver">{legend}</legend>
    {hint && <p className="mb-2 text-xs text-silver-muted">{hint}</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      {REQUIREMENT_OPTIONS.map((option) => (
        <label key={option.key} className="flex cursor-pointer items-center gap-2 text-sm text-silver-muted">
          <input
            type="checkbox"
            checked={selected.includes(option.key)}
            onChange={() => onToggle(option.key)}
            className="accent-[var(--color-primary)]"
          />
          {option.label}
        </label>
      ))}
    </div>
  </fieldset>
);

const ReadingGateFields = ({ gate, onChange, showOverride, idPrefix }) => {
  const field = (name) => `${idPrefix}-${name}`;
  const numberChange = (name) => (e) => onChange({ [name]: Math.max(parseInt(e.target.value, 10) || 0, 0) });

  const toggleIn = (listName) => (key) => {
    const current = gate[listName] || [];
    onChange({
      [listName]: current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    });
  };

  const activeRecurrence = RECURRENCE_OPTIONS.find((option) => option.key === gate.recurrence);
  const disabled = showOverride && !gate.override;

  return (
    <div className="space-y-4">
      {showOverride && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
          <input
            type="checkbox"
            checked={Boolean(gate.override)}
            onChange={(e) => onChange({ override: e.target.checked })}
            className="accent-[var(--color-primary)]"
          />
          Override the site-wide reading gate for this novel
        </label>
      )}

      <div className={disabled ? 'pointer-events-none space-y-4 opacity-50' : 'space-y-4'}>
        <div className="space-y-2 rounded-lg border border-line p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-silver">
            <input
              type="checkbox"
              checked={Boolean(gate.loginEnabled)}
              onChange={(e) => onChange({ loginEnabled: e.target.checked })}
              className="accent-[var(--color-primary)]"
            />
            Require an account to keep reading
          </label>
          {gate.loginEnabled && (
            <div>
              <label htmlFor={field('login-after')} className="mb-1 block text-xs text-silver-muted">
                Free chapters before login is required (0 = from the first chapter)
              </label>
              <input
                id={field('login-after')}
                type="number"
                min={0}
                value={gate.loginAfterChapter}
                onChange={numberChange('loginAfterChapter')}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-line p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-silver">
            <input
              type="checkbox"
              checked={Boolean(gate.engagementEnabled)}
              onChange={(e) => onChange({ engagementEnabled: e.target.checked })}
              className="accent-[var(--color-primary)]"
            />
            Require a comment or review to keep reading
          </label>

          {gate.engagementEnabled && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={field('engagement-after')} className="mb-1 block text-xs text-silver-muted">
                    Free chapters before the first gate
                  </label>
                  <input
                    id={field('engagement-after')}
                    type="number"
                    min={0}
                    value={gate.engagementAfterChapter}
                    onChange={numberChange('engagementAfterChapter')}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={field('recurrence')} className="mb-1 block text-xs text-silver-muted">
                    How often to ask
                  </label>
                  <select
                    id={field('recurrence')}
                    value={gate.recurrence}
                    onChange={(e) => onChange({ recurrence: e.target.value })}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {RECURRENCE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {activeRecurrence && <p className="text-xs text-silver-muted">{activeRecurrence.hint}</p>}

              {gate.recurrence === GATE_RECURRENCE.EVERY && (
                <div>
                  <label htmlFor={field('every')} className="mb-1 block text-xs text-silver-muted">
                    Ask every N chapters
                  </label>
                  <input
                    id={field('every')}
                    type="number"
                    min={1}
                    value={gate.everyChapters}
                    onChange={numberChange('everyChapters')}
                    className={inputClass}
                  />
                </div>
              )}

              {gate.recurrence === GATE_RECURRENCE.CHAPTERS && (
                <div>
                  <label htmlFor={field('chapter-numbers')} className="mb-1 block text-xs text-silver-muted">
                    Gate chapter numbers (comma separated)
                  </label>
                  <input
                    id={field('chapter-numbers')}
                    value={
                      Array.isArray(gate.chapterNumbers) ? gate.chapterNumbers.join(', ') : gate.chapterNumbers || ''
                    }
                    onChange={(e) => onChange({ chapterNumbers: e.target.value })}
                    placeholder="5, 12, 30"
                    className={inputClass}
                  />
                </div>
              )}

              <RequirementChecklist
                legend="Required actions"
                selected={gate.requirements || []}
                onToggle={toggleIn('requirements')}
              />

              <div>
                <label htmlFor={field('escalate-after')} className="mb-1 block text-xs text-silver-muted">
                  Switch to a stricter set after chapter (0 = never)
                </label>
                <input
                  id={field('escalate-after')}
                  type="number"
                  min={0}
                  value={gate.escalateAfterChapter}
                  onChange={numberChange('escalateAfterChapter')}
                  className={inputClass}
                />
              </div>

              {gate.escalateAfterChapter > 0 && (
                <RequirementChecklist
                  legend="Required actions past that chapter"
                  hint="Leave empty to keep using the set above."
                  selected={gate.escalatedRequirements || []}
                  onToggle={toggleIn('escalatedRequirements')}
                />
              )}
            </div>
          )}
        </div>

        <div>
          <label htmlFor={field('message')} className="mb-1 block text-sm font-medium text-silver">
            Message shown on the lock screen
          </label>
          <input
            id={field('message')}
            value={gate.message || ''}
            onChange={(e) => onChange({ message: e.target.value })}
            placeholder="Leave empty to use the default wording"
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
};

export const ReadingGateSection = ({ children }) => (
  <section className="rounded-xl border border-line bg-night-surface p-5">
    <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-silver">
      <Lock className="h-4 w-4 text-crimson" aria-hidden="true" /> Reading Gate
    </h2>
    {children}
  </section>
);

export default ReadingGateFields;

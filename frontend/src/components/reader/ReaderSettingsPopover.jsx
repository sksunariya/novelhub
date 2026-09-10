import { useEffect, useRef } from 'react';

/**
 * Background and text controls, hung off the "Aa" button in the reader's top
 * bar. These used to live in the same slide-in panel as the chapter list, which
 * meant covering the page you were adjusting: you could not see what a font
 * size did until you dismissed the thing that set it. A popover leaves the
 * prose visible behind it.
 */
const ReaderSettingsPopover = ({ settings, onChange, themes, fonts, onClose }) => {
  const ref = useRef(null);

  useEffect(() => {
    // `mousedown` rather than `click`: a click that starts inside the popover
    // and ends outside (dragging a slider past its track) would otherwise close
    // it mid-adjustment.
    const onPointerDown = (event) => {
      if (ref.current?.contains(event.target)) return;
      // The "Aa" button toggles this popover itself. Without exempting it, the
      // mousedown closes the popover and the click that follows reopens it, so
      // the button appears dead.
      if (event.target?.closest?.('[data-reader-settings-toggle]')) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const set = (patch) => onChange((current) => ({ ...current, ...patch }));
  const active = themes[settings.theme] || themes.dark;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Reading settings"
      className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] space-y-5 rounded-2xl border p-4"
      style={{
        backgroundColor: active.surface,
        borderColor: active.border,
        color: active.text,
        boxShadow: active.shadow,
      }}
    >
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Background</p>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(themes).map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => set({ theme: key })}
              aria-pressed={settings.theme === key}
              className={`cursor-pointer rounded-lg border-2 p-2 text-center text-[11px] font-medium transition-colors ${
                settings.theme === key ? 'border-crimson' : 'border-transparent'
              }`}
              style={{
                backgroundColor: value.background,
                color: value.text,
                // Without an outline the black swatch is invisible on a black
                // popover and the light one on a light popover.
                boxShadow: settings.theme === key ? 'none' : `inset 0 0 0 1px ${active.border}`,
              }}
            >
              {value.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">Typeface</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(fonts).map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => set({ font: key })}
              aria-pressed={settings.font === key}
              className={`cursor-pointer rounded-lg border-2 py-2 text-sm transition-colors ${
                settings.font === key ? 'border-crimson font-semibold' : 'border-transparent opacity-70'
              }`}
              style={{
                fontFamily: value.css,
                boxShadow: settings.font === key ? 'none' : `inset 0 0 0 1px ${active.border}`,
              }}
            >
              {value.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="reader-font-size" className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide opacity-60">
          <span>Text size</span>
          <span className="tabular-nums normal-case opacity-80">{settings.fontSize}px</span>
        </label>
        <input
          id="reader-font-size"
          type="range"
          min="14"
          max="28"
          value={settings.fontSize}
          onChange={(event) => set({ fontSize: Number(event.target.value) })}
          className="w-full cursor-pointer accent-[var(--color-primary)]"
        />
      </div>

      <div>
        <label htmlFor="reader-line-height" className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide opacity-60">
          <span>Line spacing</span>
          <span className="tabular-nums normal-case opacity-80">{settings.lineHeight}</span>
        </label>
        <input
          id="reader-line-height"
          type="range"
          min="1.4"
          max="2.4"
          step="0.1"
          value={settings.lineHeight}
          onChange={(event) => set({ lineHeight: Number(event.target.value) })}
          className="w-full cursor-pointer accent-[var(--color-primary)]"
        />
      </div>
    </div>
  );
};

export default ReaderSettingsPopover;

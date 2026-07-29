import { useEffect, useRef } from 'react';

/**
 * Segmented one-time-code input. Controlled via `value` (string of digits) and
 * `onChange(nextValue)`. Supports auto-advance, backspace-to-previous, arrow
 * navigation, and pasting a full code into any box.
 */
const OtpInput = ({ value = '', onChange, length = 6, disabled = false, autoFocus = true }) => {
  const refs = useRef([]);
  const digits = value.split('').concat(Array(length).fill('')).slice(0, length);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const update = (next) => onChange(next.join('').replace(/\D/g, '').slice(0, length));

  const handleChange = (i) => (e) => {
    const typed = e.target.value.replace(/\D/g, '');
    if (!typed) return;
    const next = [...digits];
    next[i] = typed[typed.length - 1];
    update(next);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
        update(next);
      } else if (i > 0) {
        next[i - 1] = '';
        update(next);
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    const next = Array(length).fill('');
    pasted.split('').forEach((d, idx) => { next[idx] = d; });
    update(next);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          value={digit}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${i + 1}`}
          className={`h-12 w-11 rounded-xl border bg-night text-center font-display text-xl font-bold text-silver outline-none transition-all sm:h-14 sm:w-12 sm:text-2xl ${
            digit ? 'border-crimson shadow-glow' : 'border-line'
          } focus:border-crimson focus:shadow-glow disabled:opacity-50`}
        />
      ))}
    </div>
  );
};

export default OtpInput;

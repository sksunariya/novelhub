// WCAG contrast validation for space accent colours.
//
// A space owner picks `theme.primary` and it overrides `--color-primary` inside
// that space's routes. Without a check, an owner can pick a pale yellow, and
// every button, vote arrow and active tab in their space becomes unreadable.
//
// The liability is the platform's, not theirs. The European Accessibility Act
// has been enforceable since June 2025, and "a user chose that colour" is not a
// defence when the platform offered the control.
//
// Validated at save time rather than at render, because rejecting a colour with
// an explanation is far better than silently overriding one — the owner
// understands what happened and picks another.
//
// Contrast ratio per WCAG 2.x:
//   (L1 + 0.05) / (L2 + 0.05), where L is relative luminance and L1 is lighter.
// Thresholds: 4.5:1 normal text, 3:1 large text and UI components.

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_TEXT = 3.0;
const AA_UI_COMPONENT = 3.0;

/** '#dc2626' | 'dc2626' | '#d26' -> { r, g, b } | null */
const parseHex = (value) => {
  if (typeof value !== 'string') return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join('');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
};

/**
 * Relative luminance, per the WCAG definition.
 *
 * The 0.2126/0.7152/0.0722 weights are the human eye's sensitivity to each
 * channel — green dominates, which is why a mid-green looks far brighter than a
 * mid-blue at the same numeric value.
 */
const relativeLuminance = ({ r, g, b }) => {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Contrast ratio between two colours. 1 (identical) to 21 (black on white). */
const contrastRatio = (colorA, colorB) => {
  const a = parseHex(colorA);
  const b = parseHex(colorB);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
};

// The surfaces an accent colour is actually drawn against in this app, from
// frontend/src/index.css. An accent must be legible on all of them, because the
// same token is used for text on the page background and for a button label on
// a raised card.
const SURFACES = {
  background: '#0a0507',
  surface: '#140a0e',
  raised: '#1e1015',
};

// Text drawn ON TOP of the accent, when it is used as a button fill.
const ON_ACCENT = '#ffffff';

/**
 * Validate a space accent colour against every surface it will be used on.
 *
 * @param {string} accent  hex colour
 * @param {object} options
 * @param {number} options.minRatio  defaults to the WCAG AA UI-component threshold
 * @returns {{ ok, ratios, worst, worstAgainst, error }}
 */
const validateAccent = (accent, { minRatio = AA_UI_COMPONENT } = {}) => {
  const parsed = parseHex(accent);
  if (!parsed) {
    return { ok: false, error: 'Use a hex colour like #dc2626' };
  }

  const ratios = {};
  let worst = Infinity;
  let worstAgainst = null;

  for (const [name, surface] of Object.entries(SURFACES)) {
    const ratio = contrastRatio(accent, surface);
    ratios[name] = Math.round(ratio * 100) / 100;
    if (ratio < worst) {
      worst = ratio;
      worstAgainst = name;
    }
  }

  // Also check white text on the accent, since the accent is a button fill.
  const onAccent = contrastRatio(accent, ON_ACCENT);
  ratios.whiteText = Math.round(onAccent * 100) / 100;

  if (worst < minRatio) {
    return {
      ok: false,
      ratios,
      worst: Math.round(worst * 100) / 100,
      worstAgainst,
      error:
        `That colour is too dark to read against the ${worstAgainst} — ` +
        `contrast is ${(Math.round(worst * 100) / 100).toFixed(2)}:1, and ${minRatio}:1 is the minimum. ` +
        'Try a brighter shade.',
    };
  }

  // A warning, not a rejection: a light accent still works as an outline or
  // text colour, it just should not carry white label text.
  const warning =
    onAccent < AA_LARGE_TEXT
      ? 'White text on this colour will be hard to read. It will be used as an outline rather than a fill.'
      : null;

  return {
    ok: true,
    ratios,
    worst: Math.round(worst * 100) / 100,
    worstAgainst,
    warning,
    prefersDarkText: onAccent < AA_LARGE_TEXT,
  };
};

/**
 * Nudge a colour toward legibility rather than rejecting it.
 *
 * Not used by the save path — an owner should be told, not overridden — but
 * useful for the admin bulk-fix tool and for suggesting an alternative in the
 * UI next to the rejection message.
 */
const lightenToRatio = (accent, target = AA_UI_COMPONENT, against = SURFACES.background) => {
  const parsed = parseHex(accent);
  if (!parsed) return null;
  let { r, g, b } = parsed;
  for (let step = 0; step < 40; step += 1) {
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (contrastRatio(hex, against) >= target) return hex;
    r = Math.min(255, Math.round(r + (255 - r) * 0.1) + 1);
    g = Math.min(255, Math.round(g + (255 - g) * 0.1) + 1);
    b = Math.min(255, Math.round(b + (255 - b) * 0.1) + 1);
  }
  return '#ffffff';
};

module.exports = {
  parseHex,
  relativeLuminance,
  contrastRatio,
  validateAccent,
  lightenToRatio,
  SURFACES,
  AA_NORMAL_TEXT,
  AA_LARGE_TEXT,
  AA_UI_COMPONENT,
};

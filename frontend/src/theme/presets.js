import { PALETTE, hexToRgb } from './palette';

// Ready-made palettes offered in Admin -> Settings -> Theme Colors.
//
// Every preset is DARK, because the reader UI is built dark-first: a light
// background would leave the white-on-image badges and the light-on-dark hover
// states unreadable. Each one was checked for contrast against the way the
// colours are actually used — white button text on `primary` (>= 4.5:1),
// `accent` as link text on `background` (>= 4.5:1), body text on both
// surfaces (>= 15:1) and `primary` as an icon colour on `background` (>= 3:1).
// Keep new presets to that bar.
//
// The five colours here are the whole preset: everything else (hover fill,
// gradient partner, raised surface, border, muted text) is derived from them by
// theme/applyTheme.js.

export const THEME_PRESETS = [
  {
    id: 'aurora',
    name: 'Aurora Violet',
    description: 'The a2zNovel default. Near-black violet with a violet-to-magenta brand gradient.',
    colors: { ...PALETTE },
  },
  {
    id: 'crimson',
    name: 'Crimson Noir',
    description: 'The original dark-gothic red on an almost-black ground.',
    colors: { primary: '#dc2626', accent: '#f87171', background: '#0a0507', surface: '#140a0e', text: '#e7e5e4' },
  },
  {
    id: 'ember',
    name: 'Ember Gold',
    description: 'Warm bronze and amber. Reads like lamplight on paper.',
    colors: { primary: '#b45309', accent: '#fbbf24', background: '#100a04', surface: '#1b120a', text: '#f6efe6' },
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    description: 'Cool blue on midnight navy. The calmest of the set.',
    colors: { primary: '#0369a1', accent: '#7dd3fc', background: '#05101a', surface: '#0c1a27', text: '#e8f2fa' },
  },
  {
    id: 'forest',
    name: 'Evergreen',
    description: 'Emerald on forest black. Easy on the eyes for long sessions.',
    colors: { primary: '#047857', accent: '#6ee7b7', background: '#06120d', surface: '#0e1c16', text: '#e9f4ee' },
  },
  {
    id: 'sakura',
    name: 'Sakura Night',
    description: 'Deep pink on plum black. Warm, romance-forward.',
    colors: { primary: '#be185d', accent: '#f9a8d4', background: '#14080f', surface: '#1e0f18', text: '#f8eaf1' },
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Neutral slate greys. The quietest option — covers stay the only colour.',
    colors: { primary: '#5b6b80', accent: '#cbd5e1', background: '#0a0d12', surface: '#131820', text: '#e8edf5' },
  },
];

export const PRESET_KEYS = ['primary', 'accent', 'background', 'surface', 'text'];

/** True when two hex strings describe the same colour ('#FFF' === '#ffffff'). */
export const sameColor = (a, b) => {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return Boolean(left && right && left.every((channel, i) => channel === right[i]));
};

/** The preset matching these five colours, or null when the palette is custom. */
export const matchPreset = (colors = {}) =>
  THEME_PRESETS.find((preset) => PRESET_KEYS.every((key) => sameColor(colors[key], preset.colors[key]))) || null;

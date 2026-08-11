// Pure geometry for the SVG charts.
//
// Kept separate from the components so the maths is inspectable on its own —
// an off-by-one in a scale shows up as a subtly wrong chart, which is worse
// than an obviously broken one.

/** A "nice" axis maximum: 0, 1-2-5 x 10^n above the data. */
export const niceMax = (value) => {
  if (!value || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

/**
 * Map a value to a y pixel. Inverted, because SVG y grows downward.
 */
export const yScale = ({ max, height, padTop = 0, padBottom = 0 }) => {
  const usable = Math.max(1, height - padTop - padBottom);
  const ceiling = max || 1;
  return (value) => padTop + usable - (Math.max(0, Math.min(value, ceiling)) / ceiling) * usable;
};

/**
 * Map an index to an x pixel, centred in its band.
 *
 * Centring matters: with a bar chart the point for index 0 should sit in the
 * middle of the first bar, not on the axis.
 */
export const xScale = ({ count, width, padLeft = 0, padRight = 0 }) => {
  const usable = Math.max(1, width - padLeft - padRight);
  const band = usable / Math.max(1, count);
  return (index) => padLeft + band * index + band / 2;
};

/** Left edge of a band, for bars. */
export const bandX = ({ count, width, padLeft = 0, padRight = 0, ratio = 0.7 }) => {
  const usable = Math.max(1, width - padLeft - padRight);
  const band = usable / Math.max(1, count);
  const barWidth = Math.max(1, band * ratio);
  return {
    barWidth,
    at: (index) => padLeft + band * index + (band - barWidth) / 2,
  };
};

/** An SVG polyline path through the series. */
export const linePath = (values, x, y) =>
  values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');

/** The same line closed to the baseline, for a fill. */
export const areaPath = (values, x, y, baseline) => {
  if (!values.length) return '';
  return `${linePath(values, x, y)} L${x(values.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;
};

/** Evenly spaced tick indices, always including the first and last. */
export const tickIndices = (count, target = 6) => {
  if (count <= target) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / target);
  const ticks = [];
  for (let i = 0; i < count; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== count - 1) ticks.push(count - 1);
  return ticks;
};

export const formatUsd = (cents) => {
  const value = (cents || 0) / 100;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
};

export const formatCount = (value) => {
  const n = value || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

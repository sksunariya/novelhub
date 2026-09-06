import { useState, useMemo } from 'react';
import { niceMax, yScale, xScale, bandX, linePath, areaPath, tickIndices, formatUsd, formatCount } from './chartScale';

/**
 * Revenue over the selected window, with unlocks beneath it.
 *
 * Two stacked panels sharing an x-axis rather than one dual-axis chart. Dollars
 * and unlock counts have no common scale, and drawing them against two y-axes
 * invites reading the crossing point as meaningful when it is an artefact of
 * how the two axes were scaled.
 *
 * The comparison period is the SAME measure at a different time, so it is drawn
 * as a recessive dashed line in the same panel rather than given a second hue —
 * a categorical color would say "different thing" when it means "same thing,
 * earlier".
 */

// Fixed slots, assigned by entity and never cycled. Validated for CVD
// separation and 3:1 contrast against the #140a0e surface.
const REVENUE = '#1baf7a';
const UNLOCKS = '#2a78d6';
const PRIOR = '#6f6a68';

const W = 760;
const H_TOP = 168;
const H_BOTTOM = 96;
const PAD_L = 52;
const PAD_R = 14;

const RevenueChart = ({ series, granularity, compare }) => {
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!series || series.length === 0) return null;
    const revenue = series.map((point) => point.revenueUsdCents || 0);
    const unlocks = series.map((point) => point.unlocks || 0);
    const prior = series.map((point) => point.previous?.revenueUsdCents ?? null);
    const hasPrior = compare && prior.some((value) => value !== null && value !== 0);

    // One scale across both lines, so the comparison is readable as higher or
    // lower rather than merely differently shaped.
    const revenueMax = niceMax(Math.max(...revenue, ...(hasPrior ? prior.map((v) => v || 0) : [0]), 1));
    return { revenue, unlocks, prior, hasPrior, revenueMax, unlockMax: niceMax(Math.max(...unlocks, 1)) };
  }, [series, compare]);

  if (!model) {
    return (
      <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
        No revenue in this period.
      </p>
    );
  }

  const { revenue, unlocks, prior, hasPrior, revenueMax, unlockMax } = model;
  const x = xScale({ count: series.length, width: W, padLeft: PAD_L, padRight: PAD_R });
  const yRevenue = yScale({ max: revenueMax, height: H_TOP, padTop: 10, padBottom: 22 });
  const yUnlocks = yScale({ max: unlockMax, height: H_BOTTOM, padTop: 8, padBottom: 22 });
  const bars = bandX({ count: series.length, width: W, padLeft: PAD_L, padRight: PAD_R, ratio: 0.62 });
  const ticks = tickIndices(series.length, 8);
  const baseline = H_TOP - 22;

  const active = hover !== null ? series[hover] : null;
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-xl border border-line bg-night-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-silver-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: REVENUE }} /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNLOCKS }} /> Unlocks
        </span>
        {hasPrior && (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: PRIOR }} /> Previous period
          </span>
        )}
        <span className="ml-auto capitalize">{granularity}</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H_TOP + H_BOTTOM}`}
          className="w-full min-w-[560px]"
          role="img"
          aria-label={`Revenue by ${granularity} across ${series.length} periods`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Recessive grid: present enough to read a value off, quiet enough
              not to compete with the data. */}
          {gridLines.map((fraction) => (
            <g key={fraction}>
              <line
                x1={PAD_L} x2={W - PAD_R}
                y1={yRevenue(revenueMax * fraction)} y2={yRevenue(revenueMax * fraction)}
                stroke="#2c1a20" strokeWidth="1"
              />
              <text
                x={PAD_L - 8} y={yRevenue(revenueMax * fraction) + 3}
                textAnchor="end" fontSize="9" fill="#a8a29e"
              >
                {formatUsd(revenueMax * fraction)}
              </text>
            </g>
          ))}

          {hasPrior && (
            <path
              d={linePath(prior.map((value) => value || 0), x, yRevenue)}
              fill="none" stroke={PRIOR} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.9"
            />
          )}

          <path d={areaPath(revenue, x, yRevenue, baseline)} fill={REVENUE} opacity="0.14" />
          <path d={linePath(revenue, x, yRevenue)} fill="none" stroke={REVENUE} strokeWidth="2" />

          {/* Markers only where they can be resolved; on a 365-point series
              they would merge into a band. */}
          {series.length <= 40 &&
            revenue.map((value, index) => (
              <circle
                key={index}
                cx={x(index)} cy={yRevenue(value)} r={hover === index ? 4.5 : 3}
                fill={REVENUE} stroke="#140a0e" strokeWidth="2"
              />
            ))}

          {hover !== null && (
            <line
              x1={x(hover)} x2={x(hover)} y1={6} y2={baseline}
              stroke="#a8a29e" strokeWidth="1" strokeDasharray="3 3"
            />
          )}

          {ticks.map((index) => (
            <text
              key={index} x={x(index)} y={H_TOP - 6}
              textAnchor="middle" fontSize="9" fill="#a8a29e"
            >
              {series[index].label}
            </text>
          ))}

          <g transform={`translate(0, ${H_TOP})`}>
            <text x={PAD_L - 8} y={yUnlocks(unlockMax) + 3} textAnchor="end" fontSize="9" fill="#a8a29e">
              {formatCount(unlockMax)}
            </text>
            {unlocks.map((value, index) => {
              const top = yUnlocks(value);
              return (
                <rect
                  key={index}
                  x={bars.at(index)} y={top}
                  width={bars.barWidth} height={Math.max(0, H_BOTTOM - 22 - top)}
                  rx="2" fill={UNLOCKS} opacity={hover === null || hover === index ? 0.85 : 0.4}
                />
              );
            })}
            <text x={PAD_L - 8} y={H_BOTTOM - 20} textAnchor="end" fontSize="9" fill="#a8a29e">0</text>
          </g>

          {/* Full-height hit targets: a 3px line is impossible to hover, and
              this makes every bucket reachable by pointer. */}
          {series.map((point, index) => (
            <rect
              key={point.bucket}
              x={bars.at(index) - 2} y={0}
              width={bars.barWidth + 4} height={H_TOP + H_BOTTOM}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>
      </div>

      <div className="mt-2 min-h-[2.5rem] text-xs">
        {active ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-semibold text-silver">{active.label}</span>
            <span className="text-silver-muted">
              Revenue <span className="tabular-nums text-silver">{formatUsd(active.revenueUsdCents)}</span>
            </span>
            <span className="text-silver-muted">
              Unlocks <span className="tabular-nums text-silver">{formatCount(active.unlocks)}</span>
            </span>
            <span className="text-silver-muted">
              Buyers <span className="tabular-nums text-silver">{formatCount(active.buyers)}</span>
            </span>
            {active.refundedUsdCents > 0 && (
              <span className="text-silver-muted">
                Refunded <span className="tabular-nums text-crimson-soft">{formatUsd(active.refundedUsdCents)}</span>
              </span>
            )}
            {hasPrior && active.previous && (
              <span className="text-silver-muted">
                Previous <span className="tabular-nums">{formatUsd(active.previous.revenueUsdCents)}</span>
              </span>
            )}
          </div>
        ) : (
          <p className="text-silver-muted">Hover a period for its figures.</p>
        )}
      </div>
    </div>
  );
};

export default RevenueChart;

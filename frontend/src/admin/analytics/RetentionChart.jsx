import { useState } from 'react';
import { niceMax, yScale, xScale, bandX, linePath, areaPath, tickIndices, formatUsd, formatCount } from './chartScale';

/**
 * Readers per chapter above, revenue per chapter below, sharing an x-axis.
 *
 * Two stacked panels rather than one dual-axis chart: two different units on
 * one axis invites reading a crossing point as meaningful when it is an
 * artefact of the scales. The paywall marker on both is the whole point — the
 * reader cliff at that line is what says the free run is too short.
 */
const W = 720;
const H_TOP = 150;
const H_BOTTOM = 110;
const PAD_L = 44;
const PAD_R = 12;

const RetentionChart = ({ chapters }) => {
  const [hover, setHover] = useState(null);

  if (!chapters || chapters.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
        No reading recorded for this novel yet.
      </p>
    );
  }

  const readers = chapters.map((c) => c.readers || 0);
  const revenue = chapters.map((c) => c.revenueUsdCents || 0);

  const readerMax = niceMax(Math.max(...readers));
  const revenueMax = niceMax(Math.max(...revenue));

  const x = xScale({ count: chapters.length, width: W, padLeft: PAD_L, padRight: PAD_R });
  const yReaders = yScale({ max: readerMax, height: H_TOP, padTop: 8, padBottom: 20 });
  const yRevenue = yScale({ max: revenueMax, height: H_BOTTOM, padTop: 8, padBottom: 22 });
  const bars = bandX({ count: chapters.length, width: W, padLeft: PAD_L, padRight: PAD_R, ratio: 0.6 });

  const firstPaidIndex = chapters.findIndex((c) => !c.free);
  const paywallX = firstPaidIndex > 0 ? bars.at(firstPaidIndex) - 2 : null;
  const ticks = tickIndices(chapters.length, 8);

  const active = hover !== null ? chapters[hover] : null;

  return (
    <div className="rounded-xl border border-line bg-night-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-silver-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#2a78d6]" /> Unique readers
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#1baf7a]" /> Revenue (paid)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#5f5e5a]" /> Free chapter
        </span>
        {paywallX !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t-2 border-dashed border-crimson" /> Paywall
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H_TOP + H_BOTTOM}`}
        className="w-full"
        role="img"
        aria-label={`Readers and revenue per chapter for ${chapters.length} chapters, with the paywall marked at chapter ${
          firstPaidIndex >= 0 ? chapters[firstPaidIndex].number : 'none'
        }`}
        onMouseLeave={() => setHover(null)}
      >
        {/* readers */}
        <g>
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yReaders(readerMax * fraction)}
              y2={yReaders(readerMax * fraction)}
              stroke="#2c2c2a"
              strokeWidth="1"
            />
          ))}
          {[0, 0.5, 1].map((fraction) => (
            <text
              key={fraction}
              x={PAD_L - 6}
              y={yReaders(readerMax * fraction) + 3}
              textAnchor="end"
              className="fill-current text-[9px] text-silver-muted"
            >
              {formatCount(Math.round(readerMax * fraction))}
            </text>
          ))}
          <path d={areaPath(readers, x, yReaders, yReaders(0))} fill="#2a78d6" opacity="0.12" />
          <path d={linePath(readers, x, yReaders)} fill="none" stroke="#2a78d6" strokeWidth="2" />
        </g>

        {/* revenue */}
        <g transform={`translate(0, ${H_TOP})`}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yRevenue(0)} y2={yRevenue(0)} stroke="#383835" strokeWidth="1" />
          <text x={PAD_L - 6} y={yRevenue(revenueMax) + 3} textAnchor="end" className="fill-current text-[9px] text-silver-muted">
            {formatUsd(revenueMax)}
          </text>
          {chapters.map((chapter, index) => {
            const value = revenue[index];
            const top = yRevenue(value);
            const height = Math.max(value > 0 ? 1 : 0, yRevenue(0) - top);
            return (
              <rect
                key={chapter.chapterId || index}
                x={bars.at(index)}
                y={top}
                width={bars.barWidth}
                height={height}
                rx="1"
                fill={chapter.free ? '#5f5e5a' : '#1baf7a'}
                opacity={hover === null || hover === index ? 1 : 0.45}
              />
            );
          })}
          {ticks.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={H_BOTTOM - 6}
              textAnchor="middle"
              className="fill-current text-[9px] text-silver-muted"
            >
              {chapters[index].number}
            </text>
          ))}
        </g>

        {/* The marker is drawn last so it sits above both panels. */}
        {paywallX !== null && (
          <line
            x1={paywallX}
            x2={paywallX}
            y1="0"
            y2={H_TOP + H_BOTTOM - 18}
            stroke="#e34948"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}

        {/* Invisible hit areas — one per chapter, full height. */}
        {chapters.map((chapter, index) => (
          <rect
            key={`hit-${chapter.chapterId || index}`}
            x={bars.at(index) - 2}
            y="0"
            width={bars.barWidth + 4}
            height={H_TOP + H_BOTTOM}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>

      <div className="mt-2 min-h-[2.5rem] text-xs">
        {active ? (
          <p className="text-silver">
            <span className="font-semibold">Chapter {active.number}</span>
            <span className="text-silver-muted"> · {formatCount(active.readers)} readers</span>
            {active.free ? (
              <span className="text-silver-muted"> · free</span>
            ) : (
              <>
                <span className="text-silver-muted">
                  {' '}
                  · {active.unlocks} unlock{active.unlocks === 1 ? '' : 's'} · {formatUsd(active.revenueUsdCents)}
                </span>
                {active.conversionPct !== null && (
                  <span className="text-silver-muted"> · {active.conversionPct}% converted</span>
                )}
              </>
            )}
          </p>
        ) : (
          <p className="text-silver-muted">Hover a chapter for detail.</p>
        )}
      </div>
    </div>
  );
};

export default RetentionChart;

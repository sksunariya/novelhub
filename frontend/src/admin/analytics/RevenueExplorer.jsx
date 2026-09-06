import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import {
  getRevenueSummary, getRevenueByNovel, getRevenueByChapter, getRevenueByAuthor, revenueExportUrl,
} from '../../api/adminConfig';
import Spinner from '../../components/Spinner';
import RangePicker, { DEFAULT_RANGE, toQuery } from './RangePicker';
import RevenueChart from './RevenueChart';
import { formatUsd, formatCount } from './chartScale';

/**
 * Ranged revenue, per novel and per chapter.
 *
 * Everything on screen answers for the same window, which is why the range
 * lives here and is passed down: three panels each owning their own dates is
 * how a dashboard ends up showing a total that does not match its own table.
 */

/** A period-over-period change. Neutral when there is no baseline to compare. */
const Delta = ({ value, invert = false }) => {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-silver-muted">—</span>;
  }
  if (value === 0) {
    return (
      <span className="flex items-center gap-0.5 text-[11px] text-silver-muted">
        <Minus className="h-3 w-3" aria-hidden="true" /> 0%
      </span>
    );
  }
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`flex items-center gap-0.5 text-[11px] ${good ? 'text-[#1baf7a]' : 'text-crimson-soft'}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {up ? '+' : ''}{value}%
    </span>
  );
};

const Tile = ({ label, value, hint, change, invert }) => (
  <div className="rounded-xl bg-night-surface p-4">
    <p className="text-xs text-silver-muted">{label}</p>
    <div className="mt-1 flex items-baseline gap-2">
      <p className="text-xl font-semibold tabular-nums text-silver">{value}</p>
      {change !== undefined && <Delta value={change} invert={invert} />}
    </div>
    {hint && <p className="mt-0.5 text-[11px] text-silver-muted">{hint}</p>}
  </div>
);

const Th = ({ children, className = '' }) => <th className={`px-3 py-2 ${className}`}>{children}</th>;
const Td = ({ children, className = '' }) => <td className={`px-3 py-2 ${className}`}>{children}</td>;

const Money = ({ cents, change, invert }) => (
  <span className="flex items-center gap-1.5">
    <span className="tabular-nums text-silver">{formatUsd(cents)}</span>
    {change !== undefined && <Delta value={change} invert={invert} />}
  </span>
);

const Summary = ({ data }) => {
  const { totals, readership } = data;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Revenue"
          value={formatUsd(totals.revenueUsdCents)}
          hint="cash actually received"
          change={totals.change?.revenueUsdCents}
        />
        <Tile label="Unlocks" value={formatCount(totals.unlocks)} change={totals.change?.unlocks} />
        <Tile label="Paying readers" value={formatCount(totals.buyers)} change={totals.change?.buyers} />
        <Tile
          label="Revenue per unlock"
          value={formatUsd(totals.arpuUsdCents)}
          change={totals.change?.arpuUsdCents}
        />
        <Tile
          label="Refunded"
          value={formatUsd(totals.refundedUsdCents)}
          hint={totals.refunds ? `${totals.refunds} reversals` : 'none'}
          invert
        />
      </div>

      {/* Face value is the comparison figure, not revenue. Shown next to the
          real number precisely so the gap — bonus credits and free grants — is
          visible rather than mistaken for missing money. */}
      {(totals.grantFundedCredits > 0 || totals.faceValueUsdCents !== totals.revenueUsdCents) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-night-surface px-4 py-3 text-xs text-silver-muted">
          <span>
            Credit face value{' '}
            <span className="tabular-nums text-silver">{formatUsd(totals.faceValueUsdCents)}</span>
          </span>
          <span>
            Credits spent <span className="tabular-nums text-silver">{formatCount(totals.creditsSpent)}</span>
            {totals.grantFundedCredits > 0 && (
              <span className={totals.grantFundedPct > 40 ? 'text-crimson-soft' : ''}>
                {' '}· {totals.grantFundedPct}% free-funded
              </span>
            )}
          </span>
          <span>
            Reads <span className="tabular-nums text-silver">{formatCount(readership.reads)}</span>
          </span>
          {readership.readsApproximate && (
            <span className="flex items-center gap-1 text-[11px]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Read counts bucket by UTC day; revenue uses {data.range.timezone}.
            </span>
          )}
        </div>
      )}
    </>
  );
};

const ChapterTable = ({ rows }) => (
  <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
    <table className="w-full text-sm">
      <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
        <tr>
          <Th>#</Th>
          <Th>Title</Th>
          <Th>Reads</Th>
          <Th>Wall shown</Th>
          <Th>Unlocks</Th>
          <Th>Conv.</Th>
          <Th>Credits</Th>
          <Th>Revenue</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => (
          <tr key={row.chapterId} className={row.revenueUsdCents === 0 ? 'text-silver-muted' : ''}>
            <Td className="text-silver-muted">{row.number}</Td>
            <Td className="max-w-[16rem] truncate text-silver">
              {row.title}
              {/* Sold in this window but no longer published, so the rows still
                  add up to the total above them. */}
              {row.unavailable && <span className="ml-2 text-[10px] text-crimson-soft">removed</span>}
            </Td>
            <Td className="tabular-nums text-silver-muted">{formatCount(row.reads)}</Td>
            <Td className="tabular-nums text-silver-muted">{formatCount(row.gateImpressions)}</Td>
            <Td className="tabular-nums text-silver-muted">{formatCount(row.unlocks)}</Td>
            <Td className="tabular-nums text-silver-muted">
              {row.conversionPct != null ? `${row.conversionPct}%` : '—'}
            </Td>
            <Td className="tabular-nums text-silver-muted">{formatCount(row.creditsSpent)}</Td>
            <Td><Money cents={row.revenueUsdCents} change={row.change?.revenueUsdCents} /></Td>
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length === 0 && <p className="p-6 text-center text-sm text-silver-muted">No published chapters.</p>}
  </div>
);

const NovelDrilldown = ({ novelId, range, onBack }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    getRevenueByChapter(novelId, toQuery(range))
      .then((result) => live && setData(result))
      .catch(() => live && setData(null));
    return () => { live = false; };
  }, [novelId, range]);

  if (!data) return <Spinner />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1.5 text-sm text-silver-muted hover:text-silver"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All novels
        </button>
        <a
          href={revenueExportUrl({ ...toQuery(range), scope: 'chapters', novelId })}
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Chapters CSV
        </a>
      </div>

      <Summary data={data} />
      <div className="mb-4">
        <RevenueChart series={data.series} granularity={data.range.granularity} compare={Boolean(data.range.comparedTo)} />
      </div>
      <ChapterTable rows={data.chapters} />
    </div>
  );
};

const RevenueExplorer = () => {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [summary, setSummary] = useState(null);
  const [novels, setNovels] = useState(null);
  const [authors, setAuthors] = useState(null);
  const [tab, setTab] = useState('novels');
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('revenue');
  const [error, setError] = useState(null);

  const query = useMemo(() => toQuery(range), [range]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [head, novelRows, authorRows] = await Promise.all([
        getRevenueSummary(query),
        getRevenueByNovel({ ...query, sort, limit: 100 }),
        getRevenueByAuthor(query),
      ]);
      setSummary(head);
      setNovels(novelRows.novels);
      setAuthors(authorRows.authors);
    } catch {
      setError('Could not load revenue for this period.');
    }
  }, [query, sort]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div>
        <RangePicker range={range} onChange={setRange} timezone={summary?.range?.timezone} />
        <p className="rounded-xl border border-crimson/40 bg-crimson/10 p-4 text-sm text-crimson-soft">{error}</p>
      </div>
    );
  }

  if (!summary) return <Spinner />;

  return (
    <div>
      <RangePicker range={range} onChange={setRange} timezone={summary.range.timezone} />

      {selected ? (
        <NovelDrilldown novelId={selected} range={range} onBack={() => setSelected(null)} />
      ) : (
        <>
          <Summary data={summary} />

          <div className="mb-6">
            <RevenueChart
              series={summary.series}
              granularity={summary.range.granularity}
              compare={Boolean(summary.range.comparedTo)}
            />
            {summary.range.comparedTo && (
              <p className="mt-2 text-[11px] text-silver-muted">
                Compared with {summary.range.comparedTo.from} to {summary.range.comparedTo.to}.
              </p>
            )}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            {[
              { id: 'novels', label: 'By novel' },
              { id: 'authors', label: 'By author' },
            ].map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-sm transition-colors ${
                  tab === entry.id ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:text-silver'
                }`}
              >
                {entry.label}
              </button>
            ))}
            {tab === 'novels' && (
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sort novels by"
                className="rounded-full border border-line bg-night px-3 py-1.5 text-xs text-silver-muted"
              >
                <option value="revenue">Top revenue</option>
                <option value="unlocks">Most unlocks</option>
                <option value="buyers">Most buyers</option>
                <option value="arpu">Revenue per unlock</option>
                <option value="title">Title</option>
              </select>
            )}
            <a
              href={revenueExportUrl({ ...query, scope: tab })}
              className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
            </a>
          </div>

          {tab === 'novels' ? (
            <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
                  <tr>
                    <Th>Novel</Th>
                    <Th>Author</Th>
                    <Th>Buyers</Th>
                    <Th>Unlocks</Th>
                    <Th>Credits</Th>
                    <Th>Free-funded</Th>
                    <Th>Per unlock</Th>
                    <Th>Revenue</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {novels.map((row) => (
                    <tr
                      key={row.novelId}
                      onClick={() => setSelected(row.novelId)}
                      className="cursor-pointer transition-colors hover:bg-night-raised"
                    >
                      <Td className="max-w-[18rem] truncate text-silver">
                        {row.title}
                        {row.deleted && <span className="ml-2 text-[10px] text-crimson-soft">deleted</span>}
                      </Td>
                      <Td className="max-w-[10rem] truncate text-silver-muted">{row.authorName || '—'}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.buyers)}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.unlocks)}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.creditsSpent)}</Td>
                      <Td className="tabular-nums text-silver-muted">
                        {row.grantFundedPct > 0 ? (
                          <span className={row.grantFundedPct > 40 ? 'text-crimson-soft' : ''}>
                            {row.grantFundedPct}%
                          </span>
                        ) : '—'}
                      </Td>
                      <Td className="tabular-nums text-silver-muted">{formatUsd(row.arpuUsdCents)}</Td>
                      <Td><Money cents={row.revenueUsdCents} change={row.change?.revenueUsdCents} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {novels.length === 0 && (
                <p className="p-6 text-center text-sm text-silver-muted">No revenue in this period.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
                  <tr>
                    <Th>Author</Th>
                    <Th>Novels</Th>
                    <Th>Buyers</Th>
                    <Th>Unlocks</Th>
                    <Th>Paid credits</Th>
                    <Th>Free-funded</Th>
                    <Th>Revenue</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(authors || []).map((row) => (
                    <tr key={row.authorId || row.authorName}>
                      <Td>
                        <span className="text-silver">{row.authorName}</span>
                        {!row.linked && <span className="ml-2 text-[10px] text-crimson-soft">not linked</span>}
                      </Td>
                      <Td className="tabular-nums text-silver-muted">{row.novelCount}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.buyers)}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.unlocks)}</Td>
                      <Td className="tabular-nums text-silver-muted">{formatCount(row.paidCredits)}</Td>
                      <Td className="tabular-nums text-silver-muted">
                        {row.grantFundedPct > 0 ? `${row.grantFundedPct}%` : '—'}
                      </Td>
                      <Td><Money cents={row.revenueUsdCents} change={row.change?.revenueUsdCents} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!authors || authors.length === 0) && (
                <p className="p-6 text-center text-sm text-silver-muted">No earnings in this period.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RevenueExplorer;

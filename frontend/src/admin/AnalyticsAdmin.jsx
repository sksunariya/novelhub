import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Download, RefreshCw, TrendingUp, Users, Gift } from 'lucide-react';
import {
  getNovelLeaderboard, getNovelPerformance, getEconomy, getFunnel,
} from '../api/adminConfig';
import client from '../api/client';
import Spinner from '../components/Spinner';
import RetentionChart from './analytics/RetentionChart';
import { formatUsd, formatCount } from './analytics/chartScale';

const Tile = ({ label, value, hint }) => (
  <div className="rounded-xl bg-night-surface p-4">
    <p className="text-xs text-silver-muted">{label}</p>
    <p className="mt-1 text-xl font-semibold text-silver">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-silver-muted">{hint}</p>}
  </div>
);

const NovelDrilldown = ({ novelId, onBack }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    getNovelPerformance(novelId).then(setData).catch(() => setData(null));
  }, [novelId]);

  if (!data) return <Spinner />;

  const { paywall, totals, novel } = data;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex cursor-pointer items-center gap-1.5 text-sm text-silver-muted hover:text-silver"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All novels
      </button>

      <h2 className="font-display text-xl font-bold text-silver">{novel.title}</h2>
      <p className="mb-4 text-xs text-silver-muted">
        {totals.freeChapters} free · {totals.paidChapters} paid
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Revenue" value={formatUsd(totals.revenueUsdCents)} />
        <Tile label="Unlocks" value={formatCount(totals.unlocks)} />
        <Tile label="Credits earned" value={formatCount(totals.creditsEarned)} />
        <Tile
          label="Paywall drop-off"
          value={paywall?.dropOffPct != null ? `${paywall.dropOffPct}%` : '—'}
          hint={paywall ? `at chapter ${paywall.firstPaidChapter}` : 'no paid chapters'}
        />
      </div>

      {/* The chart that says whether the free run is the right length. */}
      <RetentionChart chapters={data.chapters} />

      {paywall?.dropOffPct > 50 && (
        <p className="mt-3 rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson-soft">
          {paywall.dropOffPct}% of readers stop at chapter {paywall.firstPaidChapter}. Moving the paywall later is
          worth modelling.
        </p>
      )}

      <h3 className="mb-2 mt-6 font-display text-lg font-bold text-silver">Chapters</h3>
      <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Readers</th>
              <th className="px-3 py-2">Unlocks</th>
              <th className="px-3 py-2">Revenue</th>
              <th className="px-3 py-2">Conv.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.chapters.map((row) => (
              <tr key={row.chapterId}>
                <td className="px-3 py-2 text-silver-muted">{row.number}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-silver">{row.title}</td>
                <td className="px-3 py-2 text-xs text-silver-muted">
                  {row.free ? 'free' : `${row.priceCredits} cr`}
                </td>
                <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.readers)}</td>
                <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.unlocks)}</td>
                <td className="px-3 py-2 tabular-nums text-silver">{formatUsd(row.revenueUsdCents)}</td>
                <td className="px-3 py-2 tabular-nums text-silver-muted">
                  {row.conversionPct != null ? `${row.conversionPct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AnalyticsAdmin = () => {
  const [tab, setTab] = useState('novels');
  const [novels, setNovels] = useState(null);
  const [authors, setAuthors] = useState(null);
  const [economy, setEconomy] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [selected, setSelected] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    const [leaderboard, econ, fun, authorRows] = await Promise.all([
      getNovelLeaderboard({ limit: 50 }).catch(() => ({ novels: [] })),
      getEconomy().catch(() => null),
      getFunnel({ days: 30 }).catch(() => null),
      client.get('/admin/analytics/authors').then((r) => r.data).catch(() => ({ authors: [] })),
    ]);
    setNovels(leaderboard.novels);
    setEconomy(econ);
    setFunnel(fun);
    setAuthors(authorRows.authors);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await client.post('/admin/analytics/rebuild?days=7');
      await load();
    } finally {
      setRebuilding(false);
    }
  };

  if (!novels) return <Spinner />;

  if (selected) return <NovelDrilldown novelId={selected} onBack={() => setSelected(null)} />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Analytics</h1>
          <p className="text-xs text-silver-muted">
            Revenue is cash actually received, traced to the credits spent on each chapter.
          </p>
        </div>
        <button
          type="button"
          onClick={rebuild}
          disabled={rebuilding}
          title="Recompute the last 7 days of rollups"
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-silver-muted transition-colors hover:text-silver disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${rebuilding ? 'animate-spin' : ''}`} aria-hidden="true" />
          Rebuild
        </button>
      </div>

      {economy && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Recognized revenue" value={formatUsd(economy.recognizedUsdCents)} hint="earned in content" />
          <Tile
            label="Deferred liability"
            value={formatUsd(economy.deferredUsdCents)}
            hint="paid for, not yet spent"
          />
          <Tile label="Credits purchased" value={formatCount(economy.creditsPurchased)} />
          <Tile label="Credits granted" value={formatCount(economy.creditsGranted)} hint="no cash behind these" />
        </div>
      )}

      {funnel && funnel.stages?.[0]?.value > 0 && (
        <div className="mb-6 rounded-xl border border-line bg-night-surface p-4">
          <p className="mb-3 text-sm font-semibold text-silver">Paywall funnel, last 30 days</p>
          <div className="space-y-2">
            {funnel.stages.map((stage) => {
              const top = funnel.stages[0].value || 1;
              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 text-xs text-silver-muted">{stage.label}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-night">
                    <div
                      className="h-full rounded bg-crimson/60"
                      style={{ width: `${Math.max(2, (stage.value / top) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-silver">
                    {formatCount(stage.value)}
                  </span>
                </div>
              );
            })}
          </div>
          {funnel.conversionPct != null && (
            <p className="mt-3 text-xs text-silver-muted">
              {funnel.conversionPct}% of readers shown a paywall went on to unlock something.
            </p>
          )}
        </div>
      )}

      <div className="mb-4 flex gap-2 border-b border-line pb-3">
        {[
          { id: 'novels', label: 'By novel', Icon: TrendingUp },
          { id: 'authors', label: 'By author', Icon: Users },
        ].map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
              tab === entry.id ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:text-silver'
            }`}
          >
            <entry.Icon className="h-3.5 w-3.5" aria-hidden="true" /> {entry.label}
          </button>
        ))}
        {tab === 'authors' && (
          <a
            href="/api/admin/analytics/authors.csv"
            className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
          </a>
        )}
      </div>

      {tab === 'novels' ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
              <tr>
                <th className="px-3 py-2">Novel</th>
                <th className="px-3 py-2">Readers</th>
                <th className="px-3 py-2">Payers</th>
                <th className="px-3 py-2">Conv.</th>
                <th className="px-3 py-2">Unlocks</th>
                <th className="px-3 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {novels.map((row) => (
                <tr
                  key={row.novelId}
                  onClick={() => setSelected(row.novelId)}
                  className="cursor-pointer transition-colors hover:bg-night-raised"
                >
                  <td className="max-w-[18rem] truncate px-3 py-2 text-silver">{row.title}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.readers)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.payers)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">
                    {row.readerToPayerPct != null ? `${row.readerToPayerPct}%` : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.unlocks)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver">{formatUsd(row.revenueUsdCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {novels.length === 0 && (
            <p className="p-6 text-center text-sm text-silver-muted">No unlocks recorded yet.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
              <tr>
                <th className="px-3 py-2">Author</th>
                <th className="px-3 py-2">Novels</th>
                <th className="px-3 py-2">Readers</th>
                <th className="px-3 py-2">Unlocks</th>
                <th className="px-3 py-2">Revenue</th>
                <th className="px-3 py-2">Free-funded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(authors || []).map((row) => (
                <tr key={row.authorId || row.authorName}>
                  <td className="px-3 py-2">
                    <span className="text-silver">{row.authorName}</span>
                    {/* Unlinked novels are grouped by display string, which can
                        split one person across rows. Say so rather than hide it. */}
                    {!row.linked && (
                      <span className="ml-2 text-[10px] text-crimson-soft">not linked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{row.novelCount}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.readers)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">{formatCount(row.unlocks)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver">{formatUsd(row.revenueUsdCents)}</td>
                  <td className="px-3 py-2 tabular-nums text-silver-muted">
                    {row.grantFundedPct > 0 ? (
                      <span className={row.grantFundedPct > 40 ? 'text-crimson-soft' : ''}>
                        {row.grantFundedPct}%
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!authors || authors.length === 0) && (
            <p className="p-6 text-center text-sm text-silver-muted">
              No earnings yet. Rollups build hourly, or press Rebuild.
            </p>
          )}
          {authors?.some((a) => a.grantFundedPct > 0) && (
            <p className="border-t border-line p-3 text-[11px] text-silver-muted">
              <Gift className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Free-funded is the share of credits spent on this author&apos;s chapters that were granted rather
              than bought. Those reads earned no cash.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyticsAdmin;

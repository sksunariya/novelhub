import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, Trash2, Clock, Flag } from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';

// The report queue.
//
// Grouped by the item reported, not by report — a post with twelve reports is
// one row, not twelve. That is what makes the queue clearable.
//
// The right rail shows the author's history AND how many reports that person
// has filed, which is how report-brigading becomes visible.

const SEVERITY_STYLE = {
  5: 'bg-crimson/20 text-crimson-soft',
  4: 'bg-orange-500/15 text-orange-300',
  3: 'bg-amber-500/15 text-amber-300',
  2: 'bg-sky-500/15 text-sky-300',
  1: 'bg-zinc-500/15 text-zinc-300',
};

const relativeTime = (date) => {
  const minutes = Math.floor((Date.now() - new Date(date)) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

const CommunityReportsAdmin = () => {
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listReports({ limit: 50 })
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    api.reportDetail(selected._id.targetType, selected._id.target)
      .then(setDetail)
      .catch(() => setDetail({ reports: [], content: null }));
  }, [selected]);

  const act = async (action) => {
    if (!selected) return;
    if (action === 'remove' && !reason.trim()) return;
    setBusy(true);
    try {
      await api.reviewReport({
        action,
        targetType: selected._id.targetType,
        target: selected._id.target,
        reason,
        note: '',
      });
      setSelected(null);
      setReason('');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <Spinner full />;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Reports</h1>
        <p className="text-sm text-silver-muted">{items.length} item{items.length === 1 ? '' : 's'} awaiting review</p>
      </div>

      {!items.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          Nothing in the queue.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          {/* Queue */}
          <ul className="space-y-2">
            {items.map((item) => {
              const key = `${item._id.targetType}:${item._id.target}`;
              const active = selected && `${selected._id.targetType}:${selected._id.target}` === key;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => { setSelected(item); setReason(''); }}
                    aria-pressed={active}
                    className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${
                      active ? 'border-crimson bg-crimson/10' : 'border-line bg-night-surface hover:border-crimson/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[item.peakSeverity] || SEVERITY_STYLE[1]}`}>
                        {item.peakSeverity >= 5 ? 'Severe' : `Severity ${item.peakSeverity}`}
                      </span>
                      <span className="text-[11px] text-silver-muted">{item._id.targetType}</span>
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-silver-muted">
                        <Flag className="h-3 w-3" aria-hidden="true" />
                        {item.reportCount}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-silver">
                      {item.snapshot?.title || item.snapshot?.body || '(no text)'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.reasons.slice(0, 3).map((r) => (
                        <span key={r} className="rounded bg-night-raised px-1.5 py-0.5 text-[10px] text-silver-muted">
                          {r.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-silver-muted">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      first {relativeTime(item.firstReportedAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Detail */}
          <div className="rounded-xl border border-line bg-night-surface p-4">
            {!selected ? (
              <p className="py-16 text-center text-sm text-silver-muted">Select an item to review.</p>
            ) : !detail ? (
              <Spinner />
            ) : (
              <>
                <div className="mb-4 grid gap-4 md:grid-cols-2">
                  {/* As reported — the snapshot. */}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-silver-muted">
                      As reported
                    </p>
                    <div className="rounded-lg border border-line bg-night p-3">
                      <p className="font-medium text-silver">{selected.snapshot?.title || '—'}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-silver-muted">
                        {selected.snapshot?.body || '(no body)'}
                      </p>
                    </div>
                  </div>

                  {/* Current state. A difference here means it was edited after
                      being reported — the reason snapshots exist. */}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-silver-muted">
                      Now
                    </p>
                    <div className="rounded-lg border border-line bg-night p-3">
                      <p className="font-medium text-silver">{detail.content?.title || '—'}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-silver-muted">
                        {detail.content?.bodyText || detail.content?.body || '(no body)'}
                      </p>
                      {detail.content?.status !== 'published' && (
                        <p className="mt-2 text-xs text-amber-300">
                          Currently {detail.content?.status}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Author history — the context a decision needs. */}
                <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-line bg-night p-3 text-xs">
                  <span className="text-silver-muted">
                    Author <span className="text-silver">{detail.content?.author?.username || '—'}</span>
                  </span>
                  <span className="text-silver-muted">
                    Karma <span className="text-silver">{detail.content?.author?.karma?.total ?? 0}</span>
                  </span>
                  <span className="text-silver-muted">
                    Prior removals <span className="text-silver">{detail.authorHistory?.priorRemovals ?? 0}</span>
                  </span>
                  <span className="text-silver-muted">
                    Reported before <span className="text-silver">{detail.authorHistory?.priorReports ?? 0}</span>
                  </span>
                  {/* Surfaces someone who reports everything they dislike. */}
                  <span className="text-silver-muted">
                    Reports filed <span className="text-silver">{detail.authorHistory?.reportsFiled ?? 0}</span>
                  </span>
                </div>

                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">
                    {detail.reports.length} report{detail.reports.length === 1 ? '' : 's'}
                  </p>
                  <ul className="space-y-1">
                    {detail.reports.map((r) => (
                      <li key={r._id} className="flex flex-wrap items-center gap-2 text-xs text-silver-muted">
                        <span className={`rounded px-1.5 py-0.5 ${SEVERITY_STYLE[r.severity] || SEVERITY_STYLE[1]}`}>
                          {r.reason.replace(/_/g, ' ')}
                        </span>
                        <span>{r.reporter?.username || 'anonymous'}</span>
                        {r.reporter?.trustedFlagger && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">trusted</span>
                        )}
                        {r.details && <span className="text-silver">“{r.details}”</span>}
                      </li>
                    ))}
                  </ul>
                </div>

                <label className="block text-xs font-medium text-silver-muted" htmlFor="review-reason">
                  Reason (required to remove — the author is told this)
                </label>
                <textarea
                  id="review-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
                />

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act('restore')}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-silver-muted transition-colors hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" /> Restore — nothing wrong
                  </button>
                  <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() => act('remove')}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-crimson px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                  </button>
                  {selected.peakSeverity >= 5 && (
                    <p className="ml-auto flex items-center gap-1 text-xs text-crimson-soft">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      Hidden automatically on the first report
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunityReportsAdmin;

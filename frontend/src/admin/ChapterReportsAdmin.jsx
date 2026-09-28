import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Check, CheckCircle2, Clock, ExternalLink, Flag, Monitor, Pencil, Quote, RotateCcw, Search, X, XCircle,
} from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';
import { formatExactDateTime, formatRelativeTime } from '../utils/dateUtils';
import { NOVEL_FILTER_LIMIT, SEARCH_DEBOUNCE_MS } from './moderation/constants';

// Problems readers reported from the chapter reader's toolbar.
//
// Each row carries what the reader saw (the chapter as it was numbered and
// titled when they filed), what they said, the passage they highlighted, and
// how they were reading — theme, font, screen size, browser — because a
// rendering bug is often specific to one of those.

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

const STATUS_STYLE = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-sky-500/15 text-sky-300',
  resolved: 'bg-emerald-500/15 text-emerald-300',
  dismissed: 'bg-zinc-500/20 text-zinc-300',
};

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', dismissed: 'Dismissed' };

const CATEGORY_STYLE = {
  missing_content: 'bg-rose-500/15 text-rose-300',
  wrong_chapter: 'bg-orange-500/15 text-orange-300',
  wrong_order: 'bg-orange-500/15 text-orange-300',
  formatting: 'bg-sky-500/15 text-sky-300',
  typos: 'bg-violet-500/15 text-violet-300',
  access: 'bg-amber-500/15 text-amber-300',
  inappropriate: 'bg-crimson/20 text-crimson-soft',
  other: 'bg-zinc-500/20 text-zinc-300',
};

const isClosed = (status) => status === 'resolved' || status === 'dismissed';

/** "Chrome on Android" from a user agent — enough to spot a pattern. */
const describeBrowser = (ua = '') => {
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari' : 'Other browser';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS'
        : /Windows/.test(ua) ? 'Windows'
          : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
};

const chapterPath = (issue) => {
  const slug = issue.novel?.slug || issue.snapshot?.novelSlug;
  const number = issue.chapter?.number ?? issue.snapshot?.chapterNumber;
  return slug && number != null ? `/novel/${slug}/chapter/${number}` : null;
};

const Avatar = ({ user, name }) =>
  user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-line object-cover" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-crimson to-crimson-alt text-xs font-bold uppercase text-white">
      {(name || '?').slice(0, 2)}
    </span>
  );

/** The resolve/dismiss form, shared by a row and the bulk bar. */
const CloseForm = ({ status, onCancel, onConfirm, busy, count = 1 }) => {
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const resolving = status === 'resolved';
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line bg-night/60 p-3">
      <label className="field-label text-xs" htmlFor={`close-note-${status}-${count}`}>
        {resolving ? 'What was fixed?' : 'Why is this being dismissed?'} <span className="text-silver-muted">(optional)</span>
      </label>
      <textarea
        id={`close-note-${status}-${count}`}
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
        rows={2}
        className="field resize-none text-sm"
        placeholder={resolving ? 'e.g. Re-uploaded the missing second half.' : 'e.g. The chapter is correct as published.'}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-silver-muted">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-crimson" />
          Notify the {count > 1 ? 'readers' : 'reader'} (the note is included)
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm({ note, notify })}
            className={`btn btn-sm ${resolving ? 'btn-primary' : 'btn-secondary'}`}
          >
            {resolving ? 'Mark resolved' : 'Dismiss'}
            {count > 1 ? ` ${count}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

const IssueCard = ({ issue, selected, onSelect, onStatus, onFilterChapter, busy }) => {
  const [closing, setClosing] = useState('');
  const path = chapterPath(issue);
  const number = issue.snapshot?.chapterNumber;
  const chapterGone = !issue.chapter || issue.chapter.deletedAt;
  const unpublished = issue.chapter && issue.chapter.published === false;
  const renumbered = issue.chapter && number != null && issue.chapter.number !== number;
  const others = Math.max(0, (issue.openOnChapter || 0) - (isClosed(issue.status) ? 0 : 1));
  const ctx = issue.context || {};
  const contextBits = [
    Number.isFinite(ctx.progress) ? `${ctx.progress}% through the chapter` : null,
    ctx.theme ? `${ctx.theme} theme` : null,
    ctx.font ? `${ctx.font}${ctx.fontSize ? ` ${ctx.fontSize}px` : ''}` : null,
    ctx.viewport || null,
    describeBrowser(ctx.userAgent),
  ].filter(Boolean);

  const confirm = (status) => async (payload) => {
    await onStatus([issue._id], { status, ...payload });
    setClosing('');
  };

  return (
    <article className={`rounded-2xl border bg-night-surface p-4 transition-colors sm:p-5 ${selected ? 'border-crimson/60' : 'border-line'}`}>
      <div className="flex gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(issue._id, e.target.checked)}
          aria-label="Select report"
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-crimson"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CATEGORY_STYLE[issue.category] || CATEGORY_STYLE.other}`}>
              {issue.categoryLabel}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[issue.status]}`}>
              {STATUS_LABEL[issue.status]}
            </span>
            {issue.submissions > 1 && (
              <span className="rounded-full bg-night-raised px-2.5 py-0.5 text-xs text-silver-muted">
                Sent {issue.submissions}× by this reader
              </span>
            )}
            <span className="ml-auto text-xs text-silver-muted" title={formatExactDateTime(issue.createdAt)}>
              {formatRelativeTime(issue.createdAt)}
            </span>
          </div>

          <h3 className="mt-2 font-display text-base font-semibold text-silver">
            {issue.novel?.title || issue.snapshot?.novelTitle || 'Deleted novel'}
            <span className="text-silver-muted"> · Ch. {number ?? '?'}</span>
            {issue.snapshot?.chapterTitle && <span className="font-normal text-silver-muted"> — {issue.snapshot.chapterTitle}</span>}
          </h3>

          {(chapterGone || unpublished || renumbered) && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {chapterGone
                ? 'This chapter has since been deleted.'
                : unpublished
                  ? 'This chapter is now unpublished.'
                  : `This chapter is now number ${issue.chapter.number}.`}
            </p>
          )}

          {issue.details ? (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-silver">{issue.details}</p>
          ) : (
            <p className="mt-3 text-sm italic text-silver-muted">No description given.</p>
          )}

          {issue.quote && (
            <blockquote className="mt-3 flex gap-2 rounded-xl border-l-4 border-crimson bg-crimson/10 px-3 py-2 text-sm italic text-silver">
              <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crimson-soft" aria-hidden="true" />
              <span>{issue.quote}</span>
            </blockquote>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-silver-muted">
            <span className="flex items-center gap-2">
              <Avatar user={issue.reporter} name={issue.reporter?.username || issue.snapshot?.reporterName} />
              <span>
                <span className="font-medium text-silver">{issue.reporter?.username || issue.snapshot?.reporterName || 'Deleted user'}</span>
                {issue.reporter?.banned && <span className="ml-1 text-rose-300">(banned)</span>}
                {issue.reporter?.email && <span className="block">{issue.reporter.email}</span>}
              </span>
            </span>
            {contextBits.length > 0 && (
              <span className="flex items-center gap-1.5" title={ctx.userAgent || ''}>
                <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {contextBits.join(' · ')}
              </span>
            )}
          </div>

          {others > 0 && !isClosed(issue.status) && (
            <button
              type="button"
              onClick={() => onFilterChapter(issue)}
              className="mt-2 cursor-pointer text-xs font-medium text-crimson-soft hover:underline"
            >
              {others} other open {others === 1 ? 'report' : 'reports'} on this chapter →
            </button>
          )}

          {isClosed(issue.status) && (
            <div className="mt-3 rounded-xl border border-line bg-night/60 px-3 py-2 text-xs text-silver-muted">
              <span className="font-medium text-silver">{STATUS_LABEL[issue.status]}</span>
              {issue.handledBy?.username && ` by ${issue.handledBy.username}`}
              {issue.handledAt && ` · ${formatRelativeTime(issue.handledAt)}`}
              {issue.reporterNotified && ' · reader notified'}
              {issue.resolutionNote && <p className="mt-1 whitespace-pre-line text-silver">{issue.resolutionNote}</p>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {path && !chapterGone && (
              <a href={path} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open chapter
              </a>
            )}
            {issue.novel?._id && (
              <Link to={`/admin/novels/${issue.novel._id}/chapters`} className="btn btn-secondary btn-sm">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit chapters
              </Link>
            )}
            <span className="flex-1" />
            {!isClosed(issue.status) ? (
              <>
                {issue.status === 'open' && (
                  <button type="button" disabled={busy} onClick={() => onStatus([issue._id], { status: 'in_progress' })} className="btn btn-ghost btn-sm">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> In progress
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setClosing('dismissed')} className="btn btn-ghost btn-sm">
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Dismiss
                </button>
                <button type="button" disabled={busy} onClick={() => setClosing('resolved')} className="btn btn-primary btn-sm">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Resolve
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => onStatus([issue._id], { status: 'open' })} className="btn btn-ghost btn-sm">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
              </button>
            )}
          </div>

          {closing && (
            <CloseForm key={closing} status={closing} busy={busy} onCancel={() => setClosing('')} onConfirm={confirm(closing)} />
          )}
        </div>
      </div>
    </article>
  );
};

const ChapterReportsAdmin = () => {
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const [novelId, setNovelId] = useState('');
  const [chapterFilter, setChapterFilter] = useState(null); // { id, label }
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [novels, setNovels] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkClosing, setBulkClosing] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    client.get('/chapter-issues/categories').then(({ data: res }) => setCategories(res.categories || [])).catch(() => {});
    client
      .get('/admin/novels', { params: { limit: NOVEL_FILTER_LIMIT } })
      .then(({ data: res }) => setNovels(res.novels || []))
      .catch(() => setNovels([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadHotspots = useCallback(() => {
    client.get('/admin/chapter-issues/hotspots').then(({ data: res }) => setHotspots(res.chapters || [])).catch(() => setHotspots([]));
  }, []);

  const load = useCallback(async (spinner = true) => {
    if (spinner) setData(null);
    const params = { status, page };
    if (category) params.category = category;
    if (novelId) params.novel = novelId;
    if (chapterFilter) params.chapter = chapterFilter.id;
    if (search) params.search = search;
    try {
      const { data: res } = await client.get('/admin/chapter-issues', { params });
      setData(res);
      if (!res.issues.length && page > 1 && page > res.pages) setPage(res.pages);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Failed to load reports');
      setData({ issues: [], total: 0, pages: 1, counts: {} });
    }
  }, [status, page, category, novelId, chapterFilter, search]);

  useEffect(() => {
    load();
    setSelected(new Set());
    setBulkClosing('');
  }, [load]);

  useEffect(() => {
    loadHotspots();
  }, [loadHotspots]);

  const changeFilter = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  const updateStatus = async (ids, body) => {
    setBusy(true);
    setMessage('');
    try {
      const { data: res } = ids.length === 1
        ? await client.patch(`/admin/chapter-issues/${ids[0]}`, body)
        : await client.post('/admin/chapter-issues/bulk', { ids, ...body });
      setMessage(`${res.changed} ${res.changed === 1 ? 'report' : 'reports'} marked ${STATUS_LABEL[body.status].toLowerCase()}.`);
      setSelected(new Set());
      setBulkClosing('');
      await Promise.all([load(false), loadHotspots()]);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (id, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const filterByChapter = (item) => {
    setPage(1);
    setStatus('open');
    setChapterFilter({
      id: item.chapter?._id || item.chapter,
      label: `${item.novel?.title || item.snapshot?.novelTitle || item.novelTitle} · Ch. ${item.snapshot?.chapterNumber ?? item.chapterNumber}`,
    });
  };

  const issues = data?.issues || [];
  const allSelected = issues.length > 0 && issues.every((i) => selected.has(i._id));
  const selectedIds = [...selected];
  const filterClass =
    'rounded-full border border-line bg-night-surface px-4 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-silver">
          <Flag className="h-6 w-6 text-crimson-soft" aria-hidden="true" /> Chapter reports
        </h1>
        <p className="mt-1 text-sm text-silver-muted">
          Problems readers reported from the chapter reader. Resolving or dismissing one can notify the reader.
        </p>
      </div>

      {hotspots.length > 0 && (
        <section className="mb-6" aria-label="Most reported chapters">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-muted">Most reported open chapters</h2>
          <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {hotspots.map((spot) => (
              <button
                key={spot.chapter}
                type="button"
                onClick={() => filterByChapter(spot)}
                className="w-60 shrink-0 cursor-pointer rounded-2xl border border-line bg-night-surface p-3 text-left transition-colors hover:border-crimson/50"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-silver">{spot.novelTitle}</span>
                  <span className="shrink-0 rounded-full bg-crimson/20 px-2 py-0.5 text-xs font-bold text-crimson-soft">{spot.count}</span>
                </div>
                <p className="truncate text-xs text-silver-muted">
                  Ch. {spot.chapterNumber}{spot.chapterTitle ? ` — ${spot.chapterTitle}` : ''}
                </p>
                <p className="mt-1.5 truncate text-[11px] text-silver-muted">{spot.categories.join(' · ')}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Report status">
        {STATUS_TABS.map((tab) => {
          const count = tab.key === 'all'
            ? Object.values(data?.counts || {}).reduce((a, b) => a + b, 0)
            : data?.counts?.[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={status === tab.key}
              onClick={() => changeFilter(setStatus)(tab.key)}
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                status === tab.key ? 'bg-crimson text-white' : 'border border-line text-silver-muted hover:text-silver'
              }`}
            >
              {tab.label}
              {count != null && (
                <span className={`rounded-full px-1.5 text-xs ${status === tab.key ? 'bg-white/20' : 'bg-night-raised'}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-silver-muted" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search details, novel or reader…"
            aria-label="Search reports"
            className={`${filterClass} w-full pl-10`}
          />
        </div>
        <select value={category} onChange={(e) => changeFilter(setCategory)(e.target.value)} aria-label="Filter by problem" className={filterClass}>
          <option value="">All problems</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select value={novelId} onChange={(e) => changeFilter(setNovelId)(e.target.value)} aria-label="Filter by novel" className={filterClass}>
          <option value="">All novels</option>
          {novels.map((novel) => (
            <option key={novel._id} value={novel._id}>{novel.title}</option>
          ))}
        </select>
        {chapterFilter && (
          <span className="chip chip-active">
            {chapterFilter.label}
            <button type="button" onClick={() => changeFilter(setChapterFilter)(null)} aria-label="Clear chapter filter" className="cursor-pointer">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
      </div>

      {issues.length > 0 && (
        <div className="mb-3 rounded-2xl border border-line bg-night-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-silver-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? new Set(issues.map((i) => i._id)) : new Set())}
                className="h-4 w-4 accent-crimson"
              />
              {selected.size ? `${selected.size} selected` : 'Select all on this page'}
            </label>
            {selected.size > 0 && (
              <div className="ml-auto flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => updateStatus(selectedIds, { status: 'in_progress' })} className="btn btn-ghost btn-sm">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> In progress
                </button>
                <button type="button" disabled={busy} onClick={() => updateStatus(selectedIds, { status: 'open' })} className="btn btn-ghost btn-sm">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
                </button>
                <button type="button" disabled={busy} onClick={() => setBulkClosing('dismissed')} className="btn btn-ghost btn-sm">
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Dismiss
                </button>
                <button type="button" disabled={busy} onClick={() => setBulkClosing('resolved')} className="btn btn-primary btn-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Resolve
                </button>
              </div>
            )}
          </div>
          {bulkClosing && selected.size > 0 && (
            <CloseForm
              key={`bulk-${bulkClosing}`}
              status={bulkClosing}
              count={selected.size}
              busy={busy}
              onCancel={() => setBulkClosing('')}
              onConfirm={(payload) => updateStatus(selectedIds, { status: bulkClosing, ...payload })}
            />
          )}
        </div>
      )}

      {message && (
        <p className="mb-4 rounded-lg border border-crimson/40 bg-crimson/10 px-4 py-2 text-sm text-crimson-soft" role="status">{message}</p>
      )}

      {data === null ? (
        <Spinner full />
      ) : issues.length === 0 ? (
        <div className="rounded-2xl border border-line bg-night-surface py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-400" aria-hidden="true" />
          <p className="text-silver">{status === 'open' ? 'No open reports. Nice.' : 'No reports match these filters.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <IssueCard
              key={issue._id}
              issue={issue}
              selected={selected.has(issue._id)}
              onSelect={toggleSelect}
              onStatus={updateStatus}
              onFilterChapter={filterByChapter}
              busy={busy}
            />
          ))}
        </div>
      )}

      <Pagination page={page} pages={data?.pages} total={data?.total} onChange={setPage} />
    </div>
  );
};

export default ChapterReportsAdmin;

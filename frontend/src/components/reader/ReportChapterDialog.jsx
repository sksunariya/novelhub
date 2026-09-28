import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Flag, Quote, X } from 'lucide-react';
import client from '../../api/client';

// Mirrors CHAPTER_ISSUE_CATEGORIES in backend/src/config/constants.js. The
// dialog asks the API for the live list and only falls back to this copy when
// that request fails, so a report can still be filed.
const FALLBACK_CATEGORIES = [
  { key: 'missing_content', label: 'Missing or incomplete text', hint: 'The chapter cuts off, is empty or has gaps.' },
  { key: 'wrong_chapter', label: 'Wrong or duplicate chapter', hint: 'This is a different chapter, or a repeat of one.' },
  { key: 'wrong_order', label: 'Wrong order or numbering', hint: 'Chapters are out of sequence or misnumbered.' },
  { key: 'formatting', label: 'Formatting problem', hint: 'Broken layout, stray code, images not showing.' },
  { key: 'typos', label: 'Typos or translation errors', hint: 'Spelling, grammar or mistranslated passages.' },
  { key: 'access', label: 'Locked or access problem', hint: 'Charged, locked or gated when it should not be.' },
  { key: 'inappropriate', label: 'Inappropriate content', hint: 'Content that should not be on the site.' },
  { key: 'other', label: 'Something else', hint: 'Describe the problem below.' },
];

const DETAILS_MAX = 1000;
const QUOTE_MAX = 500;

let categoriesCache = null;

/**
 * "Report a problem" for the chapter being read. Themed from the reader's own
 * palette rather than the site's, so it stays legible on sepia and light.
 *
 * `context` is what the reader was looking at when they opened it: the
 * selected passage (if any), how far through the chapter they were, and their
 * display settings. All of it goes to the admin with the report.
 */
const ReportChapterDialog = ({ open, onClose, theme, chapter, user, context, allowQuote = true }) => {
  const [categories, setCategories] = useState(categoriesCache || FALLBACK_CATEGORIES);
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [quote, setQuote] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  // Fresh form each time it opens, seeded with whatever passage was selected.
  useEffect(() => {
    if (!open) return;
    setCategory('');
    setDetails('');
    setQuote((context?.quote || '').slice(0, QUOTE_MAX));
    setStatus('idle');
    setResult('');
    setError('');
  }, [open, context?.quote]);

  useEffect(() => {
    if (!open || categoriesCache) return;
    client
      .get('/chapter-issues/categories')
      .then(({ data }) => {
        if (Array.isArray(data.categories) && data.categories.length) {
          categoriesCache = data.categories;
          setCategories(data.categories);
        }
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Focus lands inside the dialog so keyboard and screen-reader users start
    // where the form is, not back on the toolbar.
    const timer = setTimeout(() => dialogRef.current?.querySelector('input, a, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const needsDetails = category === 'other';
  const canSend = category && (!needsDetails || details.trim().length >= 5) && status !== 'sending';

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError('');
    try {
      const { data } = await client.post(`/chapter-issues/chapters/${chapter.id}`, {
        category,
        details: details.trim(),
        quote: quote.trim(),
        context: {
          progress: context?.progress,
          theme: context?.theme,
          font: context?.font,
          fontSize: context?.fontSize,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        },
      });
      setResult(data.message || 'Thanks for the report.');
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      setError(
        err.response?.status === 429
          ? 'You have sent a lot of reports today. Please try again tomorrow.'
          : err.response?.data?.message || 'Could not send the report. Please try again.'
      );
    }
  };

  const fieldStyle = { borderColor: theme.border, backgroundColor: 'transparent', color: theme.text };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-chapter-title"
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl"
        // Native radios and the textarea follow the reader's theme, not the
        // site's dark colour-scheme, or they render as dark blobs on sepia.
        style={{ backgroundColor: theme.surface, color: theme.text, borderColor: theme.border, boxShadow: theme.shadow, colorScheme: theme.scheme || 'dark' }}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4" style={{ borderColor: theme.border }}>
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crimson/15 text-crimson">
            <Flag className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="report-chapter-title" className="font-display text-lg font-bold">Report a problem</h2>
            <p className="truncate text-xs opacity-60">
              Chapter {chapter.number}
              {chapter.title ? ` · ${chapter.title}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {!user ? (
          <div className="space-y-4 px-5 py-6 text-sm">
            <p className="opacity-80">Log in to report a problem with this chapter, so we can follow up with you once it is fixed.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-sm opacity-70 hover:opacity-100">Cancel</button>
              <Link to="/login" className="btn btn-primary btn-sm">Log in</Link>
            </div>
          </div>
        ) : status === 'done' ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
            <p className="font-semibold">Report sent</p>
            <p className="max-w-xs text-sm opacity-70">{result} You will get a notification when it has been looked at.</p>
            <button type="button" onClick={onClose} className="btn btn-primary btn-sm mt-2">Back to reading</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">What is wrong?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {categories.map((item) => {
                    const active = category === item.key;
                    return (
                      <label
                        key={item.key}
                        className={`flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                          active ? 'border-crimson bg-crimson/10' : 'hover:bg-crimson/5'
                        }`}
                        style={active ? undefined : { borderColor: theme.border }}
                      >
                        <input
                          type="radio"
                          name="report-category"
                          value={item.key}
                          checked={active}
                          onChange={() => setCategory(item.key)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-crimson"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{item.label}</span>
                          {item.hint && <span className="mt-0.5 block text-xs leading-snug opacity-60">{item.hint}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {quote && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide opacity-60">Selected passage</span>
                    <button
                      type="button"
                      onClick={() => setQuote('')}
                      className="cursor-pointer text-xs opacity-60 underline-offset-2 hover:underline hover:opacity-100"
                    >
                      Remove
                    </button>
                  </div>
                  <blockquote
                    className="flex gap-2 rounded-xl border-l-4 border-crimson bg-crimson/10 px-3 py-2 text-sm italic"
                  >
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
                    <span className="line-clamp-4">{quote}</span>
                  </blockquote>
                </div>
              )}

              <div>
                <label htmlFor="report-details" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide opacity-60">
                  Details {needsDetails ? '(required)' : '(optional)'}
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, DETAILS_MAX))}
                  rows={4}
                  placeholder={
                    quote
                      ? 'What is wrong with this passage?'
                      : allowQuote
                        ? 'Where in the chapter, and what did you expect to see? Tip: select the text first to attach it.'
                        : 'Where in the chapter, and what did you expect to see?'
                  }
                  className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm placeholder:opacity-50 focus:border-crimson focus:outline-none focus:ring-2 focus:ring-crimson/25"
                  style={fieldStyle}
                />
                <p className="mt-1 text-right text-[11px] opacity-50">{details.length}/{DETAILS_MAX}</p>
              </div>

              <p className="text-[11px] leading-relaxed opacity-55">
                Your report includes your username, your position in the chapter
                {Number.isFinite(context?.progress) ? ` (${Math.round(context.progress)}%)` : ''}, your reading settings and your
                browser, so the team can reproduce the problem.
              </p>

              {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-500" role="alert">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: theme.border }}>
              <button type="button" onClick={onClose} className="btn btn-sm opacity-70 hover:opacity-100">Cancel</button>
              <button type="submit" disabled={!canSend} className="btn btn-primary btn-sm">
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportChapterDialog;

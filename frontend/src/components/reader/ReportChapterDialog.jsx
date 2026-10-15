import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Flag, X } from 'lucide-react';
import client from '../../api/client';

const DETAILS_MAX = 1000;

/**
 * "Report a problem" for the chapter being read. Themed from the reader's own
 * palette rather than the site's, so it stays legible on sepia and light.
 *
 * `context` is what the reader was looking at when they opened it: the
 * how far through the chapter they were, and their
 * display settings. All of it goes to the admin with the report.
 */
const ReportChapterDialog = ({ open, onClose, theme, chapter, user, context }) => {
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  // Fresh form each time it opens, seeded with whatever passage was selected.
  useEffect(() => {
    if (!open) return;
    setDetails('');
    setStatus('idle');
    setResult('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // Focus lands inside the dialog so keyboard and screen-reader users start
    // where the form is, not back on the toolbar.
    const timer = setTimeout(() => dialogRef.current?.querySelector('textarea, a, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const canSend = details.trim().length >= 5 && status !== 'sending';

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError('');
    try {
      const { data } = await client.post(`/chapter-issues/chapters/${chapter.id}`, {
        // Free-text only: everything is filed under 'other', which the API
        // requires a description for.
        category: 'other',
        details: details.trim(),
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
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
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
              <div>
                <label htmlFor="report-details" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide opacity-60">
                  What is wrong?
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, DETAILS_MAX))}
                  rows={4}
                  placeholder="Describe the problem with this chapter."
                  className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm placeholder:opacity-50 focus:border-crimson focus:outline-none focus:ring-2 focus:ring-crimson/25"
                  style={fieldStyle}
                />
                <p className="mt-1 text-right text-[11px] opacity-50">{details.length}/{DETAILS_MAX}</p>
              </div>

              {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-500" role="alert">{error}</p>}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end" style={{ borderColor: theme.border }}>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border px-5 text-sm font-medium transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 sm:min-w-[96px]"
                style={{ borderColor: theme.border, color: theme.text }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 active:bg-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600 sm:min-w-[140px]"
              >
                {status === 'sending' ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    Send report
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportChapterDialog;

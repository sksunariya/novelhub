import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Flag, X } from 'lucide-react';
import client from '../../api/client';

const DETAILS_MAX = 1000;
const DETAILS_MIN = 5;

/**
 * "Report a problem" for the chapter being read: one text box, nothing else.
 * Themed from the reader's own palette rather than the site's, so it stays
 * legible on sepia and light.
 *
 * `context` is how the reader was reading when they opened it — how far
 * through the chapter they were and their display settings. It is sent with
 * the report so the admin can reproduce the problem; the reader is not asked
 * for any of it.
 */
const ReportChapterDialog = ({ open, onClose, theme, chapter, user, context }) => {
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

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
    // Straight into the text box: it is the only thing to fill in.
    // (A grouped selector would match the close button first: it comes
    // earlier in the markup.)
    const timer = setTimeout(() => {
      const root = dialogRef.current;
      (root?.querySelector('textarea') || root?.querySelector('a.btn, button'))?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const canSend = details.trim().length >= DETAILS_MIN && status !== 'sending';

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError('');
    try {
      const { data } = await client.post(`/chapter-issues/chapters/${chapter.id}`, {
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

  const redButton =
    'btn btn-sm bg-red-600 text-white shadow-lg shadow-red-600/25 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600';

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-chapter-title"
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl"
        // Native controls follow the reader's theme, not the site's dark
        // colour-scheme, or they render as dark blobs on sepia.
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
              <Link to="/login" className={redButton}>Log in</Link>
            </div>
          </div>
        ) : status === 'done' ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" aria-hidden="true" />
            <p className="font-semibold">Report sent</p>
            <p className="max-w-xs text-sm opacity-70">{result} You will get a notification when it has been looked at.</p>
            <button type="button" onClick={onClose} className="btn btn-sm btn-primary mt-2">Back to reading</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              <label htmlFor="report-details" className="sr-only">Describe the problem</label>
              <textarea
                id="report-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, DETAILS_MAX))}
                rows={6}
                placeholder="What's wrong with this chapter? e.g. the text cuts off after the fight, a paragraph is repeated, the formatting is broken…"
                className="w-full resize-none rounded-xl border bg-transparent px-3 py-2.5 text-sm placeholder:opacity-50 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/25"
                style={{ borderColor: theme.border, color: theme.text }}
              />
              <p className="text-right text-[11px] opacity-50">{details.length}/{DETAILS_MAX}</p>
              {error && (
                <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-500" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: theme.border }}>
              <button type="button" onClick={onClose} className="btn btn-sm opacity-70 hover:opacity-100">Cancel</button>
              <button type="submit" disabled={!canSend} className={redButton}>
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

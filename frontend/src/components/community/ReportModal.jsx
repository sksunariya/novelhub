import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import * as api from '../../api/spaces';

// The report dialog.
//
// Reasons come from `spaces.moderation.reportReasons` in the registry, so an
// admin edits the taxonomy without a deploy and this file never hardcodes a
// list.
//
// SEVERITY IS DELIBERATELY NOT SENT to the client and not shown here. Knowing
// which reason hides content fastest is exactly what someone abusing the report
// button wants to know.
//
// The confirmation is deliberately vague about outcome: "a moderator will take
// a look", never "that worked, it's gone". Telling a reporter whether the
// threshold was reached turns the button into something they can calibrate.

const ReportModal = ({ targetType, targetId, onClose }) => {
  const [reasons, setReasons] = useState(null);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);

  useEffect(() => {
    api.reportReasons().then((d) => setReasons(d.reasons || [])).catch(() => setReasons([]));
  }, []);

  // Focus moves into the dialog on open, and Escape closes it. Without both, a
  // keyboard user is stranded behind a modal they cannot reach or dismiss.
  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Keep Tab inside the dialog while it is open. */
  const trapFocus = (event) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitReport(targetType, targetId, { reason, details });
      setDone(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'That could not be sent');
    } finally {
      setSubmitting(false);
    }
  };

  const applicable = (reasons || []).filter(
    (r) => r.appliesTo === 'all' || r.appliesTo === targetType
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onKeyDown={trapFocus}
        className="w-full max-w-md rounded-xl border border-line bg-night-surface p-5 shadow-card"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="report-title" className="font-display text-lg font-bold text-silver">
            {done ? 'Thanks' : `Report this ${targetType}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-silver-muted hover:text-silver"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <>
            {/* Says nothing about whether the content was hidden. */}
            <p className="text-sm text-silver-muted">
              A moderator will take a look. You will not be told the outcome, but reports from
              several people carry more weight than one.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full cursor-pointer rounded-full bg-crimson px-4 py-2 text-sm font-medium text-white"
            >
              Done
            </button>
          </>
        ) : !reasons ? (
          <p className="py-6 text-center text-sm text-silver-muted">Loading…</p>
        ) : (
          <form onSubmit={submit}>
            <fieldset>
              <legend className="mb-2 text-sm text-silver-muted">What is wrong with it?</legend>
              <div className="space-y-1">
                {applicable.map((option, i) => (
                  <label
                    key={option.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-silver hover:bg-night-raised"
                  >
                    <input
                      ref={i === 0 ? firstFieldRef : undefined}
                      type="radio"
                      name="report-reason"
                      value={option.key}
                      checked={reason === option.key}
                      onChange={(e) => setReason(e.target.value)}
                      className="cursor-pointer accent-crimson"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label htmlFor="report-details" className="mt-3 block text-xs text-silver-muted">
              Anything else? (optional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none"
            />

            {error && (
              <p role="alert" className="mt-2 text-sm text-crimson-soft">{error}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-silver-muted hover:text-silver"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !reason}
                className="cursor-pointer rounded-lg bg-crimson px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Sending…' : 'Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportModal;

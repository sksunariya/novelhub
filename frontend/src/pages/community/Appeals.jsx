import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, Bot, User, Clock, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCommunity } from '../../context/CommunityContext';
import * as api from '../../api/spaces';
import Spinner from '../../components/Spinner';

// Statements of reasons, and the appeal against them.
//
// THIS IS THE DSA ARTICLE 17 MECHANISM, not a courtesy feature. Every
// restriction placed on an account has to come with a statement of reasons, and
// that statement has to be contestable by a human process. The endpoints and the
// models existed from Phase 5; this page is what makes the obligation real,
// and until it shipped both PostDetail and UserProfile linked to a 404.
//
// TWO THINGS ARE DELIBERATELY ABSENT:
//
//   - WHO decided. The endpoint already withholds `decidedBy`. Naming the
//     moderator who removed something invites harassment and is not part of the
//     required disclosure.
//   - The removed content itself. Someone appealing knows what they wrote;
//     reproducing it here would make this page a way to read around moderation
//     for anyone who gains access to the account.
//
// What IS disclosed, because Article 17 requires it: the restriction, whether
// the ground was illegality or our terms, the specific rule as it read AT THE
// TIME, and whether a machine made the call.

const RESTRICTION_LABELS = {
  content_removed: 'Content removed',
  content_hidden: 'Content hidden pending review',
  content_demoted: 'Content shown less widely',
  account_suspended: 'Account suspended',
  account_banned: 'Account banned',
  space_banned: 'Banned from a space',
  feature_restricted: 'A feature was restricted',
};

const GROUND_LABELS = {
  illegal_content: 'Illegal content',
  terms_violation: 'Against our community rules',
};

// Plain words. "Upheld" and "overturned" are the terms the model uses, but on
// this page they are read by the person the decision was about.
const APPEAL_LABELS = {
  open: { text: 'Under review', tone: 'text-amber-200 border-amber-500/40' },
  upheld: { text: 'Reviewed — the original decision stands', tone: 'text-silver-muted border-line' },
  overturned: { text: 'Reviewed — the decision was reversed', tone: 'text-emerald-300 border-emerald-500/40' },
  partial: { text: 'Reviewed — the decision was partly changed', tone: 'text-emerald-300 border-emerald-500/40' },
  withdrawn: { text: 'You withdrew this appeal', tone: 'text-silver-muted border-line' },
  expired: { text: 'The appeal window closed', tone: 'text-silver-muted border-line' },
};

const formatDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

const AppealForm = ({ statement, onDone }) => {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.submitAppeal({ statementId: statement.id, reason });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.message || 'That appeal could not be submitted. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 border-t border-line pt-3">
      <label htmlFor={`appeal-${statement.id}`} className="mb-1 block text-xs font-medium text-silver">
        Why do you think this was wrong?
      </label>
      <textarea
        id={`appeal-${statement.id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={4000}
        placeholder="Explain what you think was misread, and anything a reviewer should know."
        className="w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none"
      />

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-200">
          {error}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        {/* Set expectations honestly. An appeal is reviewed by a person, and a
            person takes time. Implying otherwise produces a second complaint. */}
        <p className="text-xs text-silver-muted">A person reviews every appeal.</p>
        <button
          type="submit"
          disabled={sending || !reason.trim()}
          className="cursor-pointer rounded-full bg-crimson px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? 'Sending…' : 'Submit appeal'}
        </button>
      </div>
    </form>
  );
};

const StatementCard = ({ statement, onAppealed }) => {
  const [open, setOpen] = useState(false);
  const label = RESTRICTION_LABELS[statement.restrictionType] || 'A decision was taken';
  const appealState = statement.appealStatus ? APPEAL_LABELS[statement.appealStatus] : null;
  const windowOpen = statement.appealable && !statement.appealStatus;

  return (
    <li className="rounded-xl border border-line bg-night-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-silver">{label}</h2>
          <p className="mt-0.5 text-xs text-silver-muted">
            <time dateTime={statement.createdAt}>{formatDate(statement.createdAt)}</time>
            {' · '}
            {GROUND_LABELS[statement.ground] || statement.ground}
          </p>
        </div>

        {/* "Whether the decision was taken on the basis of automated means" is
            an explicit Article 17 disclosure, so it is shown plainly rather
            than buried. */}
        <span
          className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-silver-muted"
          title={
            statement.automated
              ? 'An automated system made this decision.'
              : 'A person made this decision.'
          }
        >
          {statement.automated ? (
            <><Bot className="h-3 w-3" aria-hidden="true" /> Automated decision</>
          ) : (
            <><User className="h-3 w-3" aria-hidden="true" /> Reviewed by a person</>
          )}
        </span>
      </div>

      {statement.ruleText && (
        <blockquote className="mt-3 border-l-2 border-crimson/50 pl-3 text-sm text-silver">
          {statement.ruleText}
          {/* The rule AS IT READ AT THE TIME. A space that rewrites its rules
              afterwards must not retroactively change what you were told. */}
          <span className="mt-0.5 block text-[11px] text-silver-muted">
            The rule as it read when the decision was made.
          </span>
        </blockquote>
      )}

      {statement.explanation && (
        <p className="mt-2 text-sm text-silver-muted">{statement.explanation}</p>
      )}

      {appealState && (
        <p className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${appealState.tone}`}>
          {statement.appealStatus === 'open'
            ? <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {appealState.text}
        </p>
      )}

      {windowOpen && (
        <div className="mt-3">
          {statement.appealDeadline && (
            <p className="mb-2 text-xs text-silver-muted">
              You can appeal until {formatDate(statement.appealDeadline)}.
            </p>
          )}
          {open ? (
            <AppealForm statement={statement} onDone={onAppealed} />
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-sm text-silver transition-colors hover:border-crimson hover:text-crimson-soft"
            >
              Appeal this decision
            </button>
          )}
        </div>
      )}

      {!statement.appealable && !appealState && (
        <p className="mt-3 text-xs text-silver-muted">This decision cannot be appealed.</p>
      )}
    </li>
  );
};

const Appeals = () => {
  const { user } = useAuth();
  const { enabled } = useCommunity();
  const [statements, setStatements] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.myStatements()
      .then((d) => setStatements(d.statements || []))
      .catch(() => setError('Those decisions could not be loaded right now.'));
  }, []);

  useEffect(() => {
    document.title = 'Moderation decisions · Apex NovelHub';
    if (user && enabled) load();
  }, [user, enabled, load]);

  if (!enabled) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Not available yet</h1>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-silver">Moderation decisions</h1>
        <p className="mt-2 text-sm text-silver-muted">
          <Link to="/login" className="text-crimson-soft underline">Sign in</Link> to see decisions
          about your account.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-silver">Moderation decisions</h1>
      <p className="mt-1 text-sm text-silver-muted">
        Every decision taken about your account or your content, why it was taken, and how to
        contest it.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200">
          {error}
        </p>
      )}

      {statements === null && !error && <Spinner />}

      {statements?.length === 0 && (
        <div className="mt-8 rounded-xl border border-line bg-night-surface p-8 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-silver-muted" aria-hidden="true" />
          <p className="mt-3 text-sm text-silver">No decisions have been taken about your account.</p>
          <p className="mt-1 text-xs text-silver-muted">Nothing to show here — which is the good outcome.</p>
        </div>
      )}

      {statements?.length > 0 && (
        <ul className="mt-5 space-y-3">
          {statements.map((statement) => (
            <StatementCard key={statement.id} statement={statement} onAppealed={load} />
          ))}
        </ul>
      )}
    </main>
  );
};

export default Appeals;

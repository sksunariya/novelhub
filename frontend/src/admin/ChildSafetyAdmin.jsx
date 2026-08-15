import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import * as api from '../api/community';
import Spinner from '../components/Spinner';

// The restricted child-safety queue.
//
// Requires the `child_safety` elevated permission. Being an admin is
// deliberately NOT sufficient — the permission is granted per account, which
// keeps the set of people who can reach this small and auditable.
//
// Content is never rendered. Only metadata, the match confidence and the
// preservation state. Viewing the material itself is a separate, logged action
// that issues a short-lived link.

const STATUS_STYLE = {
  detected: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-crimson/20 text-crimson-soft',
  reported: 'bg-sky-500/15 text-sky-300',
  false_positive: 'bg-emerald-500/15 text-emerald-300',
};

const ChildSafetyAdmin = () => {
  const [incidents, setIncidents] = useState(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    api.listIncidents({})
      .then((data) => setIncidents(data.incidents))
      .catch((error) => {
        // 403 is the expected answer for an admin without the permission, not
        // an error worth shouting about.
        if (error?.response?.status === 403) setDenied(true);
        setIncidents([]);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (incident, status) => {
    const note = window.prompt('Review note (recorded permanently):') || '';
    if (status === 'reported') {
      const reference = window.prompt('NCMEC report reference:') || '';
      await api.reviewIncident(incident._id, { status, note, reportReference: reference });
    } else {
      await api.reviewIncident(incident._id, { status, note });
    }
    load();
  };

  if (!incidents && !denied) return <Spinner full />;

  if (denied) {
    return (
      <div className="rounded-xl border border-line bg-night-surface p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-silver-muted" aria-hidden="true" />
        <h1 className="font-display text-xl font-bold text-silver">Restricted</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-silver-muted">
          This queue needs the child-safety permission, which is granted per account rather than
          inherited from being an administrator. That is deliberate — it keeps the number of people
          who can see this material small and accountable.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Child safety</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-crimson/15 px-3 py-1 text-xs font-medium text-crimson-soft">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Restricted queue
        </span>
      </div>

      <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson/5 p-4 text-sm text-silver-muted">
        <p>
          Records here are preserved, not moderated. They cannot be deleted by anyone, and the
          material is held on private storage regardless of the outcome — including when an incident
          is cleared as a false positive.
        </p>
        <p className="mt-2">
          Every view of this page is written to the audit log.
        </p>
      </div>

      {!incidents.length ? (
        <p className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
          No incidents.
        </p>
      ) : (
        <ul className="space-y-3">
          {incidents.map((incident) => (
            <li key={incident._id} className="rounded-xl border border-line bg-night-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[incident.status]}`}>
                  {incident.status.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-silver-muted">
                  matched by {incident.matchType} · confidence {Math.round((incident.matchConfidence || 0) * 100)}%
                </span>
                <span className="ml-auto text-xs text-silver-muted">
                  {new Date(incident.createdAt).toLocaleString()}
                </span>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-silver-muted">Uploader</dt>
                  <dd className="text-silver">{incident.uploaderSnapshot?.username || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-silver-muted">Account created</dt>
                  <dd className="text-silver">
                    {incident.uploaderSnapshot?.createdAt
                      ? new Date(incident.uploaderSnapshot.createdAt).toLocaleDateString()
                      : '—'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-silver-muted">IP</dt>
                  <dd className="font-mono text-silver">{incident.ipAddress || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-silver-muted">SHA-256</dt>
                  <dd className="truncate font-mono text-silver" title={incident.sha256}>
                    {incident.sha256?.slice(0, 24)}…
                  </dd>
                </div>
              </dl>

              {incident.status === 'detected' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => review(incident, 'confirmed')}
                    className="cursor-pointer rounded-lg bg-crimson px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => review(incident, 'reported')}
                    className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-silver-muted hover:text-silver"
                  >
                    Mark reported to NCMEC
                  </button>
                  <button
                    type="button"
                    onClick={() => review(incident, 'false_positive')}
                    className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-silver-muted hover:text-emerald-300"
                  >
                    False positive
                  </button>
                </div>
              )}

              {incident.reviewNote && (
                <p className="mt-2 text-xs text-silver-muted">Note: {incident.reviewNote}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ChildSafetyAdmin;

import { useState, useEffect, useCallback } from 'react';
import { Play, CheckCircle2, XCircle, MinusCircle, Loader2 } from 'lucide-react';
import { getJobs, runJob, getJobRuns } from '../api/adminConfig';
import { formatRelativeTime } from '../utils/dateUtils';
import Spinner from '../components/Spinner';

const STATUS_ICON = {
  success: { Icon: CheckCircle2, className: 'text-green-400' },
  failed: { Icon: XCircle, className: 'text-crimson-soft' },
  skipped: { Icon: MinusCircle, className: 'text-silver-muted' },
  running: { Icon: Loader2, className: 'text-silver-muted animate-spin' },
};

const JobsAdmin = () => {
  const [state, setState] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const [status, history] = await Promise.all([getJobs(), getJobRuns({ limit: 20 })]);
    setState(status);
    setRuns(history.runs || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async (name) => {
    setBusy(name);
    setFlash('');
    try {
      const result = await runJob(name);
      setFlash(
        result.skipped
          ? `${name} skipped: ${result.reason}`
          : result.error
            ? `${name} failed: ${result.error}`
            : `${name} finished`
      );
      await load();
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not run that job');
    } finally {
      setBusy('');
    }
  };

  if (!state) return <Spinner />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-silver">Jobs</h1>
        <p className="text-xs text-silver-muted">
          Scheduled work. Instance {state.instance} · {state.running ? 'scheduler running' : 'scheduler stopped'}
        </p>
      </div>

      {flash && <p className="mb-4 rounded-lg border border-line bg-night-surface p-3 text-sm text-silver">{flash}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-silver-muted">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Next</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {state.jobs.map((job) => {
              const status = job.lastRun && STATUS_ICON[job.lastRun.status];
              return (
                <tr key={job.name}>
                  <td className="px-4 py-3">
                    <p className="text-silver">{job.label || job.name}</p>
                    <p className="text-[11px] text-silver-muted">{job.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-silver-muted">{job.schedule}</code>
                    {/* Schedules backed by a setting are editable without a deploy. */}
                    {job.scheduleKey && (
                      <p className="text-[10px] text-crimson-soft">configurable</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {job.lastRun ? (
                      <span className="flex items-center gap-1.5 text-xs text-silver-muted">
                        {status && <status.Icon className={`h-3.5 w-3.5 ${status.className}`} aria-hidden="true" />}
                        {formatRelativeTime(job.lastRun.startedAt)}
                        {job.lastRun.durationMs != null && ` · ${job.lastRun.durationMs}ms`}
                      </span>
                    ) : (
                      <span className="text-xs text-silver-muted">never</span>
                    )}
                    {job.lastRun?.error && (
                      <p className="text-[11px] text-crimson-soft">{job.lastRun.error}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-silver-muted">
                    {job.nextRun ? formatRelativeTime(job.nextRun) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => trigger(job.name)}
                      disabled={busy === job.name}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-silver-muted transition-colors hover:border-crimson/60 hover:text-crimson-soft disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" aria-hidden="true" />
                      {busy === job.name ? 'Running' : 'Run now'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 font-display text-lg font-bold text-silver">Recent runs</h2>
      <div className="overflow-hidden rounded-xl border border-line bg-night-surface">
        {runs.length === 0 ? (
          <p className="p-6 text-center text-sm text-silver-muted">Nothing has run yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <li key={run._id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-silver">{run.job}</span>
                  <span className="ml-2 text-xs text-silver-muted">
                    {run.trigger}
                    {run.triggeredBy?.username ? ` by ${run.triggeredBy.username}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-silver-muted">
                  {run.status} · {formatRelativeTime(run.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default JobsAdmin;

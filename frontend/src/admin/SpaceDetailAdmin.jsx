import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, HardDrive, Users, FileText, Flag } from 'lucide-react';
import * as api from '../api/community';
import { getRegistry } from '../api/adminConfig';
import Spinner from '../components/Spinner';

// One space, in depth.
//
// The Settings tab is the concrete answer to "admins control every single
// thing": it renders every space-overridable key, shows whether the space has
// diverged from the global default, and lets an admin force keys the owner
// cannot touch.

const TABS = ['Overview', 'Settings', 'Moderators', 'Danger zone'];

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const Stat = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border border-line bg-night-surface p-4">
    <div className="flex items-center gap-2 text-xs text-silver-muted">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </div>
    <p className="mt-1 font-display text-2xl font-bold text-silver">{value}</p>
  </div>
);

const SpaceDetailAdmin = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [registry, setRegistry] = useState(null);
  const [draft, setDraft] = useState({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.getSpace(id).then(setData).catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'Settings' && !registry) {
      getRegistry().then(setRegistry).catch(() => setRegistry({ settings: [] }));
    }
  }, [tab, registry]);

  if (!data) return <Spinner full />;
  const { space, stats, moderators } = data;

  // Only keys the registry marks space-overridable. Admins can force others,
  // but those belong in the global config page, not here — mixing them would
  // make it unclear which change affects one space and which affects the site.
  const overridable = (registry?.settings || []).filter((s) => s.spaceOverridable);

  const saveOverrides = async () => {
    setSaving(true);
    try {
      await api.forceOverrides(space._id, draft, reason);
      setDraft({});
      setReason('');
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link
        to="/admin/spaces"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-silver-muted transition-colors hover:text-silver"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All spaces
      </Link>

      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-bold text-silver">{space.name}</h1>
        <code className="rounded bg-night-raised px-2 py-0.5 text-xs text-silver-muted">/c/{space.slug}</code>
        <span className="rounded-full bg-night-raised px-2 py-0.5 text-[11px] text-silver-muted">
          {space.status}
        </span>
      </div>

      <div className="mb-5 flex gap-2 border-b border-line">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'page' : undefined}
            className={`cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === name ? 'border-crimson text-silver' : 'border-transparent text-silver-muted hover:text-silver'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Users} label="Members" value={stats.members} />
          <Stat icon={FileText} label="Posts" value={stats.posts} />
          <Stat icon={Flag} label="Open reports" value={stats.openReports} />
          {/* Per-space storage cost — the reason the S3 layout puts spaceId
              at the root of the key. */}
          <Stat icon={HardDrive} label="Media stored" value={mb(stats.mediaBytes)} />
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-xs text-silver-muted">
              Owner: <span className="text-silver">{space.owner?.username}</span> ·{' '}
              {space.owner?.email} · created {new Date(space.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      )}

      {tab === 'Settings' && (
        !registry ? <Spinner /> : (
          <div>
            <p className="mb-4 text-sm text-silver-muted">
              These are the settings a space owner may change for themselves. Anything not
              overridden follows the global value, so changing the global moves every space that
              has not diverged.
            </p>
            <div className="space-y-2">
              {overridable.map((setting) => {
                const overridden = space.overrides && space.overrides[setting.key] !== undefined;
                const current = overridden ? space.overrides[setting.key] : setting.default;
                const pending = draft[setting.key];
                return (
                  <div key={setting.key} className="rounded-lg border border-line bg-night-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-silver">{setting.label}</p>
                      {overridden ? (
                        <span className="rounded bg-crimson/15 px-1.5 py-0.5 text-[10px] text-crimson-soft">
                          overridden
                        </span>
                      ) : (
                        <span className="rounded bg-night-raised px-1.5 py-0.5 text-[10px] text-silver-muted">
                          inheriting
                        </span>
                      )}
                      <code className="ml-auto text-[11px] text-silver-muted">{setting.key}</code>
                    </div>
                    {setting.help && <p className="mt-1 text-xs text-silver-muted">{setting.help}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      {setting.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={pending !== undefined ? pending : Boolean(current)}
                          onChange={(e) => setDraft((d) => ({ ...d, [setting.key]: e.target.checked }))}
                          aria-label={setting.label}
                          className="cursor-pointer accent-crimson"
                        />
                      ) : (
                        <input
                          type={setting.type === 'integer' || setting.type === 'number' ? 'number' : 'text'}
                          value={pending !== undefined ? pending : current ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [setting.key]:
                                setting.type === 'integer' ? Number(e.target.value) : e.target.value,
                            }))
                          }
                          aria-label={setting.label}
                          className="w-40 rounded border border-line bg-night px-2 py-1 text-sm text-silver focus:border-crimson focus:outline-none"
                        />
                      )}
                      <span className="text-xs text-silver-muted">
                        global default: {String(setting.default)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {Object.keys(draft).length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-crimson/40 bg-crimson/5 p-3">
                <p className="text-sm text-silver">{Object.keys(draft).length} change(s) pending</p>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (recorded in both audit trails)"
                  aria-label="Reason for settings change"
                  className="min-w-[16rem] flex-1 rounded-lg border border-line bg-night px-3 py-1.5 text-sm text-silver focus:border-crimson focus:outline-none"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveOverrides}
                  className="cursor-pointer rounded-lg bg-crimson px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({})}
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-silver-muted hover:text-silver"
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        )
      )}

      {tab === 'Moderators' && (
        <div className="rounded-xl border border-line bg-night-surface">
          {!moderators.length ? (
            <p className="p-6 text-center text-sm text-silver-muted">No moderators.</p>
          ) : (
            <ul className="divide-y divide-line">
              {moderators.map((m) => (
                <li key={m._id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="font-medium text-silver">{m.user?.username || '—'}</span>
                  <span className="rounded-full bg-night-raised px-2 py-0.5 text-[11px] text-silver-muted">
                    {m.role}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    {Object.entries(m.permissions || {})
                      .filter(([, on]) => on)
                      .map(([key]) => (
                        <span key={key} className="rounded bg-night-raised px-1.5 py-0.5 text-[10px] text-silver-muted">
                          {key.replace(/^manage/, '').toLowerCase()}
                        </span>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'Danger zone' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-night-surface p-4">
            <p className="font-medium text-silver">Rebuild counters</p>
            <p className="mt-1 text-sm text-silver-muted">
              Recomputes member and post counts from source. Counters are a cache; the underlying
              rows are truth, so this is always safe to run.
            </p>
            <button
              type="button"
              onClick={() => api.recountSpace(space._id).then(load)}
              className="mt-3 flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-silver-muted hover:text-silver"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Rebuild
            </button>
          </div>
          <div className="rounded-xl border border-crimson/30 bg-crimson/5 p-4">
            <p className="font-medium text-silver">Lifecycle</p>
            <p className="mt-1 text-sm text-silver-muted">
              Quarantine, archive and ban are on the{' '}
              <Link to="/admin/spaces" className="text-crimson-soft underline">spaces list</Link>,
              where the consequences of each are spelled out before you confirm.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpaceDetailAdmin;

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Crown, Eye, EyeOff, Globe, User as UserIcon, RotateCcw, Lock, ShieldCheck } from 'lucide-react';
import {
  getAccessModules,
  updateGlobalAccess,
  listAdminAccounts,
  updateAdminAccess,
  setAdminRole,
} from '../api/adminConfig';
import Spinner from '../components/Spinner';

// The superadmin's view of the portal: every module, and for each one whether
// admins may see it.
//
// Two tabs because the two questions are genuinely different. "Should anyone
// see Revenue?" is a policy decision about the product; "should Priya see
// Revenue?" is a decision about one person. Collapsing them into one screen
// makes the common case — set it once for everyone — as fiddly as the rare one.

const GROUP_LABELS = {
  overview: 'Overview',
  content: 'Content',
  monetization: 'Monetization',
  analytics: 'Analytics',
  community: 'Community',
  people: 'People',
  system: 'System',
  governance: 'Governance',
};

const GROUP_ORDER = ['overview', 'content', 'monetization', 'analytics', 'community', 'people', 'system', 'governance'];

const byGroup = (modules) =>
  GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group] || group,
    modules: modules.filter((m) => m.group === group),
  })).filter((section) => section.modules.length > 0);

/** Visible / hidden switch. Locked modules render as an explanation, not a control. */
const VisibilityToggle = ({ visible, disabled, onChange, lockReason }) => {
  if (lockReason) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-silver-muted">
        <Lock className="h-3 w-3" aria-hidden="true" />
        {lockReason}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onChange(!visible)}
      disabled={disabled}
      aria-pressed={visible}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        visible
          ? 'border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20'
          : 'border-line bg-night-raised text-silver-muted hover:text-silver'
      }`}
    >
      {visible ? <Eye className="h-3 w-3" aria-hidden="true" /> : <EyeOff className="h-3 w-3" aria-hidden="true" />}
      {visible ? 'Visible' : 'Hidden'}
    </button>
  );
};

/** Module name plus the badges that qualify what toggling it actually does. */
const ModuleLabel = ({ module }) => (
  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-silver">
    {module.label}
    {module.apiOnly && (
      <span
        className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-silver-muted"
        title="Governs the API only — there is no screen for this in the portal yet"
      >
        API only
      </span>
    )}
  </p>
);

const SOURCE_LABEL = {
  user: 'set for this admin',
  global: 'from the global default',
  default: 'from the global default',
  always_on: 'always visible',
  superadmin_only: 'superadmin only',
};

const AccessControlAdmin = () => {
  const [tab, setTab] = useState('global');
  const [modules, setModules] = useState([]);
  const [globals, setGlobals] = useState({});
  const [admins, setAdmins] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const [registry, accounts] = await Promise.all([getAccessModules(), listAdminAccounts()]);
    setModules(registry.modules || []);
    setGlobals(registry.globals || {});
    setAdmins(accounts.admins || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo(() => byGroup(modules), [modules]);
  const selected = admins.find((a) => a._id === selectedId) || null;

  // --- global ------------------------------------------------------------

  /**
   * @param {boolean|null} visible  null clears the decision entirely, which is
   *   not the same as setting it true — an explicit "visible" pins the module
   *   on, while no decision lets a future default apply.
   */
  const toggleGlobal = async (moduleId, visible) => {
    setBusy(moduleId);
    setFlash('');
    try {
      const { globals: next } = await updateGlobalAccess({ [moduleId]: visible });
      setGlobals(next);
      // Per-admin rows inherit from the global default, so their resolved
      // state may have just changed underneath us.
      const accounts = await listAdminAccounts();
      setAdmins(accounts.admins || []);
      setFlash(
        visible === null
          ? `${moduleId} has no global decision set — it falls back to visible.`
          : `${moduleId} is now ${visible ? 'visible' : 'hidden'} for admins by default.`
      );
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not save that change');
    } finally {
      setBusy('');
    }
  };

  // --- per admin ---------------------------------------------------------

  const toggleForAdmin = async (moduleId, visible) => {
    if (!selected) return;
    setBusy(moduleId);
    setFlash('');
    try {
      await updateAdminAccess(selected._id, { [moduleId]: visible });
      const accounts = await listAdminAccounts();
      setAdmins(accounts.admins || []);
      setFlash(`${moduleId} is now ${visible ? 'visible' : 'hidden'} for ${selected.username}.`);
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not save that change');
    } finally {
      setBusy('');
    }
  };

  /** Drop the per-admin exception so the account follows the global default again. */
  const clearOverride = async (moduleId) => {
    if (!selected) return;
    setBusy(moduleId);
    try {
      await updateAdminAccess(selected._id, { [moduleId]: null });
      const accounts = await listAdminAccounts();
      setAdmins(accounts.admins || []);
      setFlash(`${moduleId} follows the global default again for ${selected.username}.`);
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not clear that override');
    } finally {
      setBusy('');
    }
  };

  const changeRole = async (id, role) => {
    // Promotion to the owner tier is irreversible in practice — the new account
    // can see everything, including the ability to demote whoever promoted it.
    // A one-click path to that is not a good idea.
    const target = admins.find((a) => a._id === id);
    if (role === 'superadmin') {
      const confirmed = window.confirm(
        `Promote ${target?.username || 'this admin'} to superadmin?\n\n` +
          'They will see the entire admin portal, hold every elevated permission ' +
          'including the child safety queue, read all paid content for free, and be ' +
          'able to change what other admins — including you — can see.'
      );
      if (!confirmed) return;
    }

    setBusy(id);
    setFlash('');
    try {
      await setAdminRole(id, role);
      const accounts = await listAdminAccounts();
      setAdmins(accounts.admins || []);
      setFlash(`Role updated to ${role}.`);
    } catch (error) {
      setFlash(error.response?.data?.message || 'Could not change that role');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-silver">
          <Crown className="h-5 w-5 text-crimson-soft" aria-hidden="true" /> Access control
        </h1>
        <p className="mt-1 max-w-2xl text-xs text-silver-muted">
          Decide what the admin portal looks like for admins. A hidden module disappears from their navigation and its
          API routes stop answering them — hiding the link alone would leave the data one guessed URL away.
        </p>
      </div>

      <div className="mb-5 flex gap-1 rounded-lg border border-line bg-night-surface p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab('global')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 transition-colors ${
            tab === 'global' ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:text-silver'
          }`}
        >
          <Globe className="h-4 w-4" aria-hidden="true" /> Global default
        </button>
        <button
          type="button"
          onClick={() => setTab('admins')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 transition-colors ${
            tab === 'admins' ? 'bg-crimson/15 text-crimson-soft' : 'text-silver-muted hover:text-silver'
          }`}
        >
          <UserIcon className="h-4 w-4" aria-hidden="true" /> Per admin ({admins.length})
        </button>
      </div>

      {flash && (
        <p className="mb-4 rounded-lg border border-line bg-night-surface p-3 text-sm text-silver">{flash}</p>
      )}

      {tab === 'global' && (
        <div className="space-y-5">
          <p className="rounded-lg border border-line bg-night-surface p-3 text-xs text-silver-muted">
            Applies to every admin who has no exception set for that module. Hiding a module also withdraws the power
            behind it — an admin without Chapter comments cannot moderate a comment anywhere, not just here. Changes
            reach other admins within a few seconds.
          </p>

          {sections.map((section) => (
            <div key={section.group} className="overflow-hidden rounded-xl border border-line bg-night-surface">
              <div className="border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-silver-muted">
                {section.label}
              </div>
              <div className="divide-y divide-line">
                {section.modules.map((module) => {
                  const visible = module.superOnly
                    ? false
                    : module.alwaysOn
                      ? true
                      : globals[module.id] !== false;
                  const lockReason = module.superOnly
                    ? 'Superadmin only'
                    : module.alwaysOn
                      ? 'Always visible'
                      : '';
                  // A module with no stored decision is visible by fallback, not
                  // by an explicit choice. Only the explicit ones can be cleared.
                  const decided = Object.prototype.hasOwnProperty.call(globals, module.id);
                  return (
                    <div key={module.id} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <ModuleLabel module={module} />
                        <p className="mt-0.5 text-xs text-silver-muted">{module.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {decided && !lockReason && (
                          <button
                            type="button"
                            onClick={() => toggleGlobal(module.id, null)}
                            disabled={busy === module.id}
                            title="Clear this decision — the module falls back to visible"
                            className="rounded-full border border-line p-1.5 text-silver-muted transition-colors hover:text-silver disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          </button>
                        )}
                        <VisibilityToggle
                          visible={visible}
                          disabled={busy === module.id}
                          lockReason={lockReason}
                          onChange={(next) => toggleGlobal(module.id, next)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'admins' && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <div className="overflow-hidden rounded-xl border border-line bg-night-surface">
            <div className="border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-silver-muted">
              Accounts
            </div>
            <div className="divide-y divide-line">
              {admins.map((admin) => {
                const isSuper = admin.role === 'superadmin';
                return (
                  <button
                    key={admin._id}
                    type="button"
                    onClick={() => setSelectedId(admin._id)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${
                      selectedId === admin._id ? 'bg-crimson/10' : 'hover:bg-night-raised'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm text-silver">
                        {isSuper && <Crown className="h-3 w-3 shrink-0 text-crimson-soft" aria-hidden="true" />}
                        {admin.username}
                      </span>
                      <span className="block truncate text-xs text-silver-muted">{admin.email}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-silver-muted">
                      {isSuper ? 'all' : `${admin.hiddenCount} hidden`}
                    </span>
                  </button>
                );
              })}
              {admins.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-silver-muted">No admin accounts yet.</p>
              )}
            </div>
          </div>

          <div>
            {!selected && (
              <div className="rounded-xl border border-line bg-night-surface p-8 text-center text-sm text-silver-muted">
                Pick an admin to see and change what their portal looks like.
              </div>
            )}

            {selected && selected.role === 'superadmin' && (
              <div className="rounded-xl border border-line bg-night-surface p-6">
                <p className="flex items-center gap-2 text-sm font-medium text-silver">
                  <Crown className="h-4 w-4 text-crimson-soft" aria-hidden="true" /> {selected.username} is a superadmin
                </p>
                <p className="mt-2 max-w-xl text-xs text-silver-muted">
                  Superadmins see the whole portal, hold every elevated permission, and read paid content without
                  spending credits. There is nothing to restrict here — that is what the role means.
                </p>
                <button
                  type="button"
                  onClick={() => changeRole(selected._id, 'admin')}
                  disabled={busy === selected._id}
                  className="mt-4 rounded-lg border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver disabled:opacity-50"
                >
                  Demote to admin
                </button>
              </div>
            )}

            {selected && selected.role !== 'superadmin' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-night-surface px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-silver">{selected.username}</p>
                    <p className="text-xs text-silver-muted">
                      {selected.email} · {Object.keys(selected.overrides || {}).length} exception(s) to the global
                      default
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => changeRole(selected._id, 'superadmin')}
                    disabled={busy === selected._id}
                    className="flex items-center gap-1.5 rounded-lg border border-crimson/40 px-3 py-1.5 text-xs text-crimson-soft transition-colors hover:bg-crimson/10 disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Promote to superadmin
                  </button>
                </div>

                {sections.map((section) => (
                  <div key={section.group} className="overflow-hidden rounded-xl border border-line bg-night-surface">
                    <div className="border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-silver-muted">
                      {section.label}
                    </div>
                    <div className="divide-y divide-line">
                      {section.modules.map((module) => {
                        const visible = Boolean(selected.visibility?.[module.id]);
                        const source = selected.sources?.[module.id];
                        const lockReason = module.superOnly
                          ? 'Superadmin only'
                          : module.alwaysOn
                            ? 'Always visible'
                            : '';
                        return (
                          <div key={module.id} className="flex items-start justify-between gap-4 px-4 py-3">
                            <div className="min-w-0">
                              <ModuleLabel module={module} />
                              <p className="mt-0.5 text-xs text-silver-muted">
                                {SOURCE_LABEL[source] || module.description}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 pt-0.5">
                              {source === 'user' && (
                                <button
                                  type="button"
                                  onClick={() => clearOverride(module.id)}
                                  disabled={busy === module.id}
                                  title="Follow the global default again"
                                  className="rounded-full border border-line p-1.5 text-silver-muted transition-colors hover:text-silver disabled:opacity-50"
                                >
                                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                </button>
                              )}
                              <VisibilityToggle
                                visible={visible}
                                disabled={busy === module.id}
                                lockReason={lockReason}
                                onChange={(next) => toggleForAdmin(module.id, next)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AccessControlAdmin;

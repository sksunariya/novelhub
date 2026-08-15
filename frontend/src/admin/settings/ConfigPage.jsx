import { useState, useMemo, useEffect } from 'react';
import { Save, Undo2, Search, Check } from 'lucide-react';
import { useConfig, useUnsavedGuard } from './useConfig';
import { SETTING_TABS, findTabForSection } from './sections';
import SettingField from './SettingField';
import SettingsSearch from './SettingsSearch';
import ImpactDialog from './ImpactDialog';
import PaypalStatus from './PaypalStatus';
import Spinner from '../../components/Spinner';

const ConfigPage = () => {
  const config = useConfig();
  const [tabId, setTabId] = useState(SETTING_TABS[0].id);
  const [highlight, setHighlight] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingImpact, setPendingImpact] = useState(null);

  // Saving routes through a confirmation whenever one of the changed settings
  // is marked as having wide effects. Everything else saves directly.
  const requestSave = () => {
    const risky = config.dirtyKeys
      .map((key) => ({ def: config.byKey[key], value: config.valueOf(key) }))
      .filter((entry) => entry.def?.requiresConfirmation);

    if (risky.length) setPendingImpact(risky);
    else config.save();
  };

  const confirmSave = () => {
    setPendingImpact(null);
    config.save();
  };

  const dirty = config.dirtyKeys.length > 0;
  useUnsavedGuard(dirty);

  // Cmd/Ctrl+K opens search from anywhere on the page.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bySection = useMemo(() => {
    const map = {};
    config.defs.forEach((def) => {
      (map[def.section] = map[def.section] || []).push(def);
    });
    return map;
  }, [config.defs]);

  // SETTING_TABS is the full map of the screen; the API returns only the
  // sections this admin's modules cover. Rendering the full list against a
  // filtered payload would leave empty tabs standing — which both looks broken
  // and advertises the existence of everything being withheld.
  const tabs = useMemo(() => {
    const available = SETTING_TABS.map((entry) => ({
      ...entry,
      groups: entry.groups.filter((group) => (bySection[group.section] || []).length > 0),
    })).filter((entry) => entry.groups.length > 0);
    return available;
  }, [bySection]);

  // The selected tab can disappear — on first load, or if access changes while
  // the page is open. Fall back rather than rendering nothing.
  useEffect(() => {
    if (tabs.length && !tabs.some((entry) => entry.id === tabId)) setTabId(tabs[0].id);
  }, [tabs, tabId]);

  // Jumping from search switches tab, scrolls to the field and flashes it.
  const jumpTo = (key) => {
    const def = config.byKey[key];
    if (!def) return;
    const tab = findTabForSection(def.section);
    if (tab) setTabId(tab.id);
    setSearchOpen(false);
    setHighlight(key);
    setTimeout(() => {
      document.getElementById(`row-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => setHighlight(null), 2200);
  };

  if (config.loading) return <Spinner />;

  if (!tabs.length) {
    return (
      <div className="rounded-xl border border-line bg-night-surface p-8 text-center">
        <p className="text-sm text-silver">No settings are available to your account.</p>
        <p className="mt-1 text-xs text-silver-muted">
          Settings are grouped into modules. Ask a superadmin if you need one of them.
        </p>
      </div>
    );
  }

  const tab = tabs.find((t) => t.id === tabId) || tabs[0];

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Settings</h1>
          <p className="text-xs text-silver-muted">
            {config.defs.length} settings. Every one is read live by the running site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-silver-muted transition-colors hover:text-silver"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" /> Search settings
          <kbd className="rounded border border-line px-1 text-[10px]">⌘K</kbd>
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
        {tabs.map((entry) => {
          const dirtyHere = entry.groups.some((group) =>
            (bySection[group.section] || []).some((def) => config.dirtyKeys.includes(def.key))
          );
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTabId(entry.id)}
              className={`relative rounded-full px-3 py-1.5 text-sm transition-colors ${
                entry.id === tabId
                  ? 'bg-crimson/15 text-crimson-soft'
                  : 'text-silver-muted hover:text-silver'
              }`}
            >
              {entry.label}
              {dirtyHere && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-crimson" />}
            </button>
          );
        })}
      </div>

      <div className="space-y-8">
        {tab.groups.map((group) => {
          const defs = bySection[group.section] || [];
          if (!defs.length) return null;

          return (
            <section key={group.section}>
              <h2 className="mb-1 font-display text-lg font-bold text-silver">{group.title}</h2>
              <p className="mb-3 text-[11px] uppercase tracking-wide text-silver-muted">{group.section}</p>

              {/* Credentials are the one setting group where "saved" and
                  "working" are different things, so this section gets a live
                  check rather than just fields. */}
              {group.section === 'monetization.paypal' && <PaypalStatus />}

              <div className="divide-y divide-line rounded-xl border border-line bg-night-surface px-4">
                {defs.map((def) => {
                  // A dependsOn that is not satisfied hides the field entirely,
                  // so rental options do not sit enabled-looking under a
                  // permanent access mode.
                  if (def.dependsOn) {
                    const other = config.valueOf(def.dependsOn.key);
                    if ('equals' in def.dependsOn && other !== def.dependsOn.equals) return null;
                    if ('notEquals' in def.dependsOn && other === def.dependsOn.notEquals) return null;
                  }

                  return (
                    <div
                      key={def.key}
                      id={`row-${def.key}`}
                      className={highlight === def.key ? 'rounded-lg bg-crimson/10 transition-colors' : ''}
                    >
                      <SettingField
                        def={def}
                        value={config.valueOf(def.key)}
                        isDefault={config.isDefault(def.key)}
                        error={config.errors[def.key]}
                        onChange={(value) => config.setValue(def.key, value)}
                        onReset={() => config.reset(def.key)}
                        onValidity={(ok) => config.markValidity(def.key, ok)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Sticky save bar — appears only once something has changed. */}
      {(dirty || config.flash) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-night-surface/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-silver">
              {config.flash ? (
                <span className="flex items-center gap-1.5 text-green-400">
                  <Check className="h-4 w-4" aria-hidden="true" /> {config.flash}
                </span>
              ) : (
                `${config.dirtyKeys.length} unsaved change${config.dirtyKeys.length === 1 ? '' : 's'}`
              )}
            </p>
            {dirty && (
              <div className="flex items-center gap-2">
                {config.blockedKeys.length > 0 && (
                  <span className="text-xs text-crimson-soft">Fix invalid JSON before saving</span>
                )}
                <button
                  type="button"
                  onClick={config.discard}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-silver-muted transition-colors hover:text-silver"
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" /> Discard
                </button>
                <button
                  type="button"
                  onClick={requestSave}
                  disabled={config.saving || config.blockedKeys.length > 0}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {config.saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <SettingsSearch open={searchOpen} onClose={() => setSearchOpen(false)} onPick={jumpTo} />
      <ImpactDialog
        pending={pendingImpact}
        onConfirm={confirmSave}
        onCancel={() => setPendingImpact(null)}
      />
    </div>
  );
};

export default ConfigPage;

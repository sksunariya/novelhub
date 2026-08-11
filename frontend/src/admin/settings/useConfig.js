import { useState, useEffect, useCallback, useMemo } from 'react';
import { getRegistry, getConfig, patchConfig, resetConfig } from '../../api/adminConfig';

/**
 * Loads the registry plus current values, tracks edits, and saves them.
 *
 * Draft state is kept separate from saved state so the save bar can show what
 * actually changed and a discard is a local operation. The whole patch is
 * rejected together server-side, so a form never half-saves.
 */
export const useConfig = () => {
  const [defs, setDefs] = useState([]);
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [invalidFields, setInvalidFields] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [registry, values] = await Promise.all([getRegistry(), getConfig()]);
      setDefs(registry.settings);
      const map = {};
      values.settings.forEach((row) => {
        // Secrets report only whether they are configured.
        map[row.key] = row.secret ? row.configured : row.value;
      });
      setSaved(map);
      setDraft({});
      setErrors({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byKey = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d])), [defs]);
  const defaults = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.default])), [defs]);

  const valueOf = useCallback(
    (key) => (key in draft ? draft[key] : saved[key]),
    [draft, saved]
  );

  const isDefault = useCallback(
    (key) => JSON.stringify(valueOf(key)) === JSON.stringify(defaults[key]),
    [valueOf, defaults]
  );

  const setValue = useCallback(
    (key, value) => {
      setDraft((prev) => {
        // Editing back to the saved value clears the dirty flag rather than
        // leaving a no-op change in the patch.
        if (JSON.stringify(value) === JSON.stringify(saved[key])) {
          const { [key]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [key]: value };
      });
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [saved]
  );

  const markValidity = useCallback((key, ok) => {
    setInvalidFields((prev) => ({ ...prev, [key]: !ok }));
  }, []);

  const dirtyKeys = Object.keys(draft);
  const blockedKeys = Object.keys(invalidFields).filter((key) => invalidFields[key]);

  const save = useCallback(async () => {
    if (!dirtyKeys.length || blockedKeys.length) return;
    setSaving(true);
    setErrors({});
    try {
      const result = await patchConfig(draft);
      setSaved((prev) => ({ ...prev, ...draft }));
      setDraft({});
      setFlash(result.changed ? `Saved ${result.changed} change${result.changed === 1 ? '' : 's'}` : 'No changes');
      setTimeout(() => setFlash(''), 2500);
    } catch (error) {
      // Per-field errors come back keyed by setting, so the form can point at
      // exactly what failed instead of showing one generic message.
      const perField = error.response?.data?.errors;
      if (perField) setErrors(perField);
      else setFlash(error.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [draft, dirtyKeys.length, blockedKeys.length]);

  const discard = useCallback(() => {
    setDraft({});
    setErrors({});
    setInvalidFields({});
  }, []);

  const reset = useCallback(
    async (key) => {
      await resetConfig([key]);
      setSaved((prev) => ({ ...prev, [key]: defaults[key] }));
      setDraft((prev) => {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [defaults]
  );

  return {
    defs,
    byKey,
    loading,
    saving,
    flash,
    errors,
    dirtyKeys,
    blockedKeys,
    valueOf,
    isDefault,
    setValue,
    markValidity,
    save,
    discard,
    reset,
    reload: load,
  };
};

/** Warn before navigating away with unsaved edits. */
export const useUnsavedGuard = (dirty) => {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
};

import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import client from '../../api/client';

const SEVERITY = {
  high: { border: 'border-crimson/60', text: 'text-crimson-soft' },
  medium: { border: 'border-line', text: 'text-silver' },
  low: { border: 'border-line', text: 'text-silver-muted' },
};

/**
 * Shows what a change will actually do before it is saved.
 *
 * Only appears for settings the registry marks `requiresConfirmation`. The
 * numbers come from the server, which walks the real data — an estimate would
 * defeat the purpose.
 */
const ImpactDialog = ({ pending, onConfirm, onCancel }) => {
  const [previews, setPreviews] = useState(null);

  useEffect(() => {
    if (!pending) {
      setPreviews(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        pending.map(async ({ def, value }) => {
          try {
            const { data } = await client.post('/admin/config/preview-impact', { key: def.key, value });
            return { def, ...data };
          } catch (error) {
            return { def, hasPreview: false, severity: 'low', summary: '', facts: [] };
          }
        })
      );
      if (!cancelled) setPreviews(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  if (!pending) return null;

  const worst = previews?.some((p) => p.severity === 'high') ? 'high' : 'medium';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="presentation">
      <div
        role="dialog"
        aria-label="Confirm changes"
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-night-surface p-6 shadow-card"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${SEVERITY[worst].text}`} aria-hidden="true" />
          <div>
            <h2 className="font-display text-lg font-bold text-silver">Confirm these changes</h2>
            <p className="text-xs text-silver-muted">
              {pending.length === 1 ? 'This setting has' : `${pending.length} settings have`} effects beyond the
              value itself.
            </p>
          </div>
        </div>

        {!previews ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-silver-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working out the impact...
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {previews.map((preview) => (
              <div
                key={preview.def.key}
                className={`rounded-xl border bg-night p-4 ${SEVERITY[preview.severity]?.border || 'border-line'}`}
              >
                <p className="text-sm font-medium text-silver">{preview.def.label}</p>
                <p className="mt-0.5 text-[11px] text-silver-muted">{preview.def.key}</p>

                {preview.hasPreview ? (
                  <>
                    <p className={`mt-2 text-sm ${SEVERITY[preview.severity]?.text || 'text-silver'}`}>
                      {preview.summary}
                    </p>
                    {preview.facts?.length > 0 && (
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
                        {preview.facts.slice(0, 10).map((fact) => (
                          <div key={fact.label} className="flex justify-between gap-2">
                            <dt className="truncate text-silver-muted">{fact.label}</dt>
                            <dd className="shrink-0 tabular-nums text-silver">{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-silver-muted">
                    Changing from{' '}
                    <code className="text-silver">{JSON.stringify(preview.current)}</code> to{' '}
                    <code className="text-silver">{JSON.stringify(preview.next)}</code>.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm text-silver-muted transition-colors hover:text-silver"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!previews}
            className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft disabled:opacity-50"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImpactDialog;

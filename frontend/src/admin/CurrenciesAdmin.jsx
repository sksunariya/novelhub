import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Info, AlertTriangle, Download } from 'lucide-react';
import { getCurrencies, upsertCurrency, seedCurrencies, refreshRates } from '../api/adminConfig';
import { formatRelativeTime } from '../utils/dateUtils';
import Spinner from '../components/Spinner';

const ROUNDING = ['none', 'nearest_int', 'ceil_int', 'charm_99', 'charm_95', 'nearest_10', 'nearest_50', 'nearest_100'];

const cell = 'rounded border border-line bg-night px-2 py-1 text-xs text-silver focus:border-crimson focus:outline-none';

const CurrenciesAdmin = () => {
  const [rows, setRows] = useState(null);
  const [samplePack, setSamplePack] = useState(null);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});

  const load = useCallback(async () => {
    const data = await getCurrencies();
    setRows(data.currencies);
    setSamplePack(data.samplePack);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (code, changes) => {
    setBusy(code);
    try {
      const result = await upsertCurrency(code, changes);
      // The model corrects settings PayPal cannot honour; say why rather than
      // silently reverting the admin's input.
      setNotes((prev) => ({ ...prev, [code]: result.notes || [] }));
      await load();
    } finally {
      setBusy('');
    }
  };

  if (!rows) return <Spinner />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Currencies</h1>
          <p className="text-xs text-silver-muted">
            Prices are derived from each pack&apos;s USD price.
            {samplePack && ` Preview shows "${samplePack}".`}
          </p>
        </div>
        <div className="flex gap-2">
          {rows.length === 0 && (
            <button
              type="button"
              onClick={async () => {
                setBusy('seed');
                await seedCurrencies();
                await load();
                setBusy('');
              }}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Seed defaults
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setBusy('rates');
              await refreshRates().catch(() => {});
              await load();
              setBusy('');
            }}
            disabled={busy === 'rates'}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-silver-muted transition-colors hover:text-silver disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy === 'rates' ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh rates
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-night-surface p-3 text-xs text-silver-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          PayPal settles in only 25 currencies. Anything else is charged in USD with the local figure shown to
          the reader as an estimate — that is a PayPal limit, not a setting.
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-silver-muted">
            <tr>
              <th className="px-3 py-3">Currency</th>
              <th className="px-3 py-3">On</th>
              <th className="px-3 py-3">Settles</th>
              <th className="px-3 py-3">Rate</th>
              <th className="px-3 py-3">Markup</th>
              <th className="px-3 py-3">Rounding</th>
              <th className="px-3 py-3">Reader sees</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.code} className={busy === row.code ? 'opacity-50' : ''}>
                <td className="px-3 py-3">
                  <p className="text-silver">
                    {row.symbol} {row.code}
                  </p>
                  <p className="text-[11px] text-silver-muted">{row.name}</p>
                  {!row.paypalSupported && (
                    <p className="text-[10px] text-crimson-soft">PayPal cannot settle</p>
                  )}
                </td>

                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(row.enabled)}
                    onChange={(event) => patch(row.code, { enabled: event.target.checked })}
                    aria-label={`Enable ${row.code}`}
                  />
                </td>

                <td className="px-3 py-3">
                  <select
                    className={cell}
                    value={row.settlementMode}
                    // Local settlement is only offered where PayPal supports it;
                    // the server would override it anyway.
                    disabled={!row.paypalSupported}
                    onChange={(event) => patch(row.code, { settlementMode: event.target.value })}
                  >
                    <option value="usd">USD</option>
                    <option value="local">Local</option>
                  </select>
                </td>

                <td className="px-3 py-3">
                  <p className="text-xs text-silver">
                    {(row.rateSource === 'manual' ? row.manualRate : row.autoRate) || '—'}
                  </p>
                  <p className={`text-[10px] ${row.stale ? 'text-crimson-soft' : 'text-silver-muted'}`}>
                    {row.rateSource === 'manual'
                      ? 'pinned'
                      : row.lastRateAt
                        ? `${row.stale ? 'stale · ' : ''}${formatRelativeTime(row.lastRateAt)}`
                        : 'never fetched'}
                  </p>
                </td>

                <td className="px-3 py-3">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    defaultValue={row.markupPct}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (next !== row.markupPct) patch(row.code, { markupPct: next });
                    }}
                    aria-label={`${row.code} markup percent`}
                    className={`${cell} w-16`}
                  />
                </td>

                <td className="px-3 py-3">
                  <select
                    className={cell}
                    value={row.rounding}
                    onChange={(event) => patch(row.code, { rounding: event.target.value })}
                  >
                    {ROUNDING.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </td>

                {/* The whole reason this table exists: see the effect before saving. */}
                <td className="px-3 py-3">
                  {row.preview?.error ? (
                    <span className="flex items-center gap-1 text-xs text-crimson-soft">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {row.preview.error}
                    </span>
                  ) : row.preview ? (
                    <>
                      <p className="text-silver">{row.preview.formatted}</p>
                      {row.preview.isEstimate && (
                        <p className="text-[10px] text-silver-muted">charged in {row.preview.settlesIn}</p>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-silver-muted">no pack to price</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Object.entries(notes).some(([, list]) => list.length > 0) && (
        <div className="mt-4 space-y-1">
          {Object.entries(notes).flatMap(([code, list]) =>
            list.map((note) => (
              <p key={`${code}-${note}`} className="text-xs text-crimson-soft">
                {note}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CurrenciesAdmin;

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, X } from 'lucide-react';
import { getPacks, createPack, updatePack, deletePack } from '../api/adminConfig';
import Spinner from '../components/Spinner';

const BLANK = {
  name: '',
  description: '',
  credits: 1000,
  bonusCredits: 0,
  priceUsdCents: 999,
  badge: '',
  active: true,
};

const field = 'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver focus:border-crimson focus:outline-none';

const PackForm = ({ pack, baseline, onSave, onCancel, onDelete }) => {
  const [draft, setDraft] = useState(pack);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    const numeric = ['credits', 'bonusCredits'].includes(key);
    setDraft((prev) => ({ ...prev, [key]: numeric ? Number(raw) : raw }));
  };

  const total = (Number(draft.credits) || 0) + (Number(draft.bonusCredits) || 0);
  const dollars = (Number(draft.priceUsdCents) || 0) / 100;
  // What a buyer effectively gets per dollar, bonus included — the number that
  // says whether the tiers actually reward buying more.
  const effective = dollars > 0 ? Math.round(total / dollars) : 0;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(saveError.response?.data?.message || 'Could not save this pack');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-crimson/40 bg-night-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Name</span>
          <input className={field} value={draft.name} onChange={set('name')} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Badge</span>
          <input className={field} value={draft.badge || ''} onChange={set('badge')} placeholder="BEST VALUE" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-silver-muted">Description</span>
          <input className={field} value={draft.description || ''} onChange={set('description')} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Credits</span>
          <input type="number" min="1" className={field} value={draft.credits} onChange={set('credits')} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Bonus credits</span>
          <input type="number" min="0" className={field} value={draft.bonusCredits} onChange={set('bonusCredits')} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-silver-muted">Price (USD)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={field}
            value={dollars}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, priceUsdCents: Math.round(Number(event.target.value) * 100) }))
            }
          />
        </label>
        <label className="flex items-end gap-2 text-sm text-silver-muted">
          <input type="checkbox" checked={Boolean(draft.active)} onChange={set('active')} />
          On sale
        </label>
      </div>

      <p className="mt-3 rounded-lg bg-night p-3 text-xs text-silver-muted">
        Buyer gets <span className="text-silver">{total.toLocaleString()} credits</span> for ${dollars.toFixed(2)} —{' '}
        <span className="text-silver">{effective.toLocaleString()} per dollar</span>
        {baseline ? (
          <span className={effective >= baseline ? ' text-green-400' : ' text-crimson-soft'}>
            {' '}
            ({effective >= baseline ? 'better than' : 'worse than'} the {baseline}/USD baseline)
          </span>
        ) : null}
      </p>

      {error && <p className="mt-2 text-sm text-crimson-soft">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.name}
          className="flex cursor-pointer items-center gap-1.5 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" /> {busy ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-silver-muted transition-colors hover:text-crimson-soft"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
          </button>
        )}
      </div>
    </div>
  );
};

const PacksAdmin = () => {
  const [packs, setPacks] = useState(null);
  const [baseline, setBaseline] = useState(100);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const data = await getPacks();
    setPacks(data.packs);
    if (data.packs[0]?.baselineCreditsPerUsd) setBaseline(data.packs[0].baselineCreditsPerUsd);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (draft) => {
    if (draft._id) await updatePack(draft._id, draft);
    else await createPack(draft);
    setEditing(null);
    await load();
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this pack? Existing orders keep referencing it.')) return;
    await deletePack(id);
    setEditing(null);
    await load();
  };

  if (!packs) return <Spinner />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Credit packs</h1>
          <p className="text-xs text-silver-muted">
            One price in USD per pack. Every other currency is derived from it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...BLANK })}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white hover:bg-crimson-soft"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> New pack
        </button>
      </div>

      {packs.length === 0 && !editing && (
        <p className="rounded-xl border border-line bg-night-surface p-6 text-center text-sm text-silver-muted">
          No packs yet. The store shows nothing until at least one is on sale.
        </p>
      )}

      <div className="space-y-3">
        {editing && !editing._id && (
          <PackForm pack={editing} baseline={baseline} onSave={save} onCancel={() => setEditing(null)} />
        )}

        {packs.map((pack) =>
          editing && editing._id === pack._id ? (
            <PackForm
              key={pack._id}
              pack={editing}
              baseline={baseline}
              onSave={save}
              onCancel={() => setEditing(null)}
              onDelete={() => remove(pack._id)}
            />
          ) : (
            <button
              key={pack._id}
              type="button"
              onClick={() => setEditing({ ...pack })}
              className="flex w-full cursor-pointer flex-wrap items-center gap-4 rounded-xl border border-line bg-night-surface p-4 text-left transition-colors hover:border-crimson/50"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-silver">
                  {pack.name}
                  {pack.badge && (
                    <span className="rounded-full bg-crimson px-2 py-0.5 text-[10px] font-bold text-white">
                      {pack.badge}
                    </span>
                  )}
                  {!pack.active && <span className="text-xs font-normal text-silver-muted">(off sale)</span>}
                </p>
                <p className="text-xs text-silver-muted">
                  {pack.credits.toLocaleString()}
                  {pack.bonusCredits > 0 && ` + ${pack.bonusCredits.toLocaleString()} bonus`} credits
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-silver">${(pack.priceUsdCents / 100).toFixed(2)}</p>
                <p className="text-[11px] text-silver-muted">
                  {pack.effectiveCreditsPerUsd?.toLocaleString()} / USD
                </p>
              </div>
            </button>
          )
        )}
      </div>
    </div>
  );
};

export default PacksAdmin;

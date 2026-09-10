import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus, Pencil, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Clock, Users, ExternalLink, LayoutGrid,
} from 'lucide-react';
import * as api from '../api/spotlight';
import Spinner from '../components/Spinner';
import RailEditor from './spotlight/RailEditor';
import { iconFor, accentFor } from '../components/home/railStyle';

// Homepage curation.
//
// The screen an admin uses to decide what the front page is. Everything the
// homepage renders is a row in this list, in this order — including the six
// sections that used to be hardcoded in the frontend, which are now ordinary
// rails that can be retitled, reordered, scheduled or deleted like any other.
//
// Reordering saves IMMEDIATELY rather than behind a "save order" button. The
// list is the order; a staged version of it that can be abandoned halfway is a
// second source of truth for something the admin can already see.

const AUDIENCE_LABEL = {
  all: null, // the default needs no badge — every rail would carry one
  anon: 'Signed out',
  authed: 'Signed in',
  members: 'Members',
  non_members: 'Not in a space',
};

const SOURCE_LABEL = { manual: 'Hand-picked', auto: 'Automatic' };

const Badge = ({ children, tone = 'muted' }) => (
  <span className={`rounded px-1.5 py-0.5 text-xs ${
    tone === 'live' ? 'bg-emerald-400/10 text-emerald-400'
      : tone === 'off' ? 'bg-night-raised text-silver-muted'
      : 'bg-night-raised text-silver-muted'
  }`}>
    {children}
  </span>
);

/** "Live", or the reason it is not. A scheduled rail is active but not showing. */
const scheduleState = (rail) => {
  const now = Date.now();
  if (!rail.isActive) return { label: 'Off', tone: 'off' };
  if (rail.startAt && new Date(rail.startAt).getTime() > now) {
    return { label: `Starts ${new Date(rail.startAt).toLocaleDateString()}`, tone: 'off' };
  }
  if (rail.endAt && new Date(rail.endAt).getTime() < now) {
    return { label: 'Ended', tone: 'off' };
  }
  return { label: 'Live', tone: 'live' };
};

const SpotlightAdmin = () => {
  const [rails, setRails] = useState(null);
  const [types, setTypes] = useState([]);
  const [editing, setEditing] = useState(null); // rail object, or {} for a new one
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    Promise.all([api.listRails(), api.railTypes()])
      .then(([railData, typeData]) => {
        setRails(railData.rails || []);
        setTypes(typeData.types || []);
      })
      .catch((err) => {
        setError(err?.response?.data?.message || 'Could not load the homepage rails');
        setRails([]);
      });
  }, []);

  useEffect(load, [load]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 3000);
  };

  const save = async (form) => {
    setSaving(true);
    setError('');
    try {
      if (editing._id) {
        await api.updateRail(editing._id, form);
        flash('Rail saved');
      } else {
        await api.createRail(form);
        flash('Rail created');
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err?.response?.data?.message || 'That rail could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const toggleLive = async (rail) => {
    // Optimistic: the switch has to feel like a switch. Reload on failure puts
    // the real state back rather than leaving a lie on screen.
    setRails((prev) => prev.map((r) => (r._id === rail._id ? { ...r, isActive: !r.isActive } : r)));
    try {
      await api.updateRail(rail._id, { isActive: !rail.isActive });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change that rail');
      load();
    }
  };

  const move = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= rails.length) return;
    const next = [...rails];
    [next[index], next[target]] = [next[target], next[index]];
    setRails(next);
    try {
      await api.reorderRails(next.map((rail) => rail._id));
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save the new order');
      load();
    }
  };

  const remove = async (rail) => {
    // Deleting a rail throws away hand-picked items that cannot be recovered,
    // so it asks — unlike every other action here, which is reversible.
    if (!window.confirm(`Delete "${rail.title}"? Anything pinned to it is lost.`)) return;
    try {
      await api.deleteRail(rail._id);
      flash('Rail deleted');
      load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not delete that rail');
    }
  };

  if (!rails) return <Spinner full />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Homepage rails</h1>
          <p className="mt-1 max-w-2xl text-sm text-silver-muted">
            Every row on the homepage, in the order visitors see it. A rail can hold novels, spaces,
            community posts or a poll — hand-picked, or refilled automatically from a query.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-silver-muted hover:text-silver">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            View homepage
          </a>
          <button type="button" onClick={() => setEditing({})}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-crimson px-3 py-2 text-sm font-semibold text-white hover:bg-crimson-soft">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New rail
          </button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-night-surface p-3 text-sm text-amber-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-500/40 bg-night-surface p-3 text-sm text-emerald-300">{notice}</p>}

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <RailEditor
              key={editing._id || 'new'}
              rail={editing} types={types} saving={saving}
              onSave={save} onCancel={() => { setEditing(null); setError(''); }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ol className="space-y-2">
        {rails.map((rail, index) => {
          const Icon = iconFor(rail.icon);
          const accent = accentFor(rail.accent);
          const state = scheduleState(rail);
          const audience = AUDIENCE_LABEL[rail.audience];

          return (
            <li key={rail._id}
              className="flex items-center gap-3 rounded-xl border border-line bg-night-surface p-3">
              <div className="flex shrink-0 flex-col">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0}
                  aria-label={`Move ${rail.title} up`}
                  className="cursor-pointer rounded p-0.5 text-silver-muted hover:bg-night-raised hover:text-silver disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === rails.length - 1}
                  aria-label={`Move ${rail.title} down`}
                  className="cursor-pointer rounded p-0.5 text-silver-muted hover:bg-night-raised hover:text-silver disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <Icon className={`h-5 w-5 shrink-0 ${accent.text}`} aria-hidden="true" />

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-silver">{rail.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={state.tone}>{state.label}</Badge>
                  <Badge><LayoutGrid className="mr-1 inline h-3 w-3" aria-hidden="true" />{rail.layout}</Badge>
                  <Badge>{SOURCE_LABEL[rail.source]}</Badge>
                  {rail.source === 'manual' && (
                    <Badge>{rail.items?.length || 0} pinned</Badge>
                  )}
                  {rail.source === 'auto' && rail.query?.kind && <Badge>{rail.query.kind}</Badge>}
                  {audience && (
                    <Badge><Users className="mr-1 inline h-3 w-3" aria-hidden="true" />{audience}</Badge>
                  )}
                  {(rail.startAt || rail.endAt) && (
                    <Badge><Clock className="mr-1 inline h-3 w-3" aria-hidden="true" />Scheduled</Badge>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => toggleLive(rail)}
                  aria-pressed={rail.isActive}
                  aria-label={rail.isActive ? `Hide ${rail.title} from the homepage` : `Show ${rail.title} on the homepage`}
                  className="cursor-pointer rounded p-2 text-silver-muted hover:bg-night-raised hover:text-silver">
                  {rail.isActive
                    ? <Eye className="h-4 w-4" aria-hidden="true" />
                    : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => { setEditing(rail); setError(''); }}
                  aria-label={`Edit ${rail.title}`}
                  className="cursor-pointer rounded p-2 text-silver-muted hover:bg-night-raised hover:text-silver">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => remove(rail)}
                  aria-label={`Delete ${rail.title}`}
                  className="cursor-pointer rounded p-2 text-silver-muted hover:bg-night-raised hover:text-rose-400">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {!rails.length && (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-sm text-silver-muted">
            No rails yet, so the homepage shows only the hero carousel.
          </p>
          <p className="mt-2 text-xs text-silver-muted">
            Run <code className="rounded bg-night-raised px-1.5 py-0.5">npm run seed:spotlight</code> to
            create the six original sections, or build one here.
          </p>
        </div>
      )}
    </div>
  );
};

export default SpotlightAdmin;

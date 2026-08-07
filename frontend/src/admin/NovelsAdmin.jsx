import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Pencil, Trash2, List, X, Star, Lock } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import Pagination from '../components/Pagination';
import ReadingGateFields, { DEFAULT_READING_GATE, gatePayload, toGateForm } from './ReadingGateFields';

const EMPTY_FORM = {
  title: '',
  author: '',
  synopsis: '',
  genres: '',
  tags: '',
  status: 'ongoing',
  coverUrl: '',
  published: true,
  featured: false,
};

const EMPTY_GATE = { ...DEFAULT_READING_GATE, override: false };

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const NovelsAdmin = () => {
  const [novels, setNovels] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [gate, setGate] = useState(EMPTY_GATE);
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = { page };
    if (search) {
      params.search = search;
    }
    client
      .get('/admin/novels', { params })
      .then(({ data }) => {
        setNovels(data.novels);
        setMeta({ pages: data.pages, total: data.total });
      })
      .catch(() => setNovels([]));
  }, [search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setGate(EMPTY_GATE);
    setCoverFile(null);
    setError('');
    setEditing('new');
  };

  const openEdit = (novel) => {
    setForm({
      title: novel.title,
      author: novel.author,
      synopsis: novel.synopsis,
      genres: novel.genres.join(', '),
      tags: novel.tags.join(', '),
      status: novel.status,
      coverUrl: novel.coverUrl,
      published: novel.published,
      featured: novel.featured,
    });
    setGate({ ...EMPTY_GATE, ...toGateForm(novel.readingGate), override: Boolean(novel.readingGate?.override) });
    setCoverFile(null);
    setError('');
    setEditing(novel);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, val]) => body.append(key, val));
      body.append('readingGate', JSON.stringify(gatePayload(gate)));
      if (coverFile) {
        body.append('cover', coverFile);
      }
      if (editing === 'new') {
        await client.post('/admin/novels', body);
      } else {
        await client.put(`/admin/novels/${editing._id}`, body);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (novel) => {
    if (!window.confirm(`Delete "${novel.title}" and all its chapters? This cannot be undone.`)) return;
    await client.delete(`/admin/novels/${novel._id}`);
    load();
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Novels</h1>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search novels..."
          aria-label="Search novels"
          className="w-full rounded-full border border-line bg-night-surface px-4 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none sm:w-56"
        />
        <button
          type="button"
          onClick={openCreate}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> New Novel
        </button>
      </div>

      {novels === null ? (
        <Spinner full />
      ) : novels.length === 0 ? (
        <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">No novels found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-night-surface text-xs uppercase text-silver-muted">
              <tr>
                <th className="px-4 py-3">Novel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Chapters</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3">Visibility</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {novels.map((novel) => (
                <tr key={novel._id} className="bg-night transition-colors hover:bg-night-surface">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {novel.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-crimson text-crimson" aria-label="Featured" />}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-silver">{novel.title}</p>
                        <p className="truncate text-xs text-silver-muted">{novel.author}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-silver-muted">{novel.status}</td>
                  <td className="px-4 py-3 text-silver-muted">{novel.chapterCount}</td>
                  <td className="px-4 py-3 text-silver-muted">{(novel.views || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${novel.published ? 'bg-green-500/15 text-green-400' : 'bg-night-raised text-silver-muted'}`}>
                      {novel.published ? 'Published' : 'Hidden'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Link
                        to={`/admin/novels/${novel._id}/chapters`}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-silver"
                        aria-label={`Chapters of ${novel.title}`}
                        title="Chapters"
                      >
                        <List className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => openEdit(novel)}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-silver"
                        aria-label={`Edit ${novel.title}`}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(novel)}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft"
                        aria-label={`Delete ${novel.title}`}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={meta.pages} total={meta.total} onChange={setPage} />

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => e.target === e.currentTarget && setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-night-raised p-6"
              role="dialog"
              aria-label={editing === 'new' ? 'Create novel' : 'Edit novel'}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-silver">{editing === 'new' ? 'New Novel' : 'Edit Novel'}</h2>
                <button type="button" onClick={() => setEditing(null)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver" aria-label="Close">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <form onSubmit={save} className="space-y-3">
                <div>
                  <label htmlFor="nv-title" className="mb-1 block text-sm font-medium text-silver">Title</label>
                  <input id="nv-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="nv-author" className="mb-1 block text-sm font-medium text-silver">Author</label>
                  <input id="nv-author" required value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="nv-synopsis" className="mb-1 block text-sm font-medium text-silver">Synopsis</label>
                  <textarea id="nv-synopsis" rows={4} value={form.synopsis} onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))} className={inputClass} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="nv-genres" className="mb-1 block text-sm font-medium text-silver">Genres</label>
                    <input id="nv-genres" value={form.genres} onChange={(e) => setForm((f) => ({ ...f, genres: e.target.value }))} className={inputClass} placeholder="Fantasy, Horror" />
                    <p className="mt-1 text-xs text-silver-muted">Comma separated</p>
                  </div>
                  <div>
                    <label htmlFor="nv-tags" className="mb-1 block text-sm font-medium text-silver">Tags</label>
                    <input id="nv-tags" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} className={inputClass} placeholder="vampires, magic" />
                    <p className="mt-1 text-xs text-silver-muted">Comma separated</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="nv-status" className="mb-1 block text-sm font-medium text-silver">Status</label>
                    <select id="nv-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={`${inputClass} cursor-pointer`}>
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                      <option value="hiatus">Hiatus</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="nv-cover" className="mb-1 block text-sm font-medium text-silver">Cover image</label>
                    <input id="nv-cover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files[0])} className={`${inputClass} cursor-pointer`} />
                  </div>
                </div>
                <div>
                  <label htmlFor="nv-coverurl" className="mb-1 block text-sm font-medium text-silver">Or cover URL</label>
                  <input id="nv-coverurl" value={form.coverUrl} onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))} className={inputClass} placeholder="https://..." />
                </div>
                <div className="flex gap-6 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                    <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} className="accent-[var(--color-primary)]" />
                    Published
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                    <input type="checkbox" checked={form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} className="accent-[var(--color-primary)]" />
                    Featured
                  </label>
                </div>
                <div className="rounded-lg border border-line bg-night/40 p-3">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-silver">
                    <Lock className="h-4 w-4 text-crimson" aria-hidden="true" /> Reading gate
                  </p>
                  <ReadingGateFields idPrefix="nv-gate" gate={gate} onChange={(patch) => setGate((g) => ({ ...g, ...patch }))} showOverride />
                </div>
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setEditing(null)} className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm text-silver-muted hover:text-silver">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-60">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NovelsAdmin;

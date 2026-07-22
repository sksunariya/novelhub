import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Pencil, Trash2, X, Upload, FolderArchive, ArrowLeft } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import RichTextEditor from '../components/RichTextEditor';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const ChaptersAdmin = () => {
  const { id } = useParams();
  const [chapters, setChapters] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', number: '', published: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState('');

  const load = useCallback(() => {
    client.get(`/admin/novels/${id}/chapters`).then(({ data }) => setChapters(data.chapters)).catch(() => setChapters([]));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm({ title: '', content: '', number: '', published: true });
    setError('');
    setEditing('new');
  };

  const openEdit = async (chapter) => {
    const { data } = await client.get(`/admin/chapters/${chapter._id}`);
    setForm({
      title: data.chapter.title,
      content: data.chapter.content,
      number: data.chapter.number,
      published: data.chapter.published,
    });
    setError('');
    setEditing(data.chapter);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.content || !form.content.replace(/<[^>]*>/g, '').trim()) {
      setError('Chapter content cannot be empty');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { title: form.title, content: form.content, published: form.published };
      if (form.number) {
        payload.number = Number(form.number);
      }
      if (editing === 'new') {
        await client.post(`/admin/novels/${id}/chapters`, payload);
      } else {
        await client.put(`/admin/chapters/${editing._id}`, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (chapter) => {
    if (!window.confirm(`Delete chapter ${chapter.number}: "${chapter.title}"?`)) return;
    await client.delete(`/admin/chapters/${chapter._id}`);
    load();
  };

  const uploadFile = async (e, endpoint, kind) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(kind);
    setUploadResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await client.post(`/admin/novels/${id}/chapters/${endpoint}`, body);
      setUploadResult({
        type: 'success',
        text:
          endpoint === 'bulk'
            ? `Imported ${data.createdCount} chapters${data.failed.length ? `, ${data.failed.length} failed` : ''}`
            : `Chapter "${data.chapter.title}" imported`,
      });
      load();
    } catch (err) {
      setUploadResult({ type: 'error', text: err.response?.data?.message || 'Upload failed' });
    } finally {
      setUploading('');
      e.target.value = '';
    }
  };

  return (
    <div>
      <Link to="/admin/novels" className="mb-4 inline-flex items-center gap-1.5 text-sm text-silver-muted transition-colors hover:text-silver">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All novels
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl font-bold text-silver">Chapters</h1>
        <label className={`flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-silver transition-colors hover:border-crimson/60 ${uploading === 'single' ? 'opacity-60' : ''}`}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {uploading === 'single' ? 'Uploading...' : 'Upload .txt/.docx'}
          <input type="file" accept=".txt,.docx" className="hidden" disabled={Boolean(uploading)} onChange={(e) => uploadFile(e, 'upload', 'single')} />
        </label>
        <label className={`flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-silver transition-colors hover:border-crimson/60 ${uploading === 'bulk' ? 'opacity-60' : ''}`}>
          <FolderArchive className="h-4 w-4" aria-hidden="true" />
          {uploading === 'bulk' ? 'Importing...' : 'Bulk upload .zip'}
          <input type="file" accept=".zip" className="hidden" disabled={Boolean(uploading)} onChange={(e) => uploadFile(e, 'bulk', 'bulk')} />
        </label>
        <button type="button" onClick={openCreate} className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft">
          <Plus className="h-4 w-4" aria-hidden="true" /> Write Chapter
        </button>
      </div>

      {uploadResult && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${uploadResult.type === 'success' ? 'bg-green-500/15 text-green-400' : 'bg-crimson/15 text-crimson-soft'}`}
          role="status"
        >
          {uploadResult.text}
        </p>
      )}

      {chapters === null ? (
        <Spinner full />
      ) : chapters.length === 0 ? (
        <p className="rounded-xl border border-line bg-night-surface py-16 text-center text-silver-muted">
          No chapters yet. Write one or upload files to get started.
        </p>
      ) : (
        <div className="space-y-2">
          {chapters.map((chapter) => (
            <div key={chapter._id} className="flex items-center gap-3 rounded-xl border border-line bg-night-surface px-4 py-3">
              <span className="w-10 shrink-0 text-center font-display font-bold text-crimson">#{chapter.number}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-silver">{chapter.title}</p>
                <p className="text-xs text-silver-muted">
                  {(chapter.views || 0).toLocaleString()} views · {new Date(chapter.createdAt).toLocaleDateString()}
                </p>
              </div>
              {!chapter.published && (
                <span className="shrink-0 rounded-full bg-night-raised px-2 py-0.5 text-xs text-silver-muted">Draft</span>
              )}
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => openEdit(chapter)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-silver" aria-label={`Edit chapter ${chapter.number}`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => remove(chapter)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted transition-colors hover:bg-night-raised hover:text-crimson-soft" aria-label={`Delete chapter ${chapter.number}`}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-night-raised"
              role="dialog"
              aria-label={editing === 'new' ? 'Write chapter' : 'Edit chapter'}
            >
              <div className="flex items-center justify-between border-b border-line px-6 py-4">
                <h2 className="font-display text-lg font-bold text-silver">{editing === 'new' ? 'Write Chapter' : `Edit Chapter ${editing.number}`}</h2>
                <button type="button" onClick={() => setEditing(null)} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver" aria-label="Close">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <form onSubmit={save} className="flex-1 space-y-3 overflow-y-auto p-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <label htmlFor="ch-title" className="mb-1 block text-sm font-medium text-silver">Title</label>
                    <input id="ch-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="ch-number" className="mb-1 block text-sm font-medium text-silver">Number</label>
                    <input
                      id="ch-number"
                      type="number"
                      min="1"
                      value={form.number}
                      onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                      className={`${inputClass} sm:w-24`}
                      placeholder="auto"
                    />
                  </div>
                </div>
                <RichTextEditor value={form.content} onChange={(content) => setForm((f) => ({ ...f, content }))} />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-silver">
                  <input type="checkbox" checked={form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} className="accent-[var(--color-primary)]" />
                  Published
                </label>
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditing(null)} className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm text-silver-muted hover:text-silver">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-60">
                    {saving ? 'Saving...' : 'Save Chapter'}
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

export default ChaptersAdmin;

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Pencil, Trash2, X, Upload, FolderArchive, ArrowLeft, Coins } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import RichTextEditor from '../components/RichTextEditor';
import { formatRelativeTime, formatExactDateTime } from '../utils/dateUtils';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const BLANK_CHAPTER = {
  title: '',
  content: '',
  number: '',
  published: true,
  accessType: 'inherit',
  priceCredits: '',
};

const ACCESS_TYPES = [
  { value: 'inherit', label: 'Use the default', help: 'Priced by the novel and site settings.' },
  { value: 'free', label: 'Always free', help: 'Never costs credits, whatever the defaults say.' },
  { value: 'paid', label: 'Set a price', help: 'This exact price, ignoring every rule and default.' },
];

/**
 * What a reader is actually charged for a chapter.
 *
 * The stored `priceCredits` is only an override — a chapter with none still
 * has an effective price from the novel or site defaults. Showing the override
 * alone would make a fully-priced novel look free, so the server sends the
 * resolved figure and this renders that.
 */
const PriceBadge = ({ chapter }) => {
  const effective = chapter.effective;
  if (!effective) return null;

  if (effective.free) {
    return <span className="shrink-0 rounded-full bg-night-raised px-2 py-0.5 text-xs text-silver-muted">Free</span>;
  }
  const overridden = chapter.accessType === 'paid';
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
        overridden ? 'bg-crimson/15 text-crimson-soft' : 'bg-night-raised text-silver-muted'
      }`}
      title={overridden ? 'Price set on this chapter' : 'Inherited from the novel or site defaults'}
    >
      {effective.priceCredits} credits
    </span>
  );
};

/**
 * Price a range of chapters in one go.
 *
 * The common shape of a paid novel is "the first N are free, everything after
 * costs X". Expressing that by editing 500 chapters individually is not a
 * workflow anyone will follow, so this applies to a number range directly.
 */
const BulkPricingDialog = ({ novelId, chapters, onClose, onDone }) => {
  const last = chapters.length ? chapters[chapters.length - 1].number : 1;
  const [range, setRange] = useState({ from: 1, to: last });
  const [accessType, setAccessType] = useState('paid');
  const [price, setPrice] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const affected = chapters.filter(
    (chapter) => chapter.number >= Number(range.from) && chapter.number <= Number(range.to)
  ).length;

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.put(`/admin/novels/${novelId}/chapters/pricing`, {
        from: Number(range.from),
        to: Number(range.to),
        accessType,
        priceCredits: accessType === 'paid' ? Number(price) : null,
      });
      onDone(
        `Updated ${data.updated} chapter${data.updated === 1 ? '' : 's'}` +
          (data.existingPurchases
            ? `. ${data.existingPurchases} earlier purchase${data.existingPurchases === 1 ? '' : 's'} keep their access.`
            : '.')
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Could not apply pricing');
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg rounded-2xl border border-line bg-night-raised"
        role="dialog"
        aria-label="Set chapter prices"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-lg font-bold text-silver">Set prices</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">From chapter</span>
              <input
                type="number"
                min="1"
                value={range.from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-silver-muted">To chapter</span>
              <input
                type="number"
                min="1"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className={inputClass}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-silver-muted">Access</span>
            <select value={accessType} onChange={(e) => setAccessType(e.target.value)} className={inputClass}>
              {ACCESS_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {accessType === 'paid' && (
            <label className="block text-sm">
              <span className="mb-1 block text-silver-muted">Credits to unlock</span>
              <input
                type="number"
                min="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
              />
            </label>
          )}

          <p className="rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver-muted">
            This will change <span className="text-silver">{affected}</span> chapter
            {affected === 1 ? '' : 's'}.
          </p>

          {error && (
            <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm text-silver-muted hover:text-silver"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={busy || !affected}
              className="cursor-pointer rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-60"
            >
              {busy ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const ChaptersAdmin = () => {
  const { id } = useParams();
  const [chapters, setChapters] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...BLANK_CHAPTER });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState('');
  const [pricingOpen, setPricingOpen] = useState(false);

  const load = useCallback(() => {
    client.get(`/admin/novels/${id}/chapters`).then(({ data }) => setChapters(data.chapters)).catch(() => setChapters([]));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm({ ...BLANK_CHAPTER });
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
      accessType: data.chapter.accessType || 'inherit',
      priceCredits: data.chapter.priceCredits ?? '',
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
      const payload = {
        title: form.title,
        content: form.content,
        published: form.published,
        accessType: form.accessType,
        // Empty means "no override" — sent as null so switching a chapter back
        // to the default actually clears the stored price.
        priceCredits: form.accessType === 'paid' && form.priceCredits !== '' ? Number(form.priceCredits) : null,
      };
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
        <button
          type="button"
          onClick={() => setPricingOpen(true)}
          disabled={!chapters || !chapters.length}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-silver transition-colors hover:border-crimson/60 disabled:opacity-40"
        >
          <Coins className="h-4 w-4" aria-hidden="true" /> Set prices
        </button>
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
                <p className="text-xs text-silver-muted" title={formatExactDateTime(chapter.createdAt)}>
                  {(chapter.views || 0).toLocaleString()} views · {formatRelativeTime(chapter.createdAt)}
                </p>
              </div>
              <PriceBadge chapter={chapter} />
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
        {pricingOpen && (
          <BulkPricingDialog
            novelId={id}
            chapters={chapters || []}
            onClose={() => setPricingOpen(false)}
            onDone={(text) => {
              setPricingOpen(false);
              setUploadResult({ type: 'success', text });
              load();
            }}
          />
        )}
      </AnimatePresence>

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
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-night p-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <span className="text-sm font-medium text-silver">Access</span>
                  </div>
                  <div>
                    <label htmlFor="ch-access" className="mb-1 block text-xs text-silver-muted">
                      How this chapter is priced
                    </label>
                    <select
                      id="ch-access"
                      value={form.accessType}
                      onChange={(e) => setForm((f) => ({ ...f, accessType: e.target.value }))}
                      className={inputClass}
                    >
                      {ACCESS_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-silver-muted">
                      {ACCESS_TYPES.find((o) => o.value === form.accessType)?.help}
                    </p>
                  </div>
                  {form.accessType === 'paid' && (
                    <div>
                      <label htmlFor="ch-price" className="mb-1 block text-xs text-silver-muted">
                        Credits to unlock
                      </label>
                      <input
                        id="ch-price"
                        type="number"
                        min="1"
                        value={form.priceCredits}
                        onChange={(e) => setForm((f) => ({ ...f, priceCredits: e.target.value }))}
                        className={inputClass}
                        placeholder="10"
                      />
                      <p className="mt-1 text-xs text-silver-muted">
                        Leave blank to charge the novel or site default.
                      </p>
                    </div>
                  )}
                </div>
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

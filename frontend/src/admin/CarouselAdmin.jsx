import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Sparkles, Image, Settings, X, RefreshCw, Eye, CheckCircle2, ShieldAlert } from 'lucide-react';
import client from '../api/client';
import Spinner from '../components/Spinner';
import HeroCarousel from '../components/HeroCarousel';

const THEME_OPTIONS = [
  { id: 'dark-crimson', name: 'Crimson Blood (Red)' },
  { id: 'dark-violet', name: 'Midnight Violet (Purple)' },
  { id: 'dark-gold', name: 'Shadow Gold (Amber)' },
  { id: 'dark-emerald', name: 'Emerald Forest (Green)' },
  { id: 'dark-obsidian', name: 'Obsidian Dark (Slate)' },
  { id: 'dark-cyber', name: 'Cosmic Cyber (Cyan)' },
];

const BADGE_COLOR_OPTIONS = [
  { id: 'crimson', name: 'Crimson Red' },
  { id: 'amber', name: 'Amber Gold' },
  { id: 'emerald', name: 'Emerald Green' },
  { id: 'azure', name: 'Sky Azure' },
  { id: 'violet', name: 'Violet Purple' },
  { id: 'gold', name: 'Bright Gold' },
  { id: 'rose', name: 'Rose Pink' },
  { id: 'cyber', name: 'Cyber Cyan' },
];

const EMPTY_SLIDE_FORM = {
  title: '',
  subtitle: '',
  description: '',
  imageUrl: '',
  badgeText: 'FEATURED',
  badgeColor: 'crimson',
  primaryButtonText: 'Start Reading',
  primaryButtonUrl: '/browse',
  secondaryButtonText: 'Top Novels',
  secondaryButtonUrl: '/rankings',
  novelId: '',
  autoSyncWithNovel: true,
  themeStyle: 'dark-crimson',
  textAlignment: 'left',
  isActive: true,
  startDate: '',
  endDate: '',
};

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-2 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const CarouselAdmin = () => {
  const [slides, setSlides] = useState(null);
  const [novelsList, setNovelsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_SLIDE_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [globalSettings, setGlobalSettings] = useState({
    carouselMode: 'hybrid',
    carouselAutoPlayInterval: 6,
    enableCarouselAutoPlay: true,
  });

  const loadSlides = useCallback(() => {
    setLoading(true);
    Promise.all([
      client.get('/admin/carousel'),
      client.get('/admin/settings'),
      client.get('/admin/novels?limit=100'),
    ])
      .then(([slidesRes, settingsRes, novelsRes]) => {
        setSlides(slidesRes.data || []);
        if (settingsRes.data?.settings) {
          const s = settingsRes.data.settings;
          setGlobalSettings({
            carouselMode: s.carouselMode || 'hybrid',
            carouselAutoPlayInterval: s.carouselAutoPlayInterval || 6,
            enableCarouselAutoPlay: s.enableCarouselAutoPlay !== false,
          });
        }
        setNovelsList(novelsRes.data.novels || []);
      })
      .catch((err) => {
        console.error('Failed to load carousel admin data:', err);
        setSlides([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSlides();
  }, [loadSlides]);

  const openCreate = () => {
    setForm(EMPTY_SLIDE_FORM);
    setImageFile(null);
    setError('');
    setEditing('new');
  };

  const openEdit = (slide) => {
    setForm({
      title: slide.title || '',
      subtitle: slide.subtitle || '',
      description: slide.description || '',
      imageUrl: slide.imageUrl || '',
      badgeText: slide.badgeText || '',
      badgeColor: slide.badgeColor || 'crimson',
      primaryButtonText: slide.primaryButtonText || 'Start Reading',
      primaryButtonUrl: slide.primaryButtonUrl || '/browse',
      secondaryButtonText: slide.secondaryButtonText || '',
      secondaryButtonUrl: slide.secondaryButtonUrl || '',
      novelId: slide.novelId ? (typeof slide.novelId === 'object' ? slide.novelId._id : slide.novelId) : '',
      autoSyncWithNovel: slide.autoSyncWithNovel !== false,
      themeStyle: slide.themeStyle || 'dark-crimson',
      textAlignment: slide.textAlignment || 'left',
      isActive: slide.isActive !== false,
      startDate: slide.startDate ? new Date(slide.startDate).toISOString().slice(0, 16) : '',
      endDate: slide.endDate ? new Date(slide.endDate).toISOString().slice(0, 16) : '',
    });
    setImageFile(null);
    setError('');
    setEditing(slide);
  };

  // Sync details from chosen novel in modal dropdown
  const handleSelectNovelSync = (novelId) => {
    const selected = novelsList.find((n) => n._id === novelId);
    if (!selected) return;

    setForm((prev) => ({
      ...prev,
      novelId: selected._id,
      title: selected.title,
      subtitle: `By ${selected.author} • ${selected.chapterCount || 0} Chapters`,
      description: selected.synopsis ? selected.synopsis.slice(0, 220) : '',
      imageUrl: selected.coverUrl || prev.imageUrl,
      primaryButtonUrl: `/novel/${selected.slug}`,
      secondaryButtonUrl: `/novel/${selected.slug}`,
      badgeText: selected.ratingAvg > 0 ? `★ ${selected.ratingAvg.toFixed(1)} RATING` : selected.genres?.[0] || 'FEATURED',
    }));
  };

  const saveSlide = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, val]) => {
        if (key === 'novelId' && !val) return;
        body.append(key, val);
      });
      if (imageFile) {
        body.append('image', imageFile);
      }

      if (editing === 'new') {
        await client.post('/admin/carousel', body);
      } else {
        await client.put(`/admin/carousel/${editing._id}`, body);
      }

      setEditing(null);
      loadSlides();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save slide');
    } finally {
      setSaving(false);
    }
  };

  const removeSlide = async (slide) => {
    if (!window.confirm(`Delete carousel slide "${slide.title || 'Untitled'}"?`)) return;
    try {
      await client.delete(`/admin/carousel/${slide._id}`);
      loadSlides();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete slide');
    }
  };

  const toggleActive = async (slide) => {
    try {
      await client.put(`/admin/carousel/${slide._id}`, { isActive: !slide.isActive });
      loadSlides();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update slide status');
    }
  };

  const moveSlide = async (index, direction) => {
    if (!slides) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;

    const newSlides = [...slides];
    const temp = newSlides[index];
    newSlides[index] = newSlides[targetIdx];
    newSlides[targetIdx] = temp;

    setSlides(newSlides);
    try {
      await client.put('/admin/carousel/reorder', { slideIds: newSlides.map((s) => s._id) });
    } catch (err) {
      console.error('Failed to reorder:', err);
      loadSlides();
    }
  };

  const saveGlobalSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await client.put('/admin/settings', globalSettings);
      setShowSettingsModal(false);
      setSuccessMsg('Carousel global settings saved successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
      loadSlides();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  // Memoize object URL and revoke on cleanup to prevent memory leak
  const previewImageUrl = useMemo(() => {
    if (imageFile) return URL.createObjectURL(imageFile);
    return null;
  }, [imageFile]);

  useEffect(() => {
    return () => {
      if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    };
  }, [previewImageUrl]);

  // Construct preview slide object for in-modal preview
  const previewSlideObj = {
    _id: 'preview',
    title: form.title || 'Sample Hero Title',
    subtitle: form.subtitle || 'Sample Tagline / Author',
    description: form.description || 'Sample short synopsis for preview...',
    imageUrl: previewImageUrl || form.imageUrl,
    badgeText: form.badgeText || 'FEATURED',
    badgeColor: form.badgeColor || 'crimson',
    primaryButtonText: form.primaryButtonText || 'Start Reading',
    primaryButtonUrl: form.primaryButtonUrl || '#',
    secondaryButtonText: form.secondaryButtonText || 'Top Novels',
    secondaryButtonUrl: form.secondaryButtonUrl || '#',
    themeStyle: form.themeStyle || 'dark-crimson',
    novel: form.novelId
      ? novelsList.find((n) => n._id === form.novelId)
      : null,
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-silver">Hero Carousel Manager</h1>
          <p className="text-xs text-silver-muted">
            Manage, schedule, and reorder animated hero slides on the Home page.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-night-surface px-4 py-2 text-sm font-semibold text-silver transition-colors hover:border-crimson/50 hover:text-white"
          >
            <Settings className="h-4 w-4" /> Carousel Mode & Auto-Play
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-crimson px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-crimson-soft shadow-glow"
          >
            <Plus className="h-4 w-4" /> New Slide
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Slide Table / List */}
      {loading ? (
        <Spinner full />
      ) : slides.length === 0 ? (
        <div className="rounded-2xl border border-line bg-night-surface p-12 text-center text-silver-muted">
          <Image className="mx-auto h-12 w-12 text-silver-muted/40 mb-3" />
          <p className="font-medium text-silver">No custom carousel slides created yet.</p>
          <p className="text-xs text-silver-muted mt-1 max-w-md mx-auto">
            The home page is currently running in dynamic mode, automatically featuring top trending novels. Create your first custom slide to curate the hero banner!
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 text-sm font-semibold text-white hover:bg-crimson-soft"
          >
            <Plus className="h-4 w-4" /> Add Custom Slide
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-night-surface">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-line bg-night text-xs uppercase text-silver-muted">
              <tr>
                <th className="px-4 py-3 text-center w-16">Order</th>
                <th className="px-4 py-3">Slide / Banner</th>
                <th className="px-4 py-3">Badge & Theme</th>
                <th className="px-4 py-3">Linked Novel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {slides.map((slide, index) => {
                const linkedNovel = slide.novelId && typeof slide.novelId === 'object' ? slide.novelId : null;
                return (
                  <tr key={slide._id} className="bg-night-surface transition-colors hover:bg-night-raised/60">
                    {/* Reorder Arrows */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveSlide(index, -1)}
                          className="p-1 text-silver-muted hover:text-silver disabled:opacity-30 disabled:hover:text-silver-muted"
                          title="Move Up"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <span className="font-mono text-xs text-silver-muted">{index + 1}</span>
                        <button
                          type="button"
                          disabled={index === slides.length - 1}
                          onClick={() => moveSlide(index, 1)}
                          className="p-1 text-silver-muted hover:text-silver disabled:opacity-30 disabled:hover:text-silver-muted"
                          title="Move Down"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </td>

                    {/* Banner & Title */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-line bg-night">
                          {slide.imageUrl ? (
                            <img src={slide.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-silver-muted">
                              No image
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-silver">{slide.title || '(Untitled Slide)'}</p>
                          {slide.subtitle && <p className="truncate text-xs text-crimson-soft">{slide.subtitle}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Badge & Theme */}
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <span className="inline-block rounded-full bg-night-raised border border-line px-2.5 py-0.5 text-xs font-bold text-silver">
                          {slide.badgeText || 'FEATURED'}
                        </span>
                        <p className="text-xs text-silver-muted capitalize">{slide.themeStyle || 'dark-crimson'}</p>
                      </div>
                    </td>

                    {/* Linked Novel */}
                    <td className="px-4 py-3 text-silver-muted text-xs">
                      {linkedNovel ? (
                        <div>
                          <p className="truncate font-medium text-silver">{linkedNovel.title}</p>
                          {slide.autoSyncWithNovel && <span className="text-[10px] text-green-400">Auto-Synced</span>}
                        </div>
                      ) : (
                        <span className="italic text-silver-muted/60">Standalone Slide</span>
                      )}
                    </td>

                    {/* Active Status */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleActive(slide)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                          slide.isActive
                            ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                            : 'bg-night-raised text-silver-muted border border-line'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${slide.isActive ? 'bg-green-400 animate-pulse' : 'bg-silver-muted'}`} />
                        {slide.isActive ? 'Active' : 'Hidden'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(slide)}
                          className="flex h-9 w-9 items-center justify-center rounded-md text-silver-muted hover:bg-night-raised hover:text-silver"
                          title="Edit Slide"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlide(slide)}
                          className="flex h-9 w-9 items-center justify-center rounded-md text-silver-muted hover:bg-night-raised hover:text-crimson-soft"
                          title="Delete Slide"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide Editor Modal */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
            onClick={(e) => e.target === e.currentTarget && setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="my-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-night-surface p-6 shadow-2xl"
            >
              {/* Modal Header */}
              <div className="mb-6 flex items-center justify-between border-b border-line pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-silver">
                    {editing === 'new' ? 'Create Hero Carousel Slide' : 'Edit Carousel Slide'}
                  </h2>
                  <p className="text-xs text-silver-muted">
                    Customize banner visuals, call-to-action buttons, badges, and novel links.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-full p-2 text-silver-muted hover:bg-night-raised hover:text-silver"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* 1-Click Novel Selector Box */}
              <div className="mb-6 rounded-xl border border-line bg-night-raised/70 p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label htmlFor="sync-novel" className="text-sm font-bold text-silver flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    Auto-Fill from Existing Novel (1-Click Sync)
                  </label>
                  <span className="text-xs text-silver-muted">Optional</span>
                </div>
                <select
                  id="sync-novel"
                  value={form.novelId}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, novelId: e.target.value }));
                    if (e.target.value) handleSelectNovelSync(e.target.value);
                  }}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">-- Select a Novel from Database to Auto-Sync --</option>
                  {novelsList.map((n) => (
                    <option key={n._id} value={n._id}>
                      {n.title} (by {n.author})
                    </option>
                  ))}
                </select>
                {form.novelId && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-silver cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.autoSyncWithNovel}
                      onChange={(e) => setForm((f) => ({ ...f, autoSyncWithNovel: e.target.checked }))}
                      className="accent-crimson"
                    />
                    Keep dynamically synced with live novel statistics (rating, chapters, cover changes)
                  </label>
                )}
              </div>

              {/* Form Grid */}
              <form onSubmit={saveSlide} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-title" className="mb-1 block text-sm font-medium text-silver">
                      Slide Title
                    </label>
                    <input
                      id="sl-title"
                      required
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Shadow Monarch Returns"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-subtitle" className="mb-1 block text-sm font-medium text-silver">
                      Subtitle / Tagline
                    </label>
                    <input
                      id="sl-subtitle"
                      value={form.subtitle}
                      onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                      placeholder="e.g. EXCLUSIVE RELEASE • CHAPTER 50 OUT NOW"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="sl-desc" className="mb-1 block text-sm font-medium text-silver">
                    Synopsis / Description
                  </label>
                  <textarea
                    id="sl-desc"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Short engaging teaser text for the slide..."
                    className={inputClass}
                  />
                </div>

                {/* Image Upload & URL */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-imgfile" className="mb-1 block text-sm font-medium text-silver">
                      Upload Banner/Cover Image
                    </label>
                    <input
                      id="sl-imgfile"
                      type="file"
                      accept="image/*"
                      onChange={(e) => setImageFile(e.target.files[0])}
                      className={`${inputClass} cursor-pointer`}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-imgurl" className="mb-1 block text-sm font-medium text-silver">
                      Or Banner Image URL
                    </label>
                    <input
                      id="sl-imgurl"
                      value={form.imageUrl}
                      onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                      placeholder="https://..."
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Badge Tag & Accent Colors */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-badge" className="mb-1 block text-sm font-medium text-silver">
                      Badge Tag Text
                    </label>
                    <input
                      id="sl-badge"
                      value={form.badgeText}
                      onChange={(e) => setForm((f) => ({ ...f, badgeText: e.target.value }))}
                      placeholder="e.g. FEATURED, HOT, TOP RATED"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-badgecol" className="mb-1 block text-sm font-medium text-silver">
                      Badge Color Accent
                    </label>
                    <select
                      id="sl-badgecol"
                      value={form.badgeColor}
                      onChange={(e) => setForm((f) => ({ ...f, badgeColor: e.target.value }))}
                      className={`${inputClass} cursor-pointer`}
                    >
                      {BADGE_COLOR_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* CTA Buttons */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-btn1txt" className="mb-1 block text-sm font-medium text-silver">
                      Primary Button Text
                    </label>
                    <input
                      id="sl-btn1txt"
                      value={form.primaryButtonText}
                      onChange={(e) => setForm((f) => ({ ...f, primaryButtonText: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-btn1url" className="mb-1 block text-sm font-medium text-silver">
                      Primary Button Link URL
                    </label>
                    <input
                      id="sl-btn1url"
                      value={form.primaryButtonUrl}
                      onChange={(e) => setForm((f) => ({ ...f, primaryButtonUrl: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-btn2txt" className="mb-1 block text-sm font-medium text-silver">
                      Secondary Button Text (Optional)
                    </label>
                    <input
                      id="sl-btn2txt"
                      value={form.secondaryButtonText}
                      onChange={(e) => setForm((f) => ({ ...f, secondaryButtonText: e.target.value }))}
                      placeholder="e.g. View Details"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-btn2url" className="mb-1 block text-sm font-medium text-silver">
                      Secondary Button Link URL
                    </label>
                    <input
                      id="sl-btn2url"
                      value={form.secondaryButtonUrl}
                      onChange={(e) => setForm((f) => ({ ...f, secondaryButtonUrl: e.target.value }))}
                      placeholder="e.g. /novel/slug"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Theme Preset & Active Toggle */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sl-theme" className="mb-1 block text-sm font-medium text-silver">
                      Atmosphere Theme Style
                    </label>
                    <select
                      id="sl-theme"
                      value={form.themeStyle}
                      onChange={(e) => setForm((f) => ({ ...f, themeStyle: e.target.value }))}
                      className={`${inputClass} cursor-pointer`}
                    >
                      {THEME_OPTIONS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-6 pt-5">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-silver font-semibold">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                        className="accent-crimson h-4 w-4"
                      />
                      Active (Visible on Home)
                    </label>
                  </div>
                </div>

                {/* Date Scheduling */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-xl border border-line bg-night/40 p-4">
                  <div>
                    <label htmlFor="sl-start" className="mb-1 block text-xs font-medium text-silver">
                      Schedule Start Date (Optional)
                    </label>
                    <input
                      id="sl-start"
                      type="datetime-local"
                      value={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="sl-end" className="mb-1 block text-xs font-medium text-silver">
                      Schedule Expiry Date (Optional)
                    </label>
                    <input
                      id="sl-end"
                      type="datetime-local"
                      value={form.endDate}
                      onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Live Modal Preview Section */}
                <div className="mt-6 border-t border-line pt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-silver flex items-center gap-2">
                      <Eye className="h-4 w-4 text-crimson" /> Real-Time Home Slide Preview
                    </span>
                    <span className="text-xs text-silver-muted">Live Preview</span>
                  </div>
                  <div className="rounded-2xl overflow-hidden border border-line bg-night p-2">
                    <HeroCarousel slidesProp={[previewSlideObj]} autoPlayProp={false} />
                  </div>
                </div>

                {error && <p className="rounded-lg bg-crimson/15 p-3 text-sm text-crimson-soft">{error}</p>}

                {/* Submit Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t border-line">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-full border border-line px-5 py-2 text-sm font-medium text-silver-muted hover:text-silver"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-full bg-crimson px-6 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-50 shadow-glow"
                  >
                    {saving ? 'Saving Slide...' : 'Save Slide'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Carousel Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={(e) => e.target === e.currentTarget && setShowSettingsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-line bg-night-surface p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-lg font-bold text-silver">Global Carousel Settings</h3>
                <button type="button" onClick={() => setShowSettingsModal(false)} className="text-silver-muted hover:text-silver">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={saveGlobalSettings} className="space-y-4">
                <div>
                  <label htmlFor="set-mode" className="mb-1 block text-sm font-medium text-silver">
                    Carousel Display Mode
                  </label>
                  <select
                    id="set-mode"
                    value={globalSettings.carouselMode}
                    onChange={(e) => setGlobalSettings((s) => ({ ...s, carouselMode: e.target.value }))}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="hybrid">Hybrid (Custom Slides + Auto-fill with Top Trending Novels)</option>
                    <option value="custom_only">Custom Admin Slides Only</option>
                    <option value="auto_smart">Auto Smart (Dynamic Top Novels Only)</option>
                  </select>
                  <p className="mt-1 text-xs text-silver-muted">
                    Hybrid ensures your home page always stays full even if you only create 1 or 2 custom slides.
                  </p>
                </div>

                <div>
                  <label htmlFor="set-interval" className="mb-1 block text-sm font-medium text-silver">
                    Auto-Play Rotation Speed (Seconds)
                  </label>
                  <input
                    id="set-interval"
                    type="number"
                    min={3}
                    max={30}
                    value={globalSettings.carouselAutoPlayInterval}
                    onChange={(e) => setGlobalSettings((s) => ({ ...s, carouselAutoPlayInterval: Number(e.target.value) }))}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-silver font-medium">
                    <input
                      type="checkbox"
                      checked={globalSettings.enableCarouselAutoPlay}
                      onChange={(e) => setGlobalSettings((s) => ({ ...s, enableCarouselAutoPlay: e.target.checked }))}
                      className="accent-crimson h-4 w-4"
                    />
                    Enable Auto-Play Timer
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-line">
                  <button
                    type="button"
                    onClick={() => setShowSettingsModal(false)}
                    className="rounded-full border border-line px-4 py-2 text-sm text-silver-muted hover:text-silver"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-full bg-crimson px-5 py-2 text-sm font-semibold text-white hover:bg-crimson-soft disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Settings'}
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

export default CarouselAdmin;

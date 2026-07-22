import { useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import client from '../../api/client';
import ToolbarPopover from './ToolbarPopover';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-1.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const ImagePopover = ({ editor, open, onOpenChange }) => {
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const insert = (src) => {
    if (!src) return;
    editor.chain().focus().setImage({ src }).run();
    setUrl('');
    onOpenChange(false);
  };

  const insertFromUrl = () => insert(url.trim());

  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      const { data } = await client.post('/admin/uploads/image', body);
      insert(data.url);
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <ToolbarPopover
      icon={ImageIcon}
      anchorLabel="Insert image"
      active={false}
      open={open}
      onToggle={() => onOpenChange(!open)}
      onClose={() => onOpenChange(false)}
      width="w-72"
    >
      <label htmlFor="rte-image-upload" className="mb-1.5 block text-xs font-medium text-silver">
        Upload from device
      </label>
      <label
        htmlFor="rte-image-upload"
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-silver-muted transition-colors hover:border-crimson/60 hover:text-silver"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImageIcon className="h-4 w-4" aria-hidden="true" />}
        {uploading ? 'Uploading...' : 'Choose an image'}
      </label>
      <input id="rte-image-upload" type="file" accept="image/*" disabled={uploading} onChange={uploadFile} className="hidden" />
      {error && <p className="mt-1.5 text-xs text-crimson-soft">{error}</p>}
      <div className="my-3 flex items-center gap-2" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] uppercase text-silver-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <label htmlFor="rte-image-url" className="mb-1.5 block text-xs font-medium text-silver">
        Image URL
      </label>
      <input
        id="rte-image-url"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && insertFromUrl()}
        placeholder="https://example.com/image.jpg"
        className={inputClass}
      />
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={insertFromUrl} className="cursor-pointer rounded-full bg-crimson px-3 py-1 text-xs font-semibold text-white hover:bg-crimson-soft">
          Insert
        </button>
      </div>
    </ToolbarPopover>
  );
};

export default ImagePopover;

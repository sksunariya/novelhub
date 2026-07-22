import { useState, useEffect } from 'react';
import { Link2 } from 'lucide-react';
import ToolbarPopover from './ToolbarPopover';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-3 py-1.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const LinkPopover = ({ editor, open, onOpenChange }) => {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (open) {
      setUrl(editor.getAttributes('link').href || '');
    }
  }, [open, editor]);

  const apply = () => {
    if (url.trim()) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    }
    onOpenChange(false);
  };

  const remove = () => {
    editor.chain().focus().unsetLink().run();
    onOpenChange(false);
  };

  return (
    <ToolbarPopover
      icon={Link2}
      anchorLabel="Link"
      active={editor.isActive('link')}
      open={open}
      onToggle={() => onOpenChange(!open)}
      onClose={() => onOpenChange(false)}
    >
      <label htmlFor="rte-link-url" className="mb-1.5 block text-xs font-medium text-silver">
        Link URL
      </label>
      <input
        id="rte-link-url"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
        placeholder="https://example.com"
        autoFocus
        className={inputClass}
      />
      <div className="mt-2 flex justify-end gap-2">
        {editor.isActive('link') && (
          <button type="button" onClick={remove} className="cursor-pointer rounded-full px-3 py-1 text-xs text-silver-muted hover:text-crimson-soft">
            Remove
          </button>
        )}
        <button type="button" onClick={apply} className="cursor-pointer rounded-full bg-crimson px-3 py-1 text-xs font-semibold text-white hover:bg-crimson-soft">
          Apply
        </button>
      </div>
    </ToolbarPopover>
  );
};

export default LinkPopover;

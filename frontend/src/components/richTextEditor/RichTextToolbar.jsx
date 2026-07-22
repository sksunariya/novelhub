import { useReducer, useEffect, useState } from 'react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Baseline,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Quote,
  Code2,
  Minus,
  RemoveFormatting,
} from 'lucide-react';
import ToolbarButton, { ToolbarDivider } from './ToolbarButton';
import ColorPopover from './ColorPopover';
import LinkPopover from './LinkPopover';
import ImagePopover from './ImagePopover';
import TablePopover from './TablePopover';
import { HEADING_OPTIONS, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, TEXT_COLOR_SWATCHES, HIGHLIGHT_SWATCHES } from './constants';

const selectClass =
  'cursor-pointer rounded-md border border-line bg-night px-2 py-1.5 text-xs text-silver focus:border-crimson focus:outline-none';

const RichTextToolbar = ({ editor }) => {
  const [, forceRender] = useReducer((x) => x + 1, 0);
  const [openPopover, setOpenPopover] = useState('');

  useEffect(() => {
    if (!editor) return undefined;
    editor.on('transaction', forceRender);
    return () => editor.off('transaction', forceRender);
  }, [editor, forceRender]);

  if (!editor) return null;

  const headingValue = editor.isActive('heading', { level: 1 })
    ? '1'
    : editor.isActive('heading', { level: 2 })
      ? '2'
      : editor.isActive('heading', { level: 3 })
        ? '3'
        : editor.isActive('heading', { level: 4 })
          ? '4'
          : 'paragraph';

  const setHeading = (value) => {
    if (value === 'paragraph') {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level: Number(value) }).run();
    }
  };

  const togglePopover = (name) => setOpenPopover((current) => (current === name ? '' : name));

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-night-surface p-2" role="toolbar" aria-label="Text formatting">
      <ToolbarButton icon={Undo2} label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
      <ToolbarButton icon={Redo2} label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />

      <ToolbarDivider />

      <label className="sr-only" htmlFor="rte-heading">Paragraph style</label>
      <select id="rte-heading" value={headingValue} onChange={(e) => setHeading(e.target.value)} className={selectClass}>
        {HEADING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="rte-font-family">Font family</label>
      <select
        id="rte-font-family"
        value={editor.getAttributes('textStyle').fontFamily || ''}
        onChange={(e) => (e.target.value ? editor.chain().focus().setFontFamily(e.target.value).run() : editor.chain().focus().unsetFontFamily().run())}
        className={selectClass}
      >
        {FONT_FAMILY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="rte-font-size">Font size</label>
      <select
        id="rte-font-size"
        value={editor.getAttributes('textStyle').fontSize || ''}
        onChange={(e) => (e.target.value ? editor.chain().focus().setFontSize(e.target.value).run() : editor.chain().focus().unsetFontSize().run())}
        className={selectClass}
      >
        {FONT_SIZE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <ToolbarDivider />

      <ToolbarButton icon={Bold} label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolbarButton icon={Italic} label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolbarButton icon={Underline} label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolbarButton icon={Strikethrough} label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <ToolbarButton icon={SubscriptIcon} label="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
      <ToolbarButton icon={SuperscriptIcon} label="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />

      <ToolbarDivider />

      <ColorPopover
        icon={Baseline}
        label="Text color"
        swatches={TEXT_COLOR_SWATCHES}
        active={Boolean(editor.getAttributes('textStyle').color)}
        currentColor={editor.getAttributes('textStyle').color}
        open={openPopover === 'textColor'}
        onOpenChange={(next) => setOpenPopover(next ? 'textColor' : '')}
        onPick={(color) => editor.chain().focus().setColor(color).run()}
        onClear={() => editor.chain().focus().unsetColor().run()}
      />
      <ColorPopover
        icon={Highlighter}
        label="Highlight"
        swatches={HIGHLIGHT_SWATCHES}
        active={editor.isActive('highlight')}
        currentColor={editor.getAttributes('highlight').color}
        open={openPopover === 'highlight'}
        onOpenChange={(next) => setOpenPopover(next ? 'highlight' : '')}
        onPick={(color) => editor.chain().focus().setHighlight({ color }).run()}
        onClear={() => editor.chain().focus().unsetHighlight().run()}
      />

      <ToolbarDivider />

      <ToolbarButton icon={AlignLeft} label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
      <ToolbarButton icon={AlignCenter} label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
      <ToolbarButton icon={AlignRight} label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
      <ToolbarButton icon={AlignJustify} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />

      <ToolbarDivider />

      <ToolbarButton icon={List} label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolbarButton icon={ListOrdered} label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarButton icon={IndentIncrease} label="Increase indent" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} disabled={!editor.can().sinkListItem('listItem')} />
      <ToolbarButton icon={IndentDecrease} label="Decrease indent" onClick={() => editor.chain().focus().liftListItem('listItem').run()} disabled={!editor.can().liftListItem('listItem')} />

      <ToolbarDivider />

      <ToolbarButton icon={Quote} label="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <ToolbarButton icon={Code2} label="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <ToolbarButton icon={Minus} label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()} />

      <ToolbarDivider />

      <LinkPopover editor={editor} open={openPopover === 'link'} onOpenChange={(next) => setOpenPopover(next ? 'link' : '')} />
      <ImagePopover editor={editor} open={openPopover === 'image'} onOpenChange={(next) => setOpenPopover(next ? 'image' : '')} />
      <TablePopover editor={editor} open={openPopover === 'table'} onOpenChange={(next) => setOpenPopover(next ? 'table' : '')} />

      <ToolbarDivider />

      <ToolbarButton
        icon={RemoveFormatting}
        label="Clear formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      />
    </div>
  );
};

export default RichTextToolbar;

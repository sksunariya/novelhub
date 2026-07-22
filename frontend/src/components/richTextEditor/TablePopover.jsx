import { Table as TableIcon, Rows3, Columns3, Trash2 } from 'lucide-react';
import ToolbarPopover from './ToolbarPopover';

const ACTION_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-silver-muted transition-colors hover:bg-night-surface hover:text-silver';

const TablePopover = ({ editor, open, onOpenChange }) => {
  const inTable = editor.isActive('table');

  const run = (fn) => {
    fn();
    onOpenChange(false);
  };

  return (
    <ToolbarPopover
      icon={TableIcon}
      anchorLabel="Table"
      active={inTable}
      open={open}
      onToggle={() => onOpenChange(!open)}
      onClose={() => onOpenChange(false)}
      width="w-56"
    >
      {!inTable ? (
        <button
          type="button"
          onClick={() => run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
          className={ACTION_CLASS}
        >
          <TableIcon className="h-4 w-4" aria-hidden="true" /> Insert table
        </button>
      ) : (
        <div className="space-y-0.5">
          <button type="button" onClick={() => run(() => editor.chain().focus().addRowAfter().run())} className={ACTION_CLASS}>
            <Rows3 className="h-4 w-4" aria-hidden="true" /> Add row below
          </button>
          <button type="button" onClick={() => run(() => editor.chain().focus().addColumnAfter().run())} className={ACTION_CLASS}>
            <Columns3 className="h-4 w-4" aria-hidden="true" /> Add column right
          </button>
          <button type="button" onClick={() => run(() => editor.chain().focus().deleteRow().run())} className={ACTION_CLASS}>
            <Rows3 className="h-4 w-4" aria-hidden="true" /> Delete row
          </button>
          <button type="button" onClick={() => run(() => editor.chain().focus().deleteColumn().run())} className={ACTION_CLASS}>
            <Columns3 className="h-4 w-4" aria-hidden="true" /> Delete column
          </button>
          <button
            type="button"
            onClick={() => run(() => editor.chain().focus().deleteTable().run())}
            className={`${ACTION_CLASS} hover:text-crimson-soft`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete table
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
};

export default TablePopover;

import { Ban } from 'lucide-react';
import ToolbarPopover from './ToolbarPopover';

const ColorPopover = ({ icon, label, swatches, open, onOpenChange, active, currentColor, onPick, onClear }) => (
  <ToolbarPopover
    icon={icon}
    anchorLabel={label}
    active={active}
    open={open}
    onToggle={() => onOpenChange(!open)}
    onClose={() => onOpenChange(false)}
    width="w-56"
  >
    <p className="mb-2 text-xs font-medium text-silver">{label}</p>
    <div className="grid grid-cols-5 gap-2">
      <button
        type="button"
        onClick={() => {
          onClear();
          onOpenChange(false);
        }}
        aria-label="Remove color"
        title="Remove color"
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line text-silver-muted hover:border-crimson/60 hover:text-silver"
      >
        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {swatches.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => {
            onPick(color);
            onOpenChange(false);
          }}
          aria-label={`Set color ${color}`}
          title={color}
          style={{ backgroundColor: color }}
          className="h-7 w-7 cursor-pointer rounded-full border border-line"
        />
      ))}
    </div>
    <label htmlFor={`rte-color-custom-${label}`} className="mt-3 flex items-center gap-2 text-xs text-silver-muted">
      Custom
      <input
        id={`rte-color-custom-${label}`}
        type="color"
        value={currentColor || '#e7e5e4'}
        onChange={(e) => onPick(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-line bg-night"
      />
    </label>
  </ToolbarPopover>
);

export default ColorPopover;

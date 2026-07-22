const ToolbarButton = ({ icon: Icon, label, active, disabled, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={active}
    title={label}
    className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      active ? 'bg-crimson/20 text-crimson-soft' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
    }`}
  >
    <Icon className="h-4 w-4" aria-hidden="true" />
  </button>
);

export const ToolbarDivider = () => <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />;

export default ToolbarButton;

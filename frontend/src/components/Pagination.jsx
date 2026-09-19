import { ChevronLeft, ChevronRight } from 'lucide-react';

const Pagination = ({ page, pages, total, onChange }) => {
  if (!pages || pages <= 1) return null;

  return (
    <div className="mt-5 flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="flex cursor-pointer items-center gap-1 rounded-full border border-line bg-night-surface/60 px-3.5 py-1.5 text-xs font-medium text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Prev
      </button>
      <p className="text-xs text-silver-muted">
        Page {page} of {pages}
        {total != null && ` · ${total} total`}
      </p>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="flex cursor-pointer items-center gap-1 rounded-full border border-line bg-night-surface/60 px-3.5 py-1.5 text-xs font-medium text-silver-muted transition-colors hover:border-crimson-soft/40 hover:text-silver disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next page"
      >
        Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};

export default Pagination;

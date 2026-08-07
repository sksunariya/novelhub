import React from 'react';
import { AlertCircle, X } from 'lucide-react';

export default function DeletedItemModal({
  isOpen,
  onClose,
  title = 'Content Unavailable',
  message = 'The comment or reply you clicked has been deleted.',
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-crimson/30 bg-night-card p-6 shadow-2xl shadow-crimson/10">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-silver-muted transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center text-center space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-crimson/20 text-crimson-soft border border-crimson/30">
            <AlertCircle className="h-6 w-6" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-silver">{title}</h3>
            <p className="text-sm text-silver-muted leading-relaxed">{message}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-crimson px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-crimson/20 transition-all hover:bg-crimson-soft active:scale-[0.98]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

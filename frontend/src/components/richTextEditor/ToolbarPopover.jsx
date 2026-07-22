import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

const VIEWPORT_MARGIN = 8;

const ToolbarPopover = ({ open, onClose, anchorLabel, icon: Icon, active, onToggle, children, width = 'w-64' }) => {
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [coords, setCoords] = useState(null);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popoverWidth = popoverRef.current?.offsetWidth || 256;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - popoverWidth - VIEWPORT_MARGIN);
    }
    let top = rect.bottom + 8;
    const popoverHeight = popoverRef.current?.offsetHeight || 0;
    if (top + popoverHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - popoverHeight - 8);
    }
    setCoords({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      const inButton = buttonRef.current && buttonRef.current.contains(e.target);
      const inPopover = popoverRef.current && popoverRef.current.contains(e.target);
      if (!inButton && !inPopover) {
        onClose();
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-label={anchorLabel}
        aria-expanded={open}
        title={anchorLabel}
        className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors ${
          active ? 'bg-crimson/20 text-crimson-soft' : 'text-silver-muted hover:bg-night-raised hover:text-silver'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              style={{ position: 'fixed', top: coords?.top ?? -9999, left: coords?.left ?? -9999 }}
              className={`z-[9999] ${width} rounded-xl border border-line bg-night-raised p-3 shadow-card`}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

export default ToolbarPopover;

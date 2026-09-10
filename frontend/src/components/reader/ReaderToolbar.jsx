import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Volume2 } from 'lucide-react';

/**
 * The floating control bar: fullscreen, back to top, read aloud, and chapter
 * paging. It sits over the prose, so it hides itself while the reader is moving
 * down the page and comes back on any scroll up, or on reaching the end of the
 * chapter. A bar that never moved would cover the last two lines of every page
 * on a phone.
 */

const HIDE_AFTER = 220; // Stay put over the opening of the chapter.
const DELTA = 8; // Ignore the jitter a touch scroll produces at rest.

const useAutoHide = () => {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const movement = y - lastY.current;
      if (Math.abs(movement) < DELTA) return;

      const atBottom = window.innerHeight + y >= document.body.scrollHeight - 120;
      setVisible(movement < 0 || y < HIDE_AFTER || atBottom);
      lastY.current = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return visible;
};

const ToolbarButton = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full opacity-70 transition-all hover:bg-white/10 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

const ReaderToolbar = ({ theme, fullscreen, speech, prevTo, nextTo }) => {
  const visible = useAutoHide();

  const pagingLink = (to, label, children) =>
    to ? (
      <Link
        to={to}
        aria-label={label}
        title={label}
        className="flex h-10 w-10 items-center justify-center rounded-full opacity-70 transition-all hover:bg-white/10 hover:opacity-100"
      >
        {children}
      </Link>
    ) : (
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full opacity-25"
      >
        {children}
      </span>
    );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5">
      <nav
        aria-label="Reading controls"
        // The visible branch is the only one that turns pointer events back on.
        // Putting `pointer-events-none` in the hidden branch alongside a
        // constant `pointer-events-auto` would do nothing: Tailwind emits the
        // -auto rule last, so it wins regardless of the order written here.
        className={`flex items-center gap-0.5 rounded-full border px-2 py-1.5 backdrop-blur transition-all duration-300 ${
          visible
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-24 opacity-0'
        }`}
        style={{
          backgroundColor: `${theme.surface}f2`,
          borderColor: theme.border,
          color: theme.text,
          boxShadow: theme.shadow,
        }}
      >
        {fullscreen.supported && (
          <ToolbarButton
            label={fullscreen.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={fullscreen.toggle}
          >
            {fullscreen.isFullscreen ? (
              <Minimize2 className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </ToolbarButton>
        )}

        <ToolbarButton
          label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
        </ToolbarButton>

        {speech.supported && (
          <button
            type="button"
            onClick={speech.toggle}
            aria-label={speech.isSpeaking ? 'Pause reading aloud' : 'Read aloud'}
            aria-pressed={speech.isSpeaking}
            title={speech.isSpeaking ? 'Pause reading aloud' : 'Read aloud'}
            className={`mx-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-crimson transition-all hover:bg-crimson hover:text-white ${
              speech.isSpeaking ? 'bg-crimson text-white shadow-glow' : 'text-crimson-soft'
            }`}
          >
            {speech.isSpeaking ? (
              <Pause className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        )}

        <span className="mx-1 h-6 w-px shrink-0" style={{ backgroundColor: theme.border }} aria-hidden="true" />

        {pagingLink(prevTo, 'Previous chapter', <ChevronLeft className="h-5 w-5" aria-hidden="true" />)}
        {pagingLink(nextTo, 'Next chapter', <ChevronRight className="h-5 w-5" aria-hidden="true" />)}
      </nav>
    </div>
  );
};

export default ReaderToolbar;

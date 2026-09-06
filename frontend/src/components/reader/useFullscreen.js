import { useCallback, useEffect, useState } from 'react';

const fullscreenElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

/**
 * Fullscreen for the immersive reading mode.
 *
 * State is read from the document rather than tracked locally on purpose: the
 * user can leave fullscreen with Escape or the browser's own control without
 * touching our button, and a locally-tracked boolean would then show the wrong
 * icon with no way to recover.
 */
const useFullscreen = () => {
  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document === 'undefined' ? false : Boolean(fullscreenElement())
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(fullscreenElement()));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const element = document.documentElement;
    // Both directions reject rather than throw when the browser refuses (an
    // iframe without the permission, or iOS Safari on phones, where the API
    // does not exist at all). Nothing useful to do about it, but an unhandled
    // rejection in the console is noise.
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      Promise.resolve(exit?.call(document)).catch(() => {});
      return;
    }
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    Promise.resolve(request?.call(element)).catch(() => {});
  }, []);

  const supported =
    typeof document !== 'undefined' &&
    Boolean(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  return { isFullscreen, toggle, supported };
};

export default useFullscreen;

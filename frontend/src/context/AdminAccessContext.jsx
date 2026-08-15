import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { getMyAdminAccess } from '../api/adminConfig';

// What the signed-in admin may see in the portal.
//
// Fetched once when the portal mounts rather than folded into AuthContext:
// nobody outside /admin needs it, and putting it in the app-wide auth state
// would make every reader's page load pay for an admin-only request.
//
// This drives the nav and the client-side route guards. It is presentation, not
// enforcement — the API applies the same matrix independently, so a stale or
// tampered copy here changes what is drawn and nothing else.

const AdminAccessContext = createContext(null);

export const AdminAccessProvider = ({ children }) => {
  const [state, setState] = useState({ loading: true, error: null, visibility: {}, modules: [], isSuperAdmin: false });

  const load = useCallback(async ({ background = false } = {}) => {
    try {
      const data = await getMyAdminAccess();
      setState({
        loading: false,
        error: null,
        visibility: data.visibility || {},
        modules: data.modules || [],
        isSuperAdmin: Boolean(data.isSuperAdmin),
      });
    } catch (error) {
      // A background refresh that fails must not replace a working portal with
      // an error screen — the admin is mid-task and the previous answer is still
      // good enough to draw a menu with. Only the first load has nothing to fall
      // back on.
      if (background) return;
      // Failing closed would lock an admin out over a transient network error,
      // and failing open would show links that 404 on click. Surfacing the error
      // and drawing nothing is the honest option.
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.response?.data?.message || 'Could not load your portal access',
      }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the tab regains focus. Without this an admin whose access was
  // just changed keeps the old navigation until they happen to reload — the API
  // would refuse them, but a link that 404s on click is a worse explanation than
  // the link quietly not being there. Cheap: one small request, only on focus.
  useEffect(() => {
    const onFocus = () => load({ background: true });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const value = useMemo(
    () => ({
      ...state,
      reload: load,
      // Unknown ids resolve to false: a link added to the nav but missing from
      // the registry should disappear rather than quietly bypass the matrix.
      can: (moduleId) => Boolean(state.visibility[moduleId]),
    }),
    [state, load]
  );

  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
};

export const useAdminAccess = () => {
  const context = useContext(AdminAccessContext);
  if (!context) {
    throw new Error('useAdminAccess must be used inside the admin portal');
  }
  return context;
};

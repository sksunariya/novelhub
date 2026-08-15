import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Layout from './components/Layout';
import Home from './pages/Home';
import Browse from './pages/Browse';
import Rankings from './pages/Rankings';
import NovelDetail from './pages/NovelDetail';
import Reader from './pages/Reader';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import Profile from './pages/Profile';
import Library from './pages/Library';
import Notifications from './pages/Notifications';
import { useAuth } from './context/AuthContext';
import { CommunityProvider } from './context/CommunityContext';
import { AdminAccessProvider, useAdminAccess } from './context/AdminAccessContext';
import Spinner from './components/Spinner';

// Lazy: the PayPal SDK wrapper should not be in the bundle a reader downloads
// just to read a chapter.
const CommunityHub = lazy(() => import('./pages/community/CommunityHub'));
const SpacePage = lazy(() => import('./pages/community/SpacePage'));
const PostDetail = lazy(() => import('./pages/community/PostDetail'));
const PostComposer = lazy(() => import('./pages/community/PostComposer'));
const SpaceDirectory = lazy(() => import('./pages/community/SpaceDirectory'));
const CreateSpace = lazy(() => import('./pages/community/CreateSpace'));
const UserProfile = lazy(() => import('./pages/community/UserProfile'));
const Appeals = lazy(() => import('./pages/community/Appeals'));
const SpaceModlog = lazy(() => import('./pages/community/SpaceModlog'));
const Store = lazy(() => import('./pages/Store'));
const Subscribe = lazy(() => import('./pages/Subscribe'));

const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const Dashboard = lazy(() => import('./admin/Dashboard'));
const CarouselAdmin = lazy(() => import('./admin/CarouselAdmin'));
const NovelsAdmin = lazy(() => import('./admin/NovelsAdmin'));
const ChaptersAdmin = lazy(() => import('./admin/ChaptersAdmin'));
const UsersAdmin = lazy(() => import('./admin/UsersAdmin'));
const ModerationAdmin = lazy(() => import('./admin/ModerationAdmin'));
const NotificationsAdmin = lazy(() => import('./admin/NotificationsAdmin'));
const SettingsAdmin = lazy(() => import('./admin/SettingsAdmin'));
const ConfigPage = lazy(() => import('./admin/settings/ConfigPage'));
const JobsAdmin = lazy(() => import('./admin/JobsAdmin'));
const PacksAdmin = lazy(() => import('./admin/PacksAdmin'));
const PlansAdmin = lazy(() => import('./admin/PlansAdmin'));
const CurrenciesAdmin = lazy(() => import('./admin/CurrenciesAdmin'));
const GrantsAdmin = lazy(() => import('./admin/GrantsAdmin'));
const AnalyticsAdmin = lazy(() => import('./admin/AnalyticsAdmin'));
const SpacesAdmin = lazy(() => import('./admin/SpacesAdmin'));
const CommunityReportsAdmin = lazy(() => import('./admin/CommunityReportsAdmin'));
const CommunityModlogAdmin = lazy(() => import('./admin/CommunityModlogAdmin'));
const ChildSafetyAdmin = lazy(() => import('./admin/ChildSafetyAdmin'));
const SpaceRequestsAdmin = lazy(() => import('./admin/SpaceRequestsAdmin'));
const CommunityPostsAdmin = lazy(() => import('./admin/CommunityPostsAdmin'));
const SpaceDetailAdmin = lazy(() => import('./admin/SpaceDetailAdmin'));
const AccessControlAdmin = lazy(() => import('./admin/AccessControlAdmin'));

const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner full />;
  return user ? children : <Navigate to="/login" replace />;
};

const RequireAdmin = ({ children }) => {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <Spinner full />;
  if (!user) return <Navigate to="/login" replace />;
  return isAdmin ? children : <Navigate to="/" replace />;
};

/**
 * One admin page, gated on its module.
 *
 * The redirect is a convenience, not a control — an admin who edits the URL is
 * sent back to the dashboard, and the API refuses them either way. Keeping both
 * is what stops a hidden section from being one guessed path away.
 *
 * `module` must match the id used by the nav entry and the backend route guard.
 */
const AdminRoute = ({ module, requires = [], anyOf = null, children }) => {
  const { loading, can } = useAdminAccess();
  if (loading) return <Spinner full />;
  const allowed = anyOf
    ? anyOf.some((moduleId) => can(moduleId))
    : can(module) && requires.every((required) => can(required));
  if (!allowed) return <Navigate to="/admin" replace />;
  return <Suspense fallback={<Spinner full />}>{children}</Suspense>;
};

const App = () => {
  const location = useLocation();
  return (
    <CommunityProvider>
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/novel/:slug" element={<NovelDetail />} />
          {/* Community. Lazy so a reader who never opens it pays nothing —
              the same reasoning already applied to the PayPal SDK. */}
          <Route
            path="/community"
            element={
              <Suspense fallback={<Spinner />}>
                <CommunityHub />
              </Suspense>
            }
          />
          <Route
            path="/community/spaces"
            element={
              <Suspense fallback={<Spinner />}>
                <SpaceDirectory />
              </Suspense>
            }
          />
          <Route
            path="/community/create"
            element={
              <Suspense fallback={<Spinner />}>
                <CreateSpace />
              </Suspense>
            }
          />
          <Route
            path="/community/submit"
            element={
              <Suspense fallback={<Spinner />}>
                <PostComposer />
              </Suspense>
            }
          />
          {/* BEFORE /community/:type. The wildcard would otherwise match
              "appeals" and render the hub against a feed that does not exist —
              which is exactly what happened until this route was added. */}
          <Route
            path="/community/appeals"
            element={
              <Suspense fallback={<Spinner />}>
                <Appeals />
              </Suspense>
            }
          />
          <Route
            path="/community/:type"
            element={
              <Suspense fallback={<Spinner />}>
                <CommunityHub />
              </Suspense>
            }
          />
          {/* Canonical post URL carries the title slug. Every sort and filter
              variant canonicalises to this shape. */}
          <Route
            path="/u/:username"
            element={
              <Suspense fallback={<Spinner />}>
                <UserProfile />
              </Suspense>
            }
          />
          <Route
            path="/c/:slug/p/:postId/:titleSlug?"
            element={
              <Suspense fallback={<Spinner />}>
                <PostDetail />
              </Suspense>
            }
          />
          <Route
            path="/c/:slug/submit"
            element={
              <Suspense fallback={<Spinner />}>
                <PostComposer />
              </Suspense>
            }
          />
          <Route
            path="/c/:slug/modlog"
            element={
              <Suspense fallback={<Spinner />}>
                <SpaceModlog />
              </Suspense>
            }
          />
          <Route
            path="/c/:slug"
            element={
              <Suspense fallback={<Spinner />}>
                <SpacePage />
              </Suspense>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          {/* Browsable signed out, so a reader can see prices before committing. */}
          <Route
            path="/store"
            element={
              <Suspense fallback={<Spinner />}>
                <Store />
              </Suspense>
            }
          />
          {/* Also browsable signed out — the plan picker is the pitch. */}
          <Route
            path="/subscribe"
            element={
              <Suspense fallback={<Spinner />}>
                <Subscribe />
              </Suspense>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/library"
            element={
              <RequireAuth>
                <Library />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <Notifications />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="/novel/:slug/chapter/:number" element={<Reader />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminAccessProvider>
                <Suspense fallback={<Spinner full />}>
                  <AdminLayout />
                </Suspense>
              </AdminAccessProvider>
            </RequireAdmin>
          }
        >
          {/* `dashboard` is always visible, so the index route needs no gate —
              and must not have one, or a redirect to /admin would loop. */}
          <Route
            index
            element={
              <Suspense fallback={<Spinner full />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="carousel"
            element={
              <AdminRoute module="carousel">
                <CarouselAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="novels"
            element={
              <AdminRoute module="novels">
                <NovelsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="novels/:id/chapters"
            element={
              <AdminRoute module="novels">
                <ChaptersAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="users"
            element={
              <AdminRoute module="users">
                <UsersAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="moderation"
            element={
              <AdminRoute module="moderation">
                <ModerationAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="notifications"
            element={
              <AdminRoute module="notifications">
                <NotificationsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="settings"
            element={
              <AdminRoute module="site_settings">
                <SettingsAdmin />
              </AdminRoute>
            }
          />
          {/* Registry-driven configuration. Separate from the legacy site
              settings page so neither has to be rewritten to ship the other. */}
          <Route
            path="config"
            element={
              <AdminRoute anyOf={['monetization_config', 'platform_config', 'community_config']}>
                <ConfigPage />
              </AdminRoute>
            }
          />
          <Route
            path="jobs"
            element={
              <AdminRoute module="jobs">
                <JobsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="packs"
            element={
              <AdminRoute module="packs">
                <PacksAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="plans"
            element={
              <AdminRoute module="plans">
                <PlansAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="currencies"
            element={
              <AdminRoute module="currencies">
                <CurrenciesAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="grants"
            element={
              <AdminRoute module="grants">
                <GrantsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="analytics"
            element={
              <AdminRoute module="analytics">
                <AnalyticsAdmin />
              </AdminRoute>
            }
          />
          {/* Community. Every route 404s server-side while spaces.enabled is
              false, so these can ship before the feature launches. */}
          <Route
            path="spaces"
            element={
              <AdminRoute module="spaces">
                <SpacesAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="spaces/requests"
            element={
              <AdminRoute module="space_requests" requires={['spaces']}>
                <SpaceRequestsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="spaces/:id"
            element={
              <AdminRoute module="spaces">
                <SpaceDetailAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="community/posts"
            element={
              <AdminRoute module="community_posts">
                <CommunityPostsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="community/reports"
            element={
              <AdminRoute module="community_reports">
                <CommunityReportsAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="community/modlog"
            element={
              <AdminRoute module="community_modlog">
                <CommunityModlogAdmin />
              </AdminRoute>
            }
          />
          <Route
            path="community/safety"
            element={
              <AdminRoute module="community_safety">
                <ChildSafetyAdmin />
              </AdminRoute>
            }
          />
          {/* Governance. `access_control` resolves false for every non-super
              account, so this gate is what keeps admins out of it client-side. */}
          <Route
            path="access-control"
            element={
              <AdminRoute module="access_control">
                <AccessControlAdmin />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
    </CommunityProvider>
  );
};

export default App;

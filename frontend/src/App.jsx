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
import Spinner from './components/Spinner';

// Lazy: the PayPal SDK wrapper should not be in the bundle a reader downloads
// just to read a chapter.
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

const App = () => {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/novel/:slug" element={<NovelDetail />} />
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
              <Suspense fallback={<Spinner full />}>
                <AdminLayout />
              </Suspense>
            </RequireAdmin>
          }
        >
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
              <Suspense fallback={<Spinner full />}>
                <CarouselAdmin />
              </Suspense>
            }
          />
          <Route
            path="novels"
            element={
              <Suspense fallback={<Spinner full />}>
                <NovelsAdmin />
              </Suspense>
            }
          />
          <Route
            path="novels/:id/chapters"
            element={
              <Suspense fallback={<Spinner full />}>
                <ChaptersAdmin />
              </Suspense>
            }
          />
          <Route
            path="users"
            element={
              <Suspense fallback={<Spinner full />}>
                <UsersAdmin />
              </Suspense>
            }
          />
          <Route
            path="moderation"
            element={
              <Suspense fallback={<Spinner full />}>
                <ModerationAdmin />
              </Suspense>
            }
          />
          <Route
            path="notifications"
            element={
              <Suspense fallback={<Spinner full />}>
                <NotificationsAdmin />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<Spinner full />}>
                <SettingsAdmin />
              </Suspense>
            }
          />
          {/* Registry-driven configuration. Separate from the legacy site
              settings page so neither has to be rewritten to ship the other. */}
          <Route
            path="config"
            element={
              <Suspense fallback={<Spinner full />}>
                <ConfigPage />
              </Suspense>
            }
          />
          <Route
            path="jobs"
            element={
              <Suspense fallback={<Spinner full />}>
                <JobsAdmin />
              </Suspense>
            }
          />
          <Route
            path="packs"
            element={
              <Suspense fallback={<Spinner full />}>
                <PacksAdmin />
              </Suspense>
            }
          />
          <Route
            path="plans"
            element={
              <Suspense fallback={<Spinner full />}>
                <PlansAdmin />
              </Suspense>
            }
          />
          <Route
            path="currencies"
            element={
              <Suspense fallback={<Spinner full />}>
                <CurrenciesAdmin />
              </Suspense>
            }
          />
          <Route
            path="grants"
            element={
              <Suspense fallback={<Spinner full />}>
                <GrantsAdmin />
              </Suspense>
            }
          />
          <Route
            path="analytics"
            element={
              <Suspense fallback={<Spinner full />}>
                <AnalyticsAdmin />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
};

export default App;

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
import Profile from './pages/Profile';
import Library from './pages/Library';
import Notifications from './pages/Notifications';
import { useAuth } from './context/AuthContext';
import Spinner from './components/Spinner';

const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const Dashboard = lazy(() => import('./admin/Dashboard'));
const NovelsAdmin = lazy(() => import('./admin/NovelsAdmin'));
const ChaptersAdmin = lazy(() => import('./admin/ChaptersAdmin'));
const UsersAdmin = lazy(() => import('./admin/UsersAdmin'));
const ModerationAdmin = lazy(() => import('./admin/ModerationAdmin'));
const SettingsAdmin = lazy(() => import('./admin/SettingsAdmin'));

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
            path="settings"
            element={
              <Suspense fallback={<Spinner full />}>
                <SettingsAdmin />
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

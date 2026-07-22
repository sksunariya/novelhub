import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageTransition from '../components/PageTransition';
import GoogleButton from '../components/GoogleButton';

const Signup = () => {
  const { signup } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await signup(form.username, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

  if (settings && settings.allowSignups === false) {
    return (
      <PageTransition>
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-night-surface p-8 text-center">
          <h1 className="font-display text-xl font-bold text-silver">Signups are closed</h1>
          <p className="mt-2 text-sm text-silver-muted">New registrations are currently disabled by the administrators.</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-crimson-soft hover:underline">Log in instead</Link>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto mt-10 max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-line bg-night-surface p-8 shadow-card"
        >
          <h1 className="text-center font-display text-2xl font-bold text-silver">Join the Hub</h1>
          <p className="mt-1 text-center text-sm text-silver-muted">Create an account to build your library</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-silver">Username</label>
              <input
                id="username"
                type="text"
                required
                minLength={3}
                maxLength={30}
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className={inputClass}
                placeholder="darkreader"
              />
            </div>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-silver">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-silver">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className={inputClass}
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-silver-muted hover:text-silver"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          <GoogleButton onError={setError} />
          <p className="mt-5 text-center text-sm text-silver-muted">
            Already a member?{' '}
            <Link to="/login" className="font-medium text-crimson-soft hover:underline">
              Log in
            </Link>
          </p>
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default Signup;

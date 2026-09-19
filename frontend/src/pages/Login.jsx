import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PageTransition from '../components/PageTransition';
import GoogleButton from '../components/GoogleButton';
import AuthShell from '../components/AuthShell';
import { REDIRECT_PARAM } from '../utils/readingGate';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get(REDIRECT_PARAM) || '/';
  const redirectQuery = redirectTo === '/' ? '' : `?${REDIRECT_PARAM}=${encodeURIComponent(redirectTo)}`;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate(redirectTo);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'field';

  return (
    <PageTransition>
      <AuthShell>
          <h1 className="font-display text-2xl font-extrabold text-silver sm:text-3xl">Welcome back</h1>
          <p className="mt-1.5 text-sm text-silver-muted">Log in to pick up right where you left off.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="field-label">Email</label>
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
              <label htmlFor="password" className="field-label">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className={inputClass}
                  placeholder="••••••••"
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
            <div className="text-right -mt-1">
              <Link to="/forgot-password" className="text-xs font-medium text-crimson-soft hover:underline">Forgot password?</Link>
            </div>
            {error && (
              <p className="alert-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg w-full"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <GoogleButton onError={setError} />
          <p className="mt-6 text-center text-sm text-silver-muted">
            No account?{' '}
            <Link to={`/signup${redirectQuery}`} className="font-medium text-crimson-soft hover:underline">
              Sign up
            </Link>
          </p>
      </AuthShell>
    </PageTransition>
  );
};

export default Login;

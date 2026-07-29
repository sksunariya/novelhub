import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/auth/forgot-password', { email });
      setNotice('If an account exists for that email, a reset code has been sent.');
      setPhase('reset');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await client.post('/auth/reset-password', { email, code: code.trim(), newPassword });
      setNotice('Password updated. You can now log in.');
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="mx-auto mt-10 max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl border border-line bg-night-surface p-8 shadow-card"
        >
          <h1 className="text-center font-display text-2xl font-bold text-silver">Reset password</h1>

          {phase === 'request' && (
            <>
              <p className="mt-1 text-center text-sm text-silver-muted">Enter your email and we'll send a reset code</p>
              <form onSubmit={requestCode} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-silver">Email</label>
                  <input
                    id="fp-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </div>
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Sending...' : 'Send reset code'}
                </button>
              </form>
            </>
          )}

          {phase === 'reset' && (
            <>
              {notice && <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-center text-sm text-silver-muted">{notice}</p>}
              <form onSubmit={reset} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="fp-code" className="mb-1.5 block text-sm font-medium text-silver">Reset code</label>
                  <input
                    id="fp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputClass} text-center tracking-[0.5em]`}
                    placeholder="000000"
                  />
                </div>
                <div>
                  <label htmlFor="fp-password" className="mb-1.5 block text-sm font-medium text-silver">New password</label>
                  <div className="relative">
                    <input
                      id="fp-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
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
                {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}

          {phase === 'done' && (
            <div className="mt-4 text-center">
              <p className="rounded-lg bg-green-500/15 px-3 py-2 text-sm text-green-400">{notice}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-5 w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft"
              >
                Go to login
              </button>
            </div>
          )}

          {phase !== 'done' && (
            <p className="mt-5 text-center text-sm text-silver-muted">
              Remembered it?{' '}
              <Link to="/login" className="font-medium text-crimson-soft hover:underline">Log in</Link>
            </p>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default ForgotPassword;

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import client from '../api/client';
import PageTransition from '../components/PageTransition';
import OtpInput from '../components/OtpInput';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const requestCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/auth/forgot-password', { email });
      setNotice('If an account exists for that email, a reset code has been sent.');
      setPhase('reset');
      setCooldown(60);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError('');
    setCode('');
    try {
      await client.post('/auth/forgot-password', { email });
      setCooldown(60);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend code');
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError('');
    if (code.length < 6) {
      setError('Enter the 6-digit code');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
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
          <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border shadow-glow ${
            phase === 'done' ? 'border-green-500/40 bg-green-500/10' : 'border-crimson/40 bg-crimson/10'
          }`}
          >
            {phase === 'done'
              ? <CheckCircle2 className="h-8 w-8 text-green-400" aria-hidden="true" />
              : <KeyRound className="h-8 w-8 text-crimson-soft" aria-hidden="true" />}
          </div>

          <AnimatePresence mode="wait">
            {phase === 'request' && (
              <motion.div key="request" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <h1 className="text-center font-display text-2xl font-bold text-silver">Reset password</h1>
                <p className="mt-2 text-center text-sm text-silver-muted">Enter your email and we&apos;ll send a reset code</p>
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
              </motion.div>
            )}

            {phase === 'reset' && (
              <motion.div key="reset" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}>
                <h1 className="text-center font-display text-2xl font-bold text-silver">Enter reset code</h1>
                <p className="mt-2 text-center text-sm text-silver-muted">We sent a 6-digit code to</p>
                <p className="text-center text-sm font-medium text-silver">{email}</p>
                <form onSubmit={reset} className="mt-6 space-y-5">
                  <OtpInput value={code} onChange={setCode} disabled={loading} />
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
                  <div>
                    <label htmlFor="fp-confirm" className="mb-1.5 block text-sm font-medium text-silver">Confirm new password</label>
                    <input
                      id="fp-confirm"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={`${inputClass} ${confirm && confirm !== newPassword ? 'border-crimson' : ''}`}
                      placeholder="Re-enter your password"
                    />
                    {confirm && confirm !== newPassword && (
                      <p className="mt-1 text-xs text-crimson-soft">Passwords do not match</p>
                    )}
                  </div>
                  {error && <p className="rounded-lg bg-crimson/15 px-3 py-2 text-center text-sm text-crimson-soft" role="alert">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? 'Updating...' : 'Update password'}
                  </button>
                </form>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => { setPhase('request'); setError(''); setCode(''); }}
                    className="flex items-center gap-1 text-silver-muted transition-colors hover:text-silver"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Change email
                  </button>
                  <button
                    type="button"
                    onClick={resend}
                    disabled={cooldown > 0}
                    className="font-medium text-crimson-soft transition-colors hover:underline disabled:cursor-not-allowed disabled:text-silver-muted disabled:no-underline"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </button>
                </div>
              </motion.div>
            )}

            {phase === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className="text-center">
                <h1 className="font-display text-2xl font-bold text-silver">All set</h1>
                <p className="mt-2 text-sm text-silver-muted">{notice}</p>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="mt-6 w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft"
                >
                  Go to login
                </button>
              </motion.div>
            )}
          </AnimatePresence>

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

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, MailCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageTransition from '../components/PageTransition';
import GoogleButton from '../components/GoogleButton';
import OtpInput from '../components/OtpInput';
import { REDIRECT_PARAM } from '../utils/readingGate';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const Signup = () => {
  const { signup, verifySignup, resendSignupOtp } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('form');
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get(REDIRECT_PARAM) || '/';
  const redirectQuery = redirectTo === '/' ? '' : `?${REDIRECT_PARAM}=${encodeURIComponent(redirectTo)}`;

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const data = await signup(form.username, form.email, form.password);
      if (data.pendingVerification) {
        setPhase('otp');
        setCode('');
        setCooldown(60);
      } else {
        navigate(redirectTo);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (submittedCode) => {
    setError('');
    setLoading(true);
    try {
      await verifySignup(form.email, submittedCode.trim());
      navigate(redirectTo);
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError('');
    setCode('');
    try {
      await resendSignupOtp(form.email);
      setCooldown(60);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not resend code');
    }
  };

  if (settings && settings.allowSignups === false) {
    return (
      <PageTransition>
        <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-night-surface p-8 text-center">
          <h1 className="font-display text-xl font-bold text-silver">Signups are closed</h1>
          <p className="mt-2 text-sm text-silver-muted">New registrations are currently disabled by the administrators.</p>
          <Link to={`/login${redirectQuery}`} className="mt-4 inline-block text-sm text-crimson-soft hover:underline">Log in instead</Link>
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
          <AnimatePresence mode="wait">
            {phase === 'form' ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
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
                  <div>
                    <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-silver">Confirm password</label>
                    <input
                      id="confirm"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={form.confirm}
                      onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                      className={`${inputClass} ${form.confirm && form.confirm !== form.password ? 'border-crimson' : ''}`}
                      placeholder="Re-enter your password"
                    />
                    {form.confirm && form.confirm !== form.password && (
                      <p className="mt-1 text-xs text-crimson-soft">Passwords do not match</p>
                    )}
                  </div>
                  {error && (
                    <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>
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
                  <Link to={`/login${redirectQuery}`} className="font-medium text-crimson-soft hover:underline">Log in</Link>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="otp"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-crimson/40 bg-crimson/10 shadow-glow">
                  <MailCheck className="h-8 w-8 text-crimson-soft" aria-hidden="true" />
                </div>
                <h1 className="text-center font-display text-2xl font-bold text-silver">Verify your email</h1>
                <p className="mt-2 text-center text-sm text-silver-muted">
                  Enter the 6-digit code we sent to
                </p>
                <p className="text-center text-sm font-medium text-silver">{form.email}</p>

                <form
                  onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify(code); }}
                  className="mt-6 space-y-5"
                >
                  <OtpInput value={code} onChange={setCode} onComplete={(c) => verify(c)} disabled={loading} />
                  {error && (
                    <p className="rounded-lg bg-crimson/15 px-3 py-2 text-center text-sm text-crimson-soft" role="alert">{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={loading || code.length < 6}
                    className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? 'Verifying...' : 'Verify & Continue'}
                  </button>
                </form>

                <div className="mt-5 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => { setPhase('form'); setError(''); setCode(''); }}
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
          </AnimatePresence>
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default Signup;

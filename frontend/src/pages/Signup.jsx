import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageTransition from '../components/PageTransition';
import GoogleButton from '../components/GoogleButton';

const inputClass =
  'w-full rounded-lg border border-line bg-night px-4 py-2.5 text-sm text-silver placeholder:text-silver-muted focus:border-crimson focus:outline-none';

const Signup = () => {
  const { signup, verifySignup, resendSignupOtp } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('form');
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

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
    setLoading(true);
    try {
      const data = await signup(form.username, form.email, form.password);
      if (data.pendingVerification) {
        setPhase('otp');
        setCooldown(60);
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifySignup(form.email, code.trim());
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setError('');
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
          {phase === 'form' ? (
            <>
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
                <Link to="/login" className="font-medium text-crimson-soft hover:underline">Log in</Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-center font-display text-2xl font-bold text-silver">Verify your email</h1>
              <p className="mt-1 text-center text-sm text-silver-muted">
                We sent a 6-digit code to <span className="text-silver">{form.email}</span>
              </p>
              <form onSubmit={verify} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-silver">Verification code</label>
                  <input
                    id="code"
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
                {error && (
                  <p className="rounded-lg bg-crimson/15 px-3 py-2 text-sm text-crimson-soft" role="alert">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer rounded-full bg-crimson py-2.5 font-semibold text-white shadow-glow transition-colors hover:bg-crimson-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </form>
              <div className="mt-4 flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setPhase('form'); setError(''); setCode(''); }}
                  className="text-silver-muted hover:text-silver"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={cooldown > 0}
                  className="text-crimson-soft hover:underline disabled:cursor-not-allowed disabled:text-silver-muted disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
};

export default Signup;

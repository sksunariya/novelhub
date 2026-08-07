import { useRef, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { REDIRECT_PARAM } from '../utils/readingGate';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const POLL_INTERVAL_MS = 300;
const MAX_POLLS = 20;

const GoogleButton = ({ onError }) => {
  const { googleLogin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get(REDIRECT_PARAM) || '/';
  const buttonRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        setReady(true);
      } else if (polls >= MAX_POLLS) {
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!ready || !buttonRef.current) return;
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response) => {
        try {
          await googleLogin(response.credential);
          navigate(redirectTo);
        } catch (err) {
          if (onError) {
            onError(err.response?.data?.message || 'Google sign-in failed');
          }
        }
      },
    });

    const renderGoogleButton = () => {
      const container = buttonRef.current;
      if (!container) return;
      container.innerHTML = '';
      const availableWidth = container.parentElement?.clientWidth || 320;
      const width = Math.max(200, Math.min(320, Math.floor(availableWidth)));
      window.google.accounts.id.renderButton(container, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        width,
      });
    };

    renderGoogleButton();
    window.addEventListener('resize', renderGoogleButton);
    return () => window.removeEventListener('resize', renderGoogleButton);
  }, [ready, googleLogin, navigate, onError]);

  if (!CLIENT_ID) return null;

  return (
    <div>
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs uppercase tracking-wide text-silver-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div ref={buttonRef} className="flex justify-center" />
    </div>
  );
};

export default GoogleButton;

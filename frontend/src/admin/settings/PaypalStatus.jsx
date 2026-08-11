import { useState } from 'react';
import { PlugZap, Check, AlertTriangle } from 'lucide-react';
import { testPaypal } from '../../api/adminConfig';

/**
 * "Does PayPal actually work with these credentials?"
 *
 * Without this the first sign of a typo in the secret is a reader failing at
 * checkout — the worst possible place to discover it, and the hardest to
 * diagnose from a bug report. This asks PayPal for a token and reports back.
 *
 * Deliberately does not display the credentials, only a short hint so two
 * accounts can be told apart.
 */
const PaypalStatus = () => {
  const [state, setState] = useState({ status: 'idle' });

  const run = async () => {
    setState({ status: 'testing' });
    try {
      const result = await testPaypal();
      setState({ status: result.ok ? 'ok' : 'failed', result });
    } catch (error) {
      setState({
        status: 'failed',
        result: { error: error.response?.data?.message || 'Could not reach the server' },
      });
    }
  };

  const { status, result } = state;

  return (
    <div className="mb-4 rounded-xl border border-line bg-night-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-medium text-silver">Connection</p>
          <p className="text-xs text-silver-muted">
            Check the credentials before a reader does. Saves settings first if you have unsaved changes.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={status === 'testing'}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-silver transition-colors hover:border-crimson/60 disabled:opacity-50"
        >
          <PlugZap className="h-4 w-4" aria-hidden="true" />
          {status === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {status === 'ok' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p>
              Connected to PayPal <strong>{result.environment}</strong>
              {result.clientIdHint && <span className="text-emerald-300/80"> ({result.clientIdHint})</span>}.
            </p>
            {!result.webhookConfigured && (
              <p className="mt-1 text-xs text-amber-200">
                No webhook ID is set. Payments will work, but a buyer who closes the tab mid-payment will not
                receive their credits. Set PAYPAL_WEBHOOK_ID.
              </p>
            )}
          </div>
        </div>
      )}

      {status === 'failed' && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-sm text-crimson-soft">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{result?.error || 'PayPal rejected these credentials.'}</span>
        </p>
      )}
    </div>
  );
};

export default PaypalStatus;

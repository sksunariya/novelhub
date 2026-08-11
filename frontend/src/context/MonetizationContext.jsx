import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import client from '../api/client';
import { getWallet } from '../api/monetization';
import { useAuth } from './AuthContext';

const MonetizationContext = createContext(null);

// Defaults matching the registry, so the app renders sensibly before the
// public settings call returns and if it ever fails.
const FALLBACK = {
  enabled: false,
  storeEnabled: false,
  creditsPerUsd: 100,
  labelSingular: 'Credit',
  labelPlural: 'Credits',
  showCalculator: true,
  lowBalanceThreshold: 20,
  allowBulkUnlock: true,
  allowAutoUnlock: true,
  autoUnlockMaxCredits: 25,
  previewParagraphs: 3,
  showPricesOnChapterList: true,
  subscriptionsEnabled: false,
  subscriptionHeading: 'Read more, pay less',
};

/**
 * Reads the public `config` block that GET /api/settings already returns, so
 * credit labels and pricing flags are fetched once rather than per component.
 *
 * The label lives here on purpose: an admin renaming credits to "gems" is a
 * settings change, and every price in the app should follow without a deploy.
 */
export const MonetizationProvider = ({ children }) => {
  const { user } = useAuth();
  const [config, setConfig] = useState(FALLBACK);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await client.get('/settings');
      const c = data.config || {};
      setConfig({
        enabled: c['monetization.enabled'] ?? FALLBACK.enabled,
        storeEnabled: c['store.enabled'] ?? FALLBACK.storeEnabled,
        readOnly: c['monetization.readOnlyMode'] ?? false,
        creditsPerUsd: c['credits.perUsd'] ?? FALLBACK.creditsPerUsd,
        labelSingular: c['credits.labelSingular'] ?? FALLBACK.labelSingular,
        labelPlural: c['credits.labelPlural'] ?? FALLBACK.labelPlural,
        showCalculator: c['credits.showCalculator'] ?? FALLBACK.showCalculator,
        lowBalanceThreshold: c['credits.lowBalanceThreshold'] ?? FALLBACK.lowBalanceThreshold,
        allowBulkUnlock: c['pricing.allowBulkUnlock'] ?? FALLBACK.allowBulkUnlock,
        allowAutoUnlock: c['pricing.allowAutoUnlock'] ?? FALLBACK.allowAutoUnlock,
        autoUnlockMaxCredits: c['pricing.autoUnlockMaxCredits'] ?? FALLBACK.autoUnlockMaxCredits,
        previewParagraphs: c['pricing.previewParagraphs'] ?? FALLBACK.previewParagraphs,
        showPricesOnChapterList: c['pricing.showPricesOnChapterList'] ?? FALLBACK.showPricesOnChapterList,
        storeHeading: c['store.heading'] || 'Get credits',
        storeSubheading: c['store.subheading'] || '',
        requireTerms: c['store.requireTermsAcceptance'] ?? true,
        refundPolicy: c['tax.refundPolicyText'] || '',
        subscriptionsEnabled: c['subscriptions.enabled'] ?? FALLBACK.subscriptionsEnabled,
        subscriptionHeading: c['subscriptions.storeHeading'] || FALLBACK.subscriptionHeading,
        showSubscriberBadge: c['subscriptions.showBadge'] ?? true,
      });
    } catch (error) {
      setConfig(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    if (!user) {
      setWallet(null);
      return null;
    }
    try {
      const data = await getWallet();
      setWallet(data.wallet);
      return data.wallet;
    } catch (error) {
      return null;
    }
  }, [user]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Only fetch a balance when monetization is actually on and someone is
  // signed in — a free site should make no wallet calls at all.
  useEffect(() => {
    if (config.enabled && user) refreshWallet();
    else setWallet(null);
  }, [config.enabled, user, refreshWallet]);

  const value = useMemo(
    () => ({
      ...config,
      loading,
      wallet,
      balance: wallet ? wallet.balance : 0,
      refreshWallet,
      /** Apply the balance a mutation already returned, avoiding a refetch. */
      applyBalance: (balance) => setWallet((w) => (w ? { ...w, balance } : { balance })),
      label: (n) => (n === 1 ? config.labelSingular : config.labelPlural),
      isLow: wallet ? wallet.balance <= config.lowBalanceThreshold : false,
    }),
    [config, loading, wallet, refreshWallet]
  );

  return <MonetizationContext.Provider value={value}>{children}</MonetizationContext.Provider>;
};

export const useMonetization = () => useContext(MonetizationContext) || { ...FALLBACK, balance: 0, label: () => 'Credits' };

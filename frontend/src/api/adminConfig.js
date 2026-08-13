import client from './client';

// Registry-backed configuration. The backend returns each setting's type,
// bounds, options and metadata, so the UI never hardcodes a field list.

export const getRegistry = () => client.get('/admin/config/registry').then((r) => r.data);

export const getConfig = (section) =>
  client.get('/admin/config', { params: section ? { section } : {} }).then((r) => r.data);

export const patchConfig = (settings, extra = {}) =>
  client.patch('/admin/config', { settings, ...extra }).then((r) => r.data);

export const resetConfig = (keys) => client.post('/admin/config/reset', { keys }).then((r) => r.data);

export const searchConfig = (q) =>
  client.get('/admin/config/search', { params: { q } }).then((r) => r.data);

export const getAuditLog = (params = {}) =>
  client.get('/admin/config/audit', { params }).then((r) => r.data);

// --- jobs -----------------------------------------------------------------

export const getJobs = () => client.get('/admin/jobs').then((r) => r.data);
export const runJob = (name, force = false) =>
  client.post(`/admin/jobs/${name}/run`, null, { params: force ? { force: true } : {} }).then((r) => r.data);
export const getJobRuns = (params = {}) => client.get('/admin/jobs/runs', { params }).then((r) => r.data);

// --- monetization catalogue ----------------------------------------------

const m = (path) => `/admin/monetization${path}`;

export const getPacks = () => client.get(m('/packs')).then((r) => r.data);
export const createPack = (payload) => client.post(m('/packs'), payload).then((r) => r.data);
export const updatePack = (id, payload) => client.put(m(`/packs/${id}`), payload).then((r) => r.data);
export const deletePack = (id) => client.delete(m(`/packs/${id}`)).then((r) => r.data);

export const testPaypal = () => client.get(m('/paypal/test')).then((r) => r.data);

export const getPaymentReadiness = () => client.get(m('/readiness')).then((r) => r.data);

export const getCurrencies = () => client.get(m('/currencies')).then((r) => r.data);
export const upsertCurrency = (code, payload) => client.put(m(`/currencies/${code}`), payload).then((r) => r.data);
export const seedCurrencies = () => client.post(m('/currencies/seed')).then((r) => r.data);
export const refreshRates = () => client.post(m('/currencies/refresh-rates')).then((r) => r.data);

export const getWallets = (params = {}) => client.get(m('/wallets'), { params }).then((r) => r.data);
export const getWalletDetail = (userId) => client.get(m(`/wallets/${userId}`)).then((r) => r.data);
export const adjustWallet = (userId, payload) =>
  client.post(m(`/wallets/${userId}/adjust`), payload).then((r) => r.data);

export const getGrants = (params = {}) => client.get(m('/grants'), { params }).then((r) => r.data);
export const previewAudience = (audience) => client.post(m('/grants/preview'), { audience }).then((r) => r.data);
export const createGrant = (payload) => client.post(m('/grants'), payload).then((r) => r.data);
export const searchGrantUsers = (q, limit = 10) =>
  client.get(m('/grants/user-search'), { params: { q, limit } }).then((r) => r.data);
export const quickSendCredits = (payload) => client.post(m('/grants/quick-send'), payload).then((r) => r.data);
export const dryRunGrant = (id) => client.post(m(`/grants/${id}/dry-run`)).then((r) => r.data);
export const executeGrant = (id) => client.post(m(`/grants/${id}/execute`)).then((r) => r.data);

// --- subscriptions --------------------------------------------------------

export const getPlans = () => client.get(m('/plans')).then((r) => r.data);
export const createPlan = (payload) => client.post(m('/plans'), payload).then((r) => r.data);
export const updatePlan = (id, payload) => client.put(m(`/plans/${id}`), payload).then((r) => r.data);
export const syncPlan = (id) => client.post(m(`/plans/${id}/sync`)).then((r) => r.data);
export const deletePlan = (id) => client.delete(m(`/plans/${id}`)).then((r) => r.data);
export const getSubscriptions = (params = {}) =>
  client.get(m('/subscriptions'), { params }).then((r) => r.data);
export const getSubscriptionSummary = () => client.get(m('/subscriptions/summary')).then((r) => r.data);

// --- analytics ------------------------------------------------------------

export const getNovelLeaderboard = (params = {}) =>
  client.get('/admin/analytics/novels', { params }).then((r) => r.data);
export const getNovelPerformance = (id) => client.get(`/admin/analytics/novels/${id}`).then((r) => r.data);
export const getFunnel = (params = {}) => client.get('/admin/analytics/funnel', { params }).then((r) => r.data);
export const getEconomy = () => client.get('/admin/analytics/economy').then((r) => r.data);

import client from './client';

// One module per domain rather than client.get scattered through components.
// When a response shape changes, exactly one file changes.

// --- wallet ---------------------------------------------------------------

export const getWallet = () => client.get('/wallet').then((r) => r.data);

export const getTransactions = (params = {}) =>
  client.get('/wallet/transactions', { params }).then((r) => r.data);

export const setAutoUnlock = (payload) => client.put('/wallet/auto-unlock', payload).then((r) => r.data);

// --- store ----------------------------------------------------------------

export const getStoreConfig = () => client.get('/store/config').then((r) => r.data);

export const getPacks = (currency) =>
  client.get('/store/packs', { params: currency ? { currency } : {} }).then((r) => r.data);

export const createOrder = (payload) => client.post('/store/orders', payload).then((r) => r.data);

export const captureOrder = (orderId) =>
  client.post(`/store/orders/${orderId}/capture`).then((r) => r.data);

export const getOrders = (params = {}) => client.get('/store/orders', { params }).then((r) => r.data);

// --- subscriptions --------------------------------------------------------

export const getPlans = () => client.get('/subscriptions/plans').then((r) => r.data);

export const getMySubscription = () => client.get('/subscriptions/me').then((r) => r.data);

export const subscribe = (payload) => client.post('/subscriptions', payload).then((r) => r.data);

/**
 * Confirm after returning from PayPal.
 *
 * The ACTIVATED webhook is authoritative but can lag, and a reader who just
 * paid should not be shown "pending". Both paths converge on the same
 * cycle-keyed grant, so whichever lands first wins.
 */
export const confirmSubscription = (id) =>
  client.post(`/subscriptions/${id}/confirm`).then((r) => r.data);

export const cancelSubscription = (reason) =>
  client.delete('/subscriptions', { data: { reason } }).then((r) => r.data);

// --- chapter access -------------------------------------------------------

export const getChapterAccess = (slug, number) =>
  client.get(`/novels/${slug}/chapters/${number}/access`).then((r) => r.data);

/**
 * Unlock one chapter.
 *
 * No idempotency header: the server keys on (user, chapter) with a unique
 * index, so a double-click is already safe. Sending one would imply a
 * guarantee the server does not read, and would add a CORS preflight to every
 * unlock when the API is on a different origin.
 */
export const unlockChapter = (slug, number) =>
  client.post(`/novels/${slug}/chapters/${number}/unlock`).then((r) => r.data);

/** Quote a bulk unlock without committing. */
export const quoteBulkUnlock = (slug, payload) =>
  client.post(`/novels/${slug}/unlock-bulk`, { ...payload, commit: false }).then((r) => r.data);

export const commitBulkUnlock = (slug, payload) =>
  client.post(`/novels/${slug}/unlock-bulk`, { ...payload, commit: true }).then((r) => r.data);

// --- chapter list ---------------------------------------------------------

export const getChapters = (slug, params = {}) =>
  client.get(`/novels/${slug}/chapters`, { params }).then((r) => r.data);

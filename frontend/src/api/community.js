import client from './client';

// Admin community API. Kept in one place so a route change is one edit, and so
// every call site reads the same way — mirrors api/adminConfig.js.

const base = '/admin/community';

export const listSpaces = (params) => client.get(`${base}/spaces`, { params }).then((r) => r.data);
export const getSpace = (id) => client.get(`${base}/spaces/${id}`).then((r) => r.data);
export const updateSpace = (id, body) => client.patch(`${base}/spaces/${id}`, body).then((r) => r.data);
export const forceOverrides = (id, overrides, reason) =>
  client.patch(`${base}/spaces/${id}/overrides`, { overrides, reason }).then((r) => r.data);

// approve | reject | quarantine | archive | ban | restore
export const spaceLifecycle = (id, action, body) =>
  client.post(`${base}/spaces/${id}/${action}`, body).then((r) => r.data);
export const transferSpace = (id, userId, reason) =>
  client.post(`${base}/spaces/${id}/transfer`, { userId, reason }).then((r) => r.data);
export const recountSpace = (id) => client.post(`${base}/spaces/${id}/recount`).then((r) => r.data);

export const listPosts = (params) => client.get(`${base}/posts`, { params }).then((r) => r.data);
export const bulkPosts = (ids, action, reason) =>
  client.post(`${base}/posts/bulk`, { ids, action, reason }).then((r) => r.data);

export const listReports = (params) => client.get(`${base}/reports`, { params }).then((r) => r.data);
export const reportDetail = (targetType, target) =>
  client.get(`${base}/reports/detail`, { params: { targetType, target } }).then((r) => r.data);
export const reviewReport = (body) => client.post('/reports/review', body).then((r) => r.data);

export const listModActions = (params) => client.get(`${base}/modlog`, { params }).then((r) => r.data);
export const listAppeals = (params) => client.get(`${base}/appeals`, { params }).then((r) => r.data);
export const resolveAppeal = (id, body) =>
  client.post(`/reports/appeals/${id}/resolve`, body).then((r) => r.data);

export const transparencyReport = (params) =>
  client.get(`${base}/transparency`, { params }).then((r) => r.data);
export const getInsights = () => client.get(`${base}/insights`).then((r) => r.data);
export const rebuild = (target) => client.post(`${base}/rebuild`, { target }).then((r) => r.data);

export const userCommunityDetail = (id) => client.get(`${base}/users/${id}`).then((r) => r.data);
export const setCommunityBan = (id, body) =>
  client.post(`${base}/users/${id}/community-ban`, body).then((r) => r.data);
export const setSpaceCreationPolicy = (id, policy, reason) =>
  client.post(`${base}/users/${id}/space-creation`, { policy, reason }).then((r) => r.data);
export const adjustKarma = (id, amount, reason) =>
  client.post(`${base}/users/${id}/karma`, { amount, reason }).then((r) => r.data);

// Restricted: requires the child_safety elevated permission. A 403 here is the
// expected response for an ordinary admin, not an error to surface loudly.
export const listIncidents = (params) =>
  client.get(`${base}/safety/incidents`, { params }).then((r) => r.data);
export const reviewIncident = (id, body) =>
  client.post(`${base}/safety/incidents/${id}/review`, body).then((r) => r.data);

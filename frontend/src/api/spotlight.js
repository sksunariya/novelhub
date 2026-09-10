import client from './client';

// The curated homepage.
//
// Public reads and the admin curation surface, kept in one file because the
// admin half is small and the two describe the same object — mirrors the way
// api/monetization.js pairs the store with its catalogue.

// --- public ---------------------------------------------------------------

// The whole page below the hero, in one request. Deliberately not one call per
// section: six parallel requests rendered in arrival order, so the homepage
// reflowed as it loaded and the section order depended on the network.
export const getSpotlight = () => client.get('/spotlight').then((r) => r.data);

// Answering a featured poll without leaving the homepage.
export const votePoll = (postId, optionIds) =>
  client.post(`/posts/${postId}/poll`, { optionIds }).then((r) => r.data);

// --- admin ----------------------------------------------------------------

const base = '/admin/spotlight';

export const listRails = () => client.get(base).then((r) => r.data);
export const createRail = (body) => client.post(base, body).then((r) => r.data);
export const updateRail = (id, body) => client.put(`${base}/${id}`, body).then((r) => r.data);
export const deleteRail = (id) => client.delete(`${base}/${id}`).then((r) => r.data);
export const reorderRails = (railIds) =>
  client.put(`${base}/reorder`, { railIds }).then((r) => r.data);

// The featurable-entity registry, so the picker never hardcodes what can be
// pinned — it renders whatever the backend says exists.
export const railTypes = () => client.get(`${base}/types`).then((r) => r.data);
export const searchEntities = (type, q) =>
  client.get(`${base}/search`, { params: { type, q } }).then((r) => r.data);

// Resolved through the same service the public endpoint uses. `as=anon` shows
// the logged-out homepage, which is the one an admin never otherwise sees.
export const previewSpotlight = (as) =>
  client.get(`${base}/preview`, { params: { as } }).then((r) => r.data);

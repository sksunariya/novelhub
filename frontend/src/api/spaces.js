import client from './client';

// Public community API.
//
// Every read here tolerates a 404 while `spaces.enabled` is false — the whole
// surface is switched off server-side until launch, and the UI treats that as
// "not available" rather than an error.

// --- feeds ----------------------------------------------------------------
// type: home | popular | all
export const getFeed = (type, params) =>
  client.get(`/feed/${type}`, { params }).then((r) => r.data);

export const getSpaceFeed = (slug, params) =>
  client.get(`/feed/space/${slug}`, { params }).then((r) => r.data);

// The Discussion tab on a linked entity — a novel, a chapter, anything in the
// link-type registry.
export const getLinkedFeed = (type, id, params) =>
  client.get(`/feed/linked/${type}/${id}`, { params }).then((r) => r.data);

// --- spaces ---------------------------------------------------------------
export const listSpaces = (params) => client.get('/spaces', { params }).then((r) => r.data);
export const getSpace = (slug) => client.get(`/spaces/${slug}`).then((r) => r.data);
export const createSpace = (body) => client.post('/spaces', body).then((r) => r.data);
export const updateSpace = (slug, body) => client.patch(`/spaces/${slug}`, body).then((r) => r.data);

// Tells the composer whether this person can create a space, and if not, WHY —
// so the UI can explain rather than showing a dead button.
export const creationEligibility = () => client.get('/spaces/eligibility').then((r) => r.data);

export const joinSpace = (slug) => client.post(`/spaces/${slug}/join`).then((r) => r.data);
export const leaveSpace = (slug) => client.post(`/spaces/${slug}/leave`).then((r) => r.data);
export const listMembers = (slug, params) =>
  client.get(`/spaces/${slug}/members`, { params }).then((r) => r.data);
export const listRules = (slug) => client.get(`/spaces/${slug}/rules`).then((r) => r.data);
export const spaceModlog = (slug, params) =>
  client.get(`/spaces/${slug}/modlog`, { params }).then((r) => r.data);
export const listFlairs = (slug, kind) =>
  client.get(`/spaces/${slug}/flairs`, { params: { kind } }).then((r) => r.data);

// --- posts ----------------------------------------------------------------
export const createPost = (body) => client.post('/posts', body).then((r) => r.data);
export const getPost = (id) => client.get(`/posts/${id}`).then((r) => r.data);
export const updatePost = (id, body) => client.patch(`/posts/${id}`, body).then((r) => r.data);
export const deletePost = (id) => client.delete(`/posts/${id}`).then((r) => r.data);

// value: 1 | -1 | 0 (remove). Idempotent server-side.
export const votePost = (id, value) => client.post(`/posts/${id}/vote`, { value }).then((r) => r.data);
export const moderatePost = (id, body) => client.post(`/posts/${id}/moderate`, body).then((r) => r.data);

// --- comments -------------------------------------------------------------
export const getComments = (postId, params) =>
  client.get(`/posts/${postId}/comments`, { params }).then((r) => r.data);
export const createComment = (postId, body) =>
  client.post(`/posts/${postId}/comments`, body).then((r) => r.data);
export const getReplies = (commentId, params) =>
  client.get(`/comments/${commentId}/replies`, { params }).then((r) => r.data);
export const updateComment = (id, body) => client.patch(`/comments/${id}`, body).then((r) => r.data);
export const deleteComment = (id) => client.delete(`/comments/${id}`).then((r) => r.data);
export const voteComment = (id, value) =>
  client.post(`/comments/${id}/vote`, { value }).then((r) => r.data);
export const commentHistory = (id) => client.get(`/comments/${id}/history`).then((r) => r.data);

// --- profiles -------------------------------------------------------------
export const getProfile = (username) => client.get(`/u/${username}`).then((r) => r.data);
export const getUserPosts = (username, params) =>
  client.get(`/u/${username}/posts`, { params }).then((r) => r.data);
export const getUserComments = (username, params) =>
  client.get(`/u/${username}/comments`, { params }).then((r) => r.data);

// --- reporting ------------------------------------------------------------
export const reportReasons = () => client.get('/reports/reasons').then((r) => r.data);
export const submitReport = (type, id, body) =>
  client.post(`/reports/${type}/${id}`, body).then((r) => r.data);

// Every decision taken against you, and whether it can still be appealed.
export const myStatements = () => client.get('/reports/statements/mine').then((r) => r.data);
export const submitAppeal = (body) => client.post('/reports/appeals', body).then((r) => r.data);

// --- media ----------------------------------------------------------------
// Uploads happen as files are dragged in, before the post exists; the assets
// are claimed on submit.
export const uploadDraftMedia = (formData) =>
  client.post('/media/draft', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data);

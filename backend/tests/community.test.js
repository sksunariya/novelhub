const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const Novel = require('../src/models/Novel');

describe('Community', () => {
  describe('comments', () => {
    it('creates and lists comments on a chapter', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const createRes = await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Great chapter!' });
      expect(createRes.status).toBe(201);
      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments).toHaveLength(1);
      expect(listRes.body.comments[0].content).toBe('Great chapter!');
      expect(listRes.body.comments[0].user.username).toBeDefined();
    });

    it('rejects empty comment and unauthenticated comment', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const empty = await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '  ' });
      expect(empty.status).toBe(400);
      const anon = await api().post(`/api/community/chapters/${chapter._id}/comments`).send({ content: 'hi' });
      expect(anon.status).toBe(401);
    });

    it('allows only owner or admin to delete a comment', async () => {
      const { token: ownerToken } = await createUser();
      const { token: otherToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'mine' });
      const commentId = body.comment._id;
      const denied = await api().delete(`/api/community/comments/${commentId}`).set('Authorization', `Bearer ${otherToken}`);
      expect(denied.status).toBe(403);
      const allowed = await api().delete(`/api/community/comments/${commentId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(allowed.status).toBe(200);
    });

    it('toggles comment like', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'like me' });
      const like = await api().post(`/api/community/comments/${body.comment._id}/like`).set('Authorization', `Bearer ${token}`);
      expect(like.body).toEqual({ liked: true, likeCount: 1 });
      const unlike = await api().post(`/api/community/comments/${body.comment._id}/like`).set('Authorization', `Bearer ${token}`);
      expect(unlike.body).toEqual({ liked: false, likeCount: 0 });
    });
  });

  describe('reviews', () => {
    it('creates a review and updates novel rating', async () => {
      const { token } = await createUser();
      const { token: token2 } = await createUser();
      const novel = await createNovel();
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5, content: 'Loved it' });
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token2}`).send({ rating: 4 });
      const updated = await Novel.findById(novel._id);
      expect(updated.ratingAvg).toBe(4.5);
      expect(updated.ratingCount).toBe(2);
    });

    it('updates existing review instead of duplicating', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 2 });
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5 });
      const list = await api().get(`/api/novels/id/${novel._id}/reviews`);
      expect(list.body.reviews).toHaveLength(1);
      expect(list.body.reviews[0].rating).toBe(5);
      const updated = await Novel.findById(novel._id);
      expect(updated.ratingAvg).toBe(5);
      expect(updated.ratingCount).toBe(1);
    });

    it('rejects invalid rating', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const res = await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 9 });
      expect(res.status).toBe(400);
    });

    it('recalculates rating after review deletion', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const { body } = await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5 });
      await api().delete(`/api/community/reviews/${body.review._id}`).set('Authorization', `Bearer ${token}`);
      const updated = await Novel.findById(novel._id);
      expect(updated.ratingAvg).toBe(0);
      expect(updated.ratingCount).toBe(0);
    });
  });
});

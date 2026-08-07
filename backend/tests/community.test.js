const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');
const Notification = require('../src/models/Notification');
const { NOTIFICATION_TYPES, ROLES } = require('../src/config/constants');

const postComment = (chapterId, token, body) =>
  api().post(`/api/community/chapters/${chapterId}/comments`).set('Authorization', `Bearer ${token}`).send(body);

describe('Community', () => {
  describe('comments', () => {
    it('creates and lists comments on a chapter', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const createRes = await postComment(chapter._id, token, { content: 'Great chapter!' });
      expect(createRes.status).toBe(201);
      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments).toHaveLength(1);
      expect(listRes.body.comments[0].content).toBe('Great chapter!');
      expect(listRes.body.comments[0].user.username).toBeDefined();
    });

    it('exposes the author role so staff replies can be badged', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await postComment(chapter._id, token, { content: 'Official note' });
      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments[0].user.role).toBe(ROLES.ADMIN);
    });

    it('nests replies under their parent comment', async () => {
      const { token: user1Token } = await createUser();
      const { token: user2Token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const parentRes = await postComment(chapter._id, user1Token, { content: 'Parent comment' });
      const parentId = parentRes.body.comment._id;
      const replyRes = await postComment(chapter._id, user2Token, {
        content: 'Reply to parent',
        parentComment: parentId,
      });
      expect(replyRes.status).toBe(201);
      expect(replyRes.body.comment.parentComment).toBe(parentId);

      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments).toHaveLength(1);
      expect(listRes.body.comments[0]._id).toBe(parentId);
      expect(listRes.body.comments[0].replies).toHaveLength(1);
      expect(listRes.body.comments[0].replies[0].content).toBe('Reply to parent');
    });

    it('flattens a reply to a reply onto the top-level comment', async () => {
      const { token } = await createUser();
      const { token: otherToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const parentRes = await postComment(chapter._id, token, { content: 'Parent' });
      const parentId = parentRes.body.comment._id;
      const replyRes = await postComment(chapter._id, otherToken, { content: 'Reply', parentComment: parentId });
      const nestedRes = await postComment(chapter._id, token, {
        content: 'Reply to the reply',
        parentComment: replyRes.body.comment._id,
      });
      expect(nestedRes.body.comment.parentComment).toBe(parentId);

      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments).toHaveLength(1);
      expect(listRes.body.comments[0].replies).toHaveLength(2);
    });

    it('paginates top-level comments without splitting a thread', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const parentRes = await postComment(chapter._id, token, { content: 'Parent' });
      const parentId = parentRes.body.comment._id;
      await postComment(chapter._id, token, { content: 'Reply one', parentComment: parentId });
      await postComment(chapter._id, token, { content: 'Reply two', parentComment: parentId });

      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments?limit=1`);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.pages).toBe(1);
      expect(listRes.body.comments[0].replies).toHaveLength(2);
    });

    it('rejects empty comment and unauthenticated comment', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const empty = await postComment(chapter._id, token, { content: '  ' });
      expect(empty.status).toBe(400);
      const anon = await api().post(`/api/community/chapters/${chapter._id}/comments`).send({ content: 'hi' });
      expect(anon.status).toBe(401);
    });

    it('rejects a reply to an unknown parent comment', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const res = await postComment(chapter._id, token, {
        content: 'orphan',
        parentComment: novel._id.toString(),
      });
      expect(res.status).toBe(404);
    });

    it('rejects a reply whose parent lives on another chapter', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapterOne = await createChapter(novel, { number: 1 });
      const chapterTwo = await createChapter(novel, { number: 2 });
      const { body } = await postComment(chapterOne._id, token, { content: 'On chapter one' });

      const res = await postComment(chapterTwo._id, token, {
        content: 'Grafted into the wrong thread',
        parentComment: body.comment._id,
      });
      expect(res.status).toBe(404);
      const listOne = await api().get(`/api/community/chapters/${chapterOne._id}/comments`);
      expect(listOne.body.comments[0].replies).toHaveLength(0);
    });

    it('allows only owner or admin to delete a comment', async () => {
      const { token: ownerToken } = await createUser();
      const { token: otherToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await postComment(chapter._id, ownerToken, { content: 'mine' });
      const commentId = body.comment._id;
      const denied = await api().delete(`/api/community/comments/${commentId}`).set('Authorization', `Bearer ${otherToken}`);
      expect(denied.status).toBe(403);
      const allowed = await api().delete(`/api/community/comments/${commentId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(allowed.status).toBe(200);
    });

    it('cascades deletion of a comment to its replies', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await postComment(chapter._id, token, { content: 'parent' });
      await postComment(chapter._id, token, { content: 'reply', parentComment: body.comment._id });
      await api().delete(`/api/community/comments/${body.comment._id}`).set('Authorization', `Bearer ${token}`);
      const listRes = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(listRes.body.comments).toHaveLength(0);
    });

    it('toggles comment like and dislike exclusively', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await postComment(chapter._id, token, { content: 'react to me' });
      const commentId = body.comment._id;

      const like = await api().post(`/api/community/comments/${commentId}/like`).set('Authorization', `Bearer ${token}`);
      expect(like.body).toEqual({ liked: true, disliked: false, likeCount: 1, dislikeCount: 0 });

      const dislike = await api()
        .post(`/api/community/comments/${commentId}/dislike`)
        .set('Authorization', `Bearer ${token}`);
      expect(dislike.body).toEqual({ liked: false, disliked: true, likeCount: 0, dislikeCount: 1 });

      const undislike = await api()
        .post(`/api/community/comments/${commentId}/dislike`)
        .set('Authorization', `Bearer ${token}`);
      expect(undislike.body).toEqual({ liked: false, disliked: false, likeCount: 0, dislikeCount: 0 });
    });

    it('notifies the comment author when someone replies', async () => {
      const { user: author, token: authorToken } = await createUser();
      const { user: responder, token: responderToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await postComment(chapter._id, authorToken, { content: 'parent' });
      await postComment(chapter._id, responderToken, { content: 'reply', parentComment: body.comment._id });

      const notifications = await Notification.find({ user: author._id });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(NOTIFICATION_TYPES.REPLY);
      expect(notifications[0].message).toContain(responder.username);
      expect(notifications[0].link).toBe(`/novel/${novel.slug}/chapter/${chapter.number}`);
    });

    it('does not notify when replying to your own comment', async () => {
      const { user, token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await postComment(chapter._id, token, { content: 'parent' });
      await postComment(chapter._id, token, { content: 'self reply', parentComment: body.comment._id });
      expect(await Notification.countDocuments({ user: user._id })).toBe(0);
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

    it('toggles review like and dislike exclusively', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 4 });
      const reviewId = body.review._id;

      const like = await api().post(`/api/community/reviews/${reviewId}/like`).set('Authorization', `Bearer ${token}`);
      expect(like.body).toEqual({ liked: true, disliked: false, likeCount: 1, dislikeCount: 0 });
      const dislike = await api().post(`/api/community/reviews/${reviewId}/dislike`).set('Authorization', `Bearer ${token}`);
      expect(dislike.body).toEqual({ liked: false, disliked: true, likeCount: 0, dislikeCount: 1 });
    });

    it('adds a reply, notifies the review author and toggles reply reactions', async () => {
      const { user: author, token: authorToken } = await createUser();
      const { user: responder, token: responderToken } = await createUser();
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${authorToken}`)
        .send({ rating: 5 });
      const reviewId = body.review._id;

      const replyRes = await api()
        .post(`/api/community/reviews/${reviewId}/replies`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ content: 'Agreed!' });
      expect(replyRes.status).toBe(201);
      expect(replyRes.body.review.replies).toHaveLength(1);
      const replyId = replyRes.body.review.replies[0]._id;

      const notifications = await Notification.find({ user: author._id, type: NOTIFICATION_TYPES.REPLY });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain(responder.username);
      expect(notifications[0].link).toBe(`/novel/${novel.slug}`);

      const like = await api()
        .post(`/api/community/reviews/${reviewId}/replies/${replyId}/like`)
        .set('Authorization', `Bearer ${authorToken}`);
      expect(like.body.liked).toBe(true);
      expect(like.body.likeCount).toBe(1);

      const dislike = await api()
        .post(`/api/community/reviews/${reviewId}/replies/${replyId}/dislike`)
        .set('Authorization', `Bearer ${authorToken}`);
      expect(dislike.body).toMatchObject({ liked: false, disliked: true, likeCount: 0, dislikeCount: 1 });
    });

    it('rejects an empty review reply', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 3 });
      const res = await api()
        .post(`/api/community/reviews/${body.review._id}/replies`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '   ' });
      expect(res.status).toBe(400);
    });

    it('hides a soft-deleted review reply from the public list', async () => {
      const { token } = await createUser();
      const { token: responderToken } = await createUser();
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 5 });
      const reviewId = body.review._id;
      const replyRes = await api()
        .post(`/api/community/reviews/${reviewId}/replies`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ content: 'to be removed' });
      const replyId = replyRes.body.review.replies[0]._id;

      const del = await api()
        .delete(`/api/community/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${responderToken}`);
      expect(del.status).toBe(200);
      expect(del.body.review.replies).toHaveLength(0);

      const list = await api().get(`/api/novels/id/${novel._id}/reviews`);
      expect(list.body.reviews[0].replies).toHaveLength(0);

      const repeat = await api()
        .delete(`/api/community/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${responderToken}`);
      expect(repeat.status).toBe(404);
    });

    it('keeps chapter reviews out of the novel rating and list', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 5 });
      const chapterRes = await api()
        .post(`/api/community/chapters/${chapter._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 1, content: 'Weak chapter' });
      expect(chapterRes.status).toBe(201);
      expect(chapterRes.body.review.chapter).toBe(chapter._id.toString());

      const updatedNovel = await Novel.findById(novel._id);
      expect(updatedNovel.ratingAvg).toBe(5);
      expect(updatedNovel.ratingCount).toBe(1);
      const updatedChapter = await Chapter.findById(chapter._id);
      expect(updatedChapter.ratingAvg).toBe(1);
      expect(updatedChapter.ratingCount).toBe(1);

      const novelList = await api().get(`/api/novels/id/${novel._id}/reviews`);
      expect(novelList.body.reviews).toHaveLength(1);
      expect(novelList.body.reviews[0].rating).toBe(5);
      const chapterList = await api().get(`/api/community/chapters/${chapter._id}/reviews`);
      expect(chapterList.body.reviews).toHaveLength(1);
      expect(chapterList.body.reviews[0].rating).toBe(1);
    });

    it('updates an existing chapter review instead of duplicating', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api().post(`/api/community/chapters/${chapter._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 2 });
      await api().post(`/api/community/chapters/${chapter._id}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating: 4 });
      const list = await api().get(`/api/community/chapters/${chapter._id}/reviews`);
      expect(list.body.reviews).toHaveLength(1);
      expect(list.body.reviews[0].rating).toBe(4);
      expect((await Chapter.findById(chapter._id)).ratingAvg).toBe(4);
    });

    it('recalculates the chapter rating when a chapter review is deleted', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const { body } = await api()
        .post(`/api/community/chapters/${chapter._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 3 });
      await api().delete(`/api/community/reviews/${body.review._id}`).set('Authorization', `Bearer ${token}`);
      const updated = await Chapter.findById(chapter._id);
      expect(updated.ratingAvg).toBe(0);
      expect(updated.ratingCount).toBe(0);
    });

    it('rejects a chapter review with an invalid rating or unknown chapter', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const bad = await api()
        .post(`/api/community/chapters/${chapter._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 0 });
      expect(bad.status).toBe(400);
      const missing = await api()
        .post(`/api/community/chapters/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rating: 3 });
      expect(missing.status).toBe(404);
    });

    it('allows only reply owner or admin to delete a review reply', async () => {
      const { token: authorToken } = await createUser();
      const { token: responderToken } = await createUser();
      const { token: strangerToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${authorToken}`)
        .send({ rating: 5 });
      const reviewId = body.review._id;
      const replyRes = await api()
        .post(`/api/community/reviews/${reviewId}/replies`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ content: 'mine' });
      const replyId = replyRes.body.review.replies[0]._id;

      const denied = await api()
        .delete(`/api/community/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(denied.status).toBe(403);
      const allowed = await api()
        .delete(`/api/community/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(allowed.status).toBe(200);
    });
  });
});

const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');
const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const Chapter = require('../src/models/Chapter');
const Novel = require('../src/models/Novel');

describe('Admin', () => {
  describe('editor image upload', () => {
    it('uploads an image for the chapter editor and returns its url', async () => {
      const { token } = await createAdmin();
      const filePath = path.join(os.tmpdir(), 'editor-image.png');
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAarVyFEAAAAASUVORK5CYII=',
        'base64'
      );
      fs.writeFileSync(filePath, pngBuffer);
      const res = await api()
        .post('/api/admin/uploads/image')
        .set('Authorization', `Bearer ${token}`)
        .attach('image', filePath);
      expect(res.status).toBe(201);
      expect(res.body.url).toMatch(/^\/uploads\//);
      fs.unlinkSync(filePath);
    });

    it('rejects when no image is provided', async () => {
      const { token } = await createAdmin();
      const res = await api().post('/api/admin/uploads/image').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('rejects non-admins', async () => {
      const { token } = await createUser();
      const res = await api().post('/api/admin/uploads/image').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('novel management', () => {
    it('creates a novel with slug and parsed genres', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .post('/api/admin/novels')
        .set('Authorization', `Bearer ${token}`)
        .field('title', 'Blood Moon Chronicles')
        .field('author', 'A. Writer')
        .field('genres', 'Fantasy, Horror')
        .field('tags', 'vampires');
      expect(res.status).toBe(201);
      expect(res.body.novel.slug).toBe('blood-moon-chronicles');
      expect(res.body.novel.genres).toEqual(['Fantasy', 'Horror']);
    });

    it('updates and deletes a novel with cascade', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      await createChapter(novel);
      const update = await api()
        .put(`/api/admin/novels/${novel._id}`)
        .set('Authorization', `Bearer ${token}`)
        .field('status', 'completed')
        .field('featured', 'true');
      expect(update.body.novel.status).toBe('completed');
      expect(update.body.novel.featured).toBe(true);
      const del = await api().delete(`/api/admin/novels/${novel._id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      expect(await Chapter.countDocuments({ novel: novel._id })).toBe(0);
    });
  });

  describe('chapter management', () => {
    it('creates chapter with auto-increment number and syncs novel meta', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      await api()
        .post(`/api/admin/novels/${novel._id}/chapters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'First', content: '<p>one</p>' });
      const res = await api()
        .post(`/api/admin/novels/${novel._id}/chapters`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Second', content: '<p>two</p>' });
      expect(res.body.chapter.number).toBe(2);
      const updated = await Novel.findById(novel._id);
      expect(updated.chapterCount).toBe(2);
      expect(updated.lastChapterAt).toBeTruthy();
    });

    it('uploads a .txt chapter file and converts to html', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      const filePath = path.join(os.tmpdir(), 'chapter-1-the-awakening.txt');
      fs.writeFileSync(filePath, 'First paragraph.\n\nSecond paragraph.');
      const res = await api()
        .post(`/api/admin/novels/${novel._id}/chapters/upload`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', filePath);
      expect(res.status).toBe(201);
      expect(res.body.chapter.title).toBe('chapter 1 the awakening');
      expect(res.body.chapter.content).toBe('<p>First paragraph.</p><p>Second paragraph.</p>');
      fs.unlinkSync(filePath);
    });

    it('bulk uploads chapters from a zip in file order', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      const zip = new AdmZip();
      zip.addFile('chapter-1.txt', Buffer.from('Content one'));
      zip.addFile('chapter-2.txt', Buffer.from('Content two'));
      zip.addFile('chapter-10.txt', Buffer.from('Content ten'));
      zip.addFile('notes.pdf', Buffer.from('ignored'));
      const zipPath = path.join(os.tmpdir(), 'chapters.zip');
      zip.writeZip(zipPath);
      const res = await api()
        .post(`/api/admin/novels/${novel._id}/chapters/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', zipPath);
      expect(res.status).toBe(201);
      expect(res.body.createdCount).toBe(3);
      const chapters = await Chapter.find({ novel: novel._id }).sort({ number: 1 });
      expect(chapters.map((c) => c.title)).toEqual(['chapter 1', 'chapter 2', 'chapter 10']);
      fs.unlinkSync(zipPath);
    });

    it('cascades a chapter deletion to its comments and chapter reviews', async () => {
      const { token: adminToken } = await createAdmin();
      const { token: userToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ content: 'goes with the chapter' });
      await api()
        .post(`/api/community/chapters/${chapter._id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 4 });
      expect((await Chapter.findById(chapter._id)).ratingCount).toBe(1);

      await api().delete(`/api/admin/chapters/${chapter._id}`).set('Authorization', `Bearer ${adminToken}`);

      const chapterReviews = await api().get(`/api/community/chapters/${chapter._id}/reviews`);
      expect(chapterReviews.body.reviews).toHaveLength(0);
      const comments = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(comments.body.comments).toHaveLength(0);
      const stored = await Chapter.findOne({ _id: chapter._id }, null, { withDeleted: true });
      expect(stored.ratingCount).toBe(0);
      expect(stored.ratingAvg).toBe(0);
    });

    it('updates and deletes a chapter', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const update = await api()
        .put(`/api/admin/chapters/${chapter._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Renamed', published: false });
      expect(update.body.chapter.title).toBe('Renamed');
      expect(update.body.chapter.published).toBe(false);
      const del = await api().delete(`/api/admin/chapters/${chapter._id}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const updated = await Novel.findById(novel._id);
      expect(updated.chapterCount).toBe(0);
    });
  });

  describe('user management', () => {
    it('lists, bans and changes user roles', async () => {
      const { token: adminToken } = await createAdmin();
      const { user } = await createUser();
      const list = await api().get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
      expect(list.body.users.length).toBe(2);
      const banned = await api()
        .put(`/api/admin/users/${user._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ banned: true, role: 'admin' });
      expect(banned.body.user.banned).toBe(true);
      expect(banned.body.user.role).toBe('admin');
    });

    it('rebuilds novel and chapter ratings when a user is deleted', async () => {
      const { token: adminToken } = await createAdmin();
      const { user, token: userToken } = await createUser();
      const { token: keeperToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${userToken}`).send({ rating: 1 });
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${keeperToken}`).send({ rating: 5 });
      await api()
        .post(`/api/community/chapters/${chapter._id}/reviews`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 2 });
      expect((await Novel.findById(novel._id)).ratingAvg).toBe(3);

      await api().delete(`/api/admin/users/${user._id}`).set('Authorization', `Bearer ${adminToken}`);

      const updatedNovel = await Novel.findById(novel._id);
      expect(updatedNovel.ratingAvg).toBe(5);
      expect(updatedNovel.ratingCount).toBe(1);
      const updatedChapter = await Chapter.findById(chapter._id);
      expect(updatedChapter.ratingCount).toBe(0);
      expect(updatedChapter.ratingAvg).toBe(0);
    });

    it('prevents admin from modifying own account', async () => {
      const { user, token } = await createAdmin();
      const res = await api().put(`/api/admin/users/${user._id}`).set('Authorization', `Bearer ${token}`).send({ banned: true });
      expect(res.status).toBe(400);
    });

    it('blocks banned user from authenticated routes', async () => {
      const { token: adminToken } = await createAdmin();
      const { user, token: userToken } = await createUser();
      await api().put(`/api/admin/users/${user._id}`).set('Authorization', `Bearer ${adminToken}`).send({ banned: true });
      const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('site settings', () => {
    it('updates settings fields and theme colors', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${token}`)
        .field('siteName', 'Test NovelHub')
        .field('announcement', 'Welcome!')
        .field('logoUrl', 'https://cdn.example.com/logo.png')
        .field('themeColors', JSON.stringify({ primary: '#ff0000' }));
      expect(res.status).toBe(200);
      expect(res.body.settings.siteName).toBe('Test NovelHub');
      expect(res.body.settings.logoUrl).toBe('https://cdn.example.com/logo.png');
      expect(res.body.settings.themeColors.primary).toBe('#ff0000');
      const publicRes = await api().get('/api/settings');
      expect(publicRes.body.settings.announcement).toBe('Welcome!');
    });

    it('updates home section visibility', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${token}`)
        .field('homeSections', JSON.stringify({ completed: false, trending: false }));
      expect(res.status).toBe(200);
      expect(res.body.settings.homeSections.completed).toBe(false);
      expect(res.body.settings.homeSections.trending).toBe(false);
      expect(res.body.settings.homeSections.featured).toBe(true);
      const publicRes = await api().get('/api/settings');
      expect(publicRes.body.settings.homeSections.completed).toBe(false);
    });

    it('enables maintenance mode blocking public routes but not admins', async () => {
      const { token } = await createAdmin();
      await api().put('/api/admin/settings').set('Authorization', `Bearer ${token}`).field('maintenanceMode', 'true');
      const publicRes = await api().get('/api/novels');
      expect(publicRes.status).toBe(503);
      const settingsRes = await api().get('/api/settings');
      expect(settingsRes.status).toBe(200);
      const loginRes = await api().post('/api/auth/login').send({ email: 'x@test.com', password: 'wrong' });
      expect(loginRes.status).toBe(401);
      const adminRes = await api().get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
      expect(adminRes.status).toBe(200);
    });
  });

  describe('dashboard and moderation', () => {
    it('returns aggregate stats', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel({ views: 10 });
      await createChapter(novel);
      const res = await api().get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
      expect(res.body.stats.novels).toBe(1);
      expect(res.body.stats.chapters).toBe(1);
      expect(res.body.stats.totalViews).toBe(10);
    });

    it('lists all comments and reviews for moderation', async () => {
      const { token: adminToken } = await createAdmin();
      const { token: userToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api().post(`/api/community/chapters/${chapter._id}/comments`).set('Authorization', `Bearer ${userToken}`).send({ content: 'hey' });
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${userToken}`).send({ rating: 4 });
      const comments = await api().get('/api/admin/comments').set('Authorization', `Bearer ${adminToken}`);
      expect(comments.body.comments).toHaveLength(1);
      const reviews = await api().get('/api/admin/reviews').set('Authorization', `Bearer ${adminToken}`);
      expect(reviews.body.reviews).toHaveLength(1);
    });
  });

  describe('comment moderation', () => {
    const postComment = (chapterId, token, body) =>
      api().post(`/api/community/chapters/${chapterId}/comments`).set('Authorization', `Bearer ${token}`).send(body);

    const seedThread = async () => {
      const admin = await createAdmin();
      const author = await createUser({ username: 'threadauthor' });
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      const parent = await postComment(chapter._id, author.token, { content: 'Original opinion' });
      const reply = await postComment(chapter._id, author.token, {
        content: 'Following up on my point',
        parentComment: parent.body.comment._id,
      });
      return {
        admin,
        author,
        novel,
        chapter,
        parentId: parent.body.comment._id,
        replyId: reply.body.comment._id,
      };
    };

    it('returns threads with replies and author status for moderation', async () => {
      const { admin, parentId, replyId } = await seedThread();
      const res = await api().get('/api/admin/comments').set('Authorization', `Bearer ${admin.token}`);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.comments[0]._id).toBe(parentId);
      expect(res.body.comments[0].user.banned).toBe(false);
      expect(res.body.comments[0].novel.title).toBeDefined();
      expect(res.body.comments[0].chapter.number).toBeDefined();
      expect(res.body.comments[0].replies.map((reply) => reply._id)).toEqual([replyId]);
    });

    it('keeps deleted replies visible inside an active thread', async () => {
      const { admin, parentId, replyId } = await seedThread();
      await api().delete(`/api/community/comments/${replyId}`).set('Authorization', `Bearer ${admin.token}`);
      const res = await api().get('/api/admin/comments').set('Authorization', `Bearer ${admin.token}`);
      expect(res.body.comments[0]._id).toBe(parentId);
      expect(res.body.comments[0].replies).toHaveLength(1);
      expect(res.body.comments[0].replies[0].deletedAt).toBeTruthy();
    });

    it('filters by status, novel and search term', async () => {
      const { admin, author, novel, chapter, parentId } = await seedThread();
      const otherNovel = await createNovel({ title: 'Other Novel' });
      const otherChapter = await createChapter(otherNovel);
      await postComment(otherChapter._id, author.token, { content: 'Unrelated chatter' });

      const byNovel = await api()
        .get(`/api/admin/comments?novel=${novel._id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(byNovel.body.comments).toHaveLength(1);
      expect(byNovel.body.comments[0].chapter._id).toBe(chapter._id.toString());

      const byContent = await api().get('/api/admin/comments?search=unrelated').set('Authorization', `Bearer ${admin.token}`);
      expect(byContent.body.comments).toHaveLength(1);
      expect(byContent.body.comments[0].content).toBe('Unrelated chatter');

      const byAuthor = await api().get('/api/admin/comments?search=threadauthor').set('Authorization', `Bearer ${admin.token}`);
      expect(byAuthor.body.comments).toHaveLength(2);

      const byReplyContent = await api()
        .get('/api/admin/comments?search=Following')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(byReplyContent.body.comments).toHaveLength(1);
      expect(byReplyContent.body.comments[0]._id).toBe(parentId);

      await api().delete(`/api/community/comments/${parentId}`).set('Authorization', `Bearer ${admin.token}`);
      const trash = await api().get('/api/admin/comments?status=deleted').set('Authorization', `Bearer ${admin.token}`);
      expect(trash.body.comments).toHaveLength(1);
      expect(trash.body.comments[0]._id).toBe(parentId);
      const active = await api().get('/api/admin/comments?status=active').set('Authorization', `Bearer ${admin.token}`);
      expect(active.body.comments.map((comment) => comment._id)).not.toContain(parentId);
    });

    it('edits a comment and records who edited it', async () => {
      const { admin, parentId } = await seedThread();
      const res = await api()
        .put(`/api/admin/comments/${parentId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'Cleaned up by staff' });
      expect(res.status).toBe(200);
      expect(res.body.comment.content).toBe('Cleaned up by staff');
      expect(res.body.comment.editedAt).toBeTruthy();
      expect(res.body.comment.editedBy).toBe(admin.user._id.toString());
    });

    it('rejects an empty comment edit', async () => {
      const { admin, parentId } = await seedThread();
      const res = await api()
        .put(`/api/admin/comments/${parentId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: '   ' });
      expect(res.status).toBe(400);
    });

    it('restores a deleted thread parent before its replies', async () => {
      const { admin, chapter, parentId, replyId } = await seedThread();
      await api().delete(`/api/community/comments/${parentId}`).set('Authorization', `Bearer ${admin.token}`);

      const tooEarly = await api()
        .post(`/api/admin/comments/${replyId}/restore`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(tooEarly.status).toBe(400);

      const parentRestored = await api()
        .post(`/api/admin/comments/${parentId}/restore`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(parentRestored.status).toBe(200);
      expect(parentRestored.body.comment.deletedAt).toBeNull();

      const replyRestored = await api()
        .post(`/api/admin/comments/${replyId}/restore`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(replyRestored.status).toBe(200);

      const publicList = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      expect(publicList.body.comments).toHaveLength(1);
      expect(publicList.body.comments[0].replies).toHaveLength(1);
    });

    it('lets an admin reply to a comment as staff', async () => {
      const { admin, chapter, parentId } = await seedThread();
      const res = await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'Staff response', parentComment: parentId });
      expect(res.status).toBe(201);

      const publicList = await api().get(`/api/community/chapters/${chapter._id}/comments`);
      const staffReply = publicList.body.comments[0].replies.find((reply) => reply.content === 'Staff response');
      expect(staffReply.user.role).toBe('admin');
    });
  });

  describe('review moderation', () => {
    const seedReview = async (rating = 5) => {
      const admin = await createAdmin();
      const author = await createUser({ username: 'reviewauthor' });
      const novel = await createNovel();
      const { body } = await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${author.token}`)
        .send({ rating, content: 'Solid read' });
      return { admin, author, novel, reviewId: body.review._id };
    };

    it('edits review content and rating, recalculating the novel average', async () => {
      const { admin, novel, reviewId } = await seedReview(5);
      const res = await api()
        .put(`/api/admin/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'Trimmed by staff', rating: 3 });
      expect(res.status).toBe(200);
      expect(res.body.review.content).toBe('Trimmed by staff');
      expect(res.body.review.rating).toBe(3);
      expect(res.body.review.editedBy).toBe(admin.user._id.toString());
      expect((await Novel.findById(novel._id)).ratingAvg).toBe(3);
    });

    it('rejects an out-of-range rating edit', async () => {
      const { admin, reviewId } = await seedReview();
      const res = await api()
        .put(`/api/admin/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ rating: 9 });
      expect(res.status).toBe(400);
    });

    it('restores a deleted review and its rating contribution', async () => {
      const { admin, novel, reviewId } = await seedReview(4);
      await api().delete(`/api/community/reviews/${reviewId}`).set('Authorization', `Bearer ${admin.token}`);
      expect((await Novel.findById(novel._id)).ratingAvg).toBe(0);

      const trash = await api().get('/api/admin/reviews?status=deleted').set('Authorization', `Bearer ${admin.token}`);
      expect(trash.body.reviews).toHaveLength(1);

      const restored = await api()
        .post(`/api/admin/reviews/${reviewId}/restore`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(restored.status).toBe(200);
      expect(restored.body.review.deletedAt).toBeNull();
      const updated = await Novel.findById(novel._id);
      expect(updated.ratingAvg).toBe(4);
      expect(updated.ratingCount).toBe(1);
    });

    it('restores a deleted review even if the author has another active review', async () => {
      const { admin, author, novel, reviewId } = await seedReview(4);
      await api().delete(`/api/community/reviews/${reviewId}`).set('Authorization', `Bearer ${admin.token}`);
      await api()
        .post(`/api/novels/id/${novel._id}/reviews`)
        .set('Authorization', `Bearer ${author.token}`)
        .send({ rating: 2 });

      const res = await api().post(`/api/admin/reviews/${reviewId}/restore`).set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect((await Novel.findById(novel._id)).ratingCount).toBe(2);
    });

    it('edits and restores a review reply', async () => {
      const { admin, novel, reviewId } = await seedReview();
      const replyRes = await api()
        .post(`/api/community/reviews/${reviewId}/replies`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'Staff reply' });
      const replyId = replyRes.body.review.replies[0]._id;

      const edited = await api()
        .put(`/api/admin/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'Staff reply, revised' });
      expect(edited.status).toBe(200);
      expect(edited.body.review.replies[0].content).toBe('Staff reply, revised');
      expect(edited.body.review.replies[0].editedAt).toBeTruthy();

      await api()
        .delete(`/api/community/reviews/${reviewId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      const publicList = await api().get(`/api/novels/id/${novel._id}/reviews`);
      expect(publicList.body.reviews[0].replies).toHaveLength(0);

      const adminList = await api().get('/api/admin/reviews').set('Authorization', `Bearer ${admin.token}`);
      expect(adminList.body.reviews[0].replies).toHaveLength(1);
      expect(adminList.body.reviews[0].replies[0].deletedAt).toBeTruthy();

      const restored = await api()
        .post(`/api/admin/reviews/${reviewId}/replies/${replyId}/restore`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(restored.status).toBe(200);
      const afterRestore = await api().get(`/api/novels/id/${novel._id}/reviews`);
      expect(afterRestore.body.reviews[0].replies).toHaveLength(1);
    });

    it('finds reviews by author name and reply content', async () => {
      const { admin, reviewId } = await seedReview();
      await api()
        .post(`/api/community/reviews/${reviewId}/replies`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ content: 'distinctive staff note' });

      const byAuthor = await api().get('/api/admin/reviews?search=reviewauthor').set('Authorization', `Bearer ${admin.token}`);
      expect(byAuthor.body.reviews).toHaveLength(1);

      const byReply = await api()
        .get('/api/admin/reviews?search=distinctive')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(byReply.body.reviews).toHaveLength(1);
    });

    it('rejects an edit that changes nothing', async () => {
      const { admin, reviewId } = await seedReview();
      const res = await api().put(`/api/admin/reviews/${reviewId}`).set('Authorization', `Bearer ${admin.token}`).send({});
      expect(res.status).toBe(400);
    });

    it('keeps novel attribution on records trashed by a novel deletion', async () => {
      const { token: adminToken } = await createAdmin();
      const { token: userToken } = await createUser();
      const novel = await createNovel();
      const chapter = await createChapter(novel);
      await api()
        .post(`/api/community/chapters/${chapter._id}/comments`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ content: 'about to be trashed' });
      await api().post(`/api/novels/id/${novel._id}/reviews`).set('Authorization', `Bearer ${userToken}`).send({ rating: 4 });
      await api().delete(`/api/admin/novels/${novel._id}`).set('Authorization', `Bearer ${adminToken}`);

      const comments = await api().get('/api/admin/comments?status=deleted').set('Authorization', `Bearer ${adminToken}`);
      expect(comments.body.comments).toHaveLength(1);
      expect(comments.body.comments[0].novel).not.toBeNull();
      expect(comments.body.comments[0].novel.title).toBe(novel.title);
      expect(comments.body.comments[0].chapter.number).toBe(chapter.number);

      const reviews = await api().get('/api/admin/reviews?status=deleted').set('Authorization', `Bearer ${adminToken}`);
      expect(reviews.body.reviews[0].novel.title).toBe(novel.title);
    });

    it('rejects moderation endpoints for non-admins', async () => {
      const { reviewId } = await seedReview();
      const { token } = await createUser();
      const edit = await api()
        .put(`/api/admin/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'nope' });
      expect(edit.status).toBe(403);
      const restore = await api().post(`/api/admin/reviews/${reviewId}/restore`).set('Authorization', `Bearer ${token}`);
      expect(restore.status).toBe(403);
    });
  });
});

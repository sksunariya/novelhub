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
        .field('siteName', 'Apex NovelHub')
        .field('announcement', 'Welcome!')
        .field('logoUrl', 'https://cdn.example.com/logo.png')
        .field('themeColors', JSON.stringify({ primary: '#ff0000' }));
      expect(res.status).toBe(200);
      expect(res.body.settings.siteName).toBe('Apex NovelHub');
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
});

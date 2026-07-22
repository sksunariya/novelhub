const { api, createNovel, createChapter, createUser } = require('./helpers');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');

describe('Novels', () => {
  describe('GET /api/novels', () => {
    it('lists published novels with pagination', async () => {
      await createNovel({ title: 'Alpha' });
      await createNovel({ title: 'Beta' });
      await createNovel({ title: 'Hidden', published: false });
      const res = await api().get('/api/novels');
      expect(res.status).toBe(200);
      expect(res.body.novels).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by search, genre and status', async () => {
      await createNovel({ title: 'Dragon Lord', genres: ['Fantasy'], status: 'completed' });
      await createNovel({ title: 'Space Odyssey', genres: ['Sci-Fi'] });
      const bySearch = await api().get('/api/novels?search=dragon');
      expect(bySearch.body.novels).toHaveLength(1);
      const byGenre = await api().get('/api/novels?genre=Sci-Fi');
      expect(byGenre.body.novels).toHaveLength(1);
      expect(byGenre.body.novels[0].title).toBe('Space Odyssey');
      const byStatus = await api().get('/api/novels?status=completed');
      expect(byStatus.body.novels).toHaveLength(1);
    });

    it('sorts by popularity', async () => {
      await createNovel({ title: 'Low', views: 5 });
      await createNovel({ title: 'High', views: 50 });
      const res = await api().get('/api/novels?sort=popular');
      expect(res.body.novels[0].title).toBe('High');
    });
  });

  describe('GET /api/novels/rankings', () => {
    it('returns trending ranking by weekly views', async () => {
      await createNovel({ title: 'Quiet', weeklyViews: 1 });
      await createNovel({ title: 'Hot', weeklyViews: 100 });
      const res = await api().get('/api/novels/rankings?type=trending');
      expect(res.status).toBe(200);
      expect(res.body.novels[0].title).toBe('Hot');
    });

    it('rejects invalid ranking type', async () => {
      const res = await api().get('/api/novels/rankings?type=bogus');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/novels/featured', () => {
    it('returns only featured novels', async () => {
      await createNovel({ title: 'Featured One', featured: true });
      await createNovel({ title: 'Normal' });
      const res = await api().get('/api/novels/featured');
      expect(res.body.novels).toHaveLength(1);
      expect(res.body.novels[0].title).toBe('Featured One');
    });
  });

  describe('GET /api/novels/genres', () => {
    it('returns distinct sorted genres', async () => {
      await createNovel({ genres: ['Fantasy', 'Action'] });
      await createNovel({ genres: ['Fantasy', 'Romance'] });
      const res = await api().get('/api/novels/genres');
      expect(res.body.genres).toEqual(['Action', 'Fantasy', 'Romance']);
    });
  });

  describe('GET /api/novels/:slug', () => {
    it('returns novel and increments views', async () => {
      const novel = await createNovel({ slug: 'my-novel' });
      const res = await api().get('/api/novels/my-novel');
      expect(res.status).toBe(200);
      expect(res.body.novel.title).toBe(novel.title);
      const second = await api().get('/api/novels/my-novel');
      expect(second.body.novel.views).toBe(1);
    });

    it('404s for unpublished novel', async () => {
      await createNovel({ slug: 'secret', published: false });
      const res = await api().get('/api/novels/secret');
      expect(res.status).toBe(404);
    });

    it('does not inflate views from repeated visits by the same anonymous viewer', async () => {
      const novel = await createNovel({ slug: 'repeat-view' });
      await api().get('/api/novels/repeat-view');
      await api().get('/api/novels/repeat-view');
      await api().get('/api/novels/repeat-view');
      const updated = await Novel.findById(novel._id);
      expect(updated.views).toBe(1);
    });

    it('counts views separately for distinct authenticated viewers', async () => {
      const novel = await createNovel({ slug: 'distinct-viewers' });
      const { token: token1 } = await createUser();
      const { token: token2 } = await createUser();
      await api().get('/api/novels/distinct-viewers').set('Authorization', `Bearer ${token1}`);
      await api().get('/api/novels/distinct-viewers').set('Authorization', `Bearer ${token2}`);
      const updated = await Novel.findById(novel._id);
      expect(updated.views).toBe(2);
    });
  });

  describe('GET /api/novels/:slug/chapters', () => {
    it('lists published chapters in order without content', async () => {
      const novel = await createNovel({ slug: 'chaptered' });
      await createChapter(novel, { number: 2, title: 'Second' });
      await createChapter(novel, { number: 1, title: 'First' });
      await createChapter(novel, { number: 3, title: 'Draft', published: false });
      const res = await api().get('/api/novels/chaptered/chapters');
      expect(res.body.chapters).toHaveLength(2);
      expect(res.body.chapters[0].number).toBe(1);
      expect(res.body.chapters[0].content).toBeUndefined();
    });
  });

  describe('GET /api/novels/:slug/chapters/:number', () => {
    it('returns chapter content with prev/next links', async () => {
      const novel = await createNovel({ slug: 'reader' });
      await createChapter(novel, { number: 1, title: 'One' });
      await createChapter(novel, { number: 2, title: 'Two' });
      await createChapter(novel, { number: 3, title: 'Three' });
      const res = await api().get('/api/novels/reader/chapters/2');
      expect(res.status).toBe(200);
      expect(res.body.chapter.title).toBe('Two');
      expect(res.body.prev.number).toBe(1);
      expect(res.body.next.number).toBe(3);
    });

    it('counts chapter reads towards novel views', async () => {
      const novel = await createNovel({ slug: 'counted' });
      await createChapter(novel, { number: 1 });
      await api().get('/api/novels/counted/chapters/1');
      const res = await api().get('/api/novels/counted');
      expect(res.body.novel.views).toBe(1);
      expect(res.body.novel.weeklyViews).toBe(1);
    });

    it('does not inflate chapter or novel views from repeated reads by the same viewer', async () => {
      const novel = await createNovel({ slug: 'repeat-chapter' });
      const chapter = await createChapter(novel, { number: 1 });
      await api().get('/api/novels/repeat-chapter/chapters/1');
      await api().get('/api/novels/repeat-chapter/chapters/1');
      await api().get('/api/novels/repeat-chapter/chapters/1');
      const updatedChapter = await Chapter.findById(chapter._id);
      const updatedNovel = await Novel.findById(novel._id);
      expect(updatedChapter.views).toBe(1);
      expect(updatedNovel.views).toBe(1);
      expect(updatedNovel.weeklyViews).toBe(1);
    });

    it('counts a chapter read from a different viewer as a new view', async () => {
      const novel = await createNovel({ slug: 'multi-viewer-chapter' });
      const chapter = await createChapter(novel, { number: 1 });
      const { token } = await createUser();
      await api().get('/api/novels/multi-viewer-chapter/chapters/1');
      await api().get('/api/novels/multi-viewer-chapter/chapters/1').set('Authorization', `Bearer ${token}`);
      const updatedChapter = await Chapter.findById(chapter._id);
      expect(updatedChapter.views).toBe(2);
    });

    it('saves reading progress for authenticated readers', async () => {
      const { token } = await createUser();
      const novel = await createNovel({ slug: 'tracked' });
      await createChapter(novel, { number: 1 });
      await api().get('/api/novels/tracked/chapters/1').set('Authorization', `Bearer ${token}`);
      const history = await api().get('/api/library/history/list').set('Authorization', `Bearer ${token}`);
      expect(history.body.history).toHaveLength(1);
      expect(history.body.history[0].chapterNumber).toBe(1);
    });

    it('404s for missing chapter', async () => {
      const novel = await createNovel({ slug: 'empty' });
      const res = await api().get(`/api/novels/${novel.slug}/chapters/99`);
      expect(res.status).toBe(404);
    });
  });
});

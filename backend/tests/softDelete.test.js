const { api, createAdmin, createUser, createNovel, createChapter } = require('./helpers');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');
const Comment = require('../src/models/Comment');
const Review = require('../src/models/Review');

// Query the trash: bypass the soft-delete filter to see everything in the DB.
const withDeleted = (query) => query.setOptions({ withDeleted: true });

describe('Soft delete', () => {
  it('soft-deletes a novel and cascades, hiding records from reads but keeping them in the database', async () => {
    const { token } = await createAdmin();
    const { user } = await createUser();
    const novel = await createNovel();
    const chapter = await createChapter(novel);
    await Comment.create({ chapter: chapter._id, novel: novel._id, user: user._id, content: 'nice chapter' });
    await Review.create({ novel: novel._id, user: user._id, rating: 5 });

    const del = await api().delete(`/api/admin/novels/${novel._id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    // Hidden from normal reads (same queries the app's endpoints use)
    expect(await Novel.findById(novel._id)).toBeNull();
    expect(await Chapter.countDocuments({ novel: novel._id })).toBe(0);
    expect(await Comment.countDocuments({ novel: novel._id })).toBe(0);
    expect(await Review.countDocuments({ novel: novel._id })).toBe(0);

    // Still present in the database, just flagged with deletedAt
    const raw = await withDeleted(Novel.findById(novel._id));
    expect(raw).not.toBeNull();
    expect(raw.deletedAt).toBeInstanceOf(Date);
    expect(await withDeleted(Chapter.countDocuments({ novel: novel._id }))).toBe(1);
    expect(await withDeleted(Comment.countDocuments({ novel: novel._id }))).toBe(1);
    expect(await withDeleted(Review.countDocuments({ novel: novel._id }))).toBe(1);
  });

  it('soft-deletes a comment via the API — hidden from listings, row preserved', async () => {
    const { user, token } = await createUser();
    const novel = await createNovel();
    const chapter = await createChapter(novel);
    const comment = await Comment.create({ chapter: chapter._id, novel: novel._id, user: user._id, content: 'hi' });

    const del = await api().delete(`/api/community/comments/${comment._id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    expect(await Comment.findById(comment._id)).toBeNull();
    const raw = await withDeleted(Comment.findById(comment._id));
    expect(raw.deletedAt).toBeInstanceOf(Date);
  });

  it('enforces unique keys only among active records (partial indexes)', async () => {
    await Promise.all([Novel.syncIndexes(), Chapter.syncIndexes()]);
    const novel = await createNovel({ slug: 'reuse-me' });

    // Duplicate slug / chapter number rejected while the originals are active
    await expect(createNovel({ slug: 'reuse-me' })).rejects.toThrow();
    const chapter = await createChapter(novel, { number: 1 });
    await expect(createChapter(novel, { number: 1 })).rejects.toThrow();

    // After soft delete, the same slug and chapter number become reusable
    await chapter.softDelete();
    const reChapter = await createChapter(novel, { number: 1 });
    expect(reChapter.number).toBe(1);

    await novel.softDelete();
    const reNovel = await createNovel({ slug: 'reuse-me' });
    expect(reNovel.slug).toBe('reuse-me');
  });
});

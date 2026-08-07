const { api, createUser, createAdmin, createNovel, createChapter } = require('./helpers');
const SiteSettings = require('../src/models/SiteSettings');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');
const { GATE_RECURRENCE, GATE_REQUIREMENTS, GATE_REASONS } = require('../src/config/constants');

const setSiteGate = async (patch) => {
  const settings = await SiteSettings.getSettings();
  settings.readingGate = { ...settings.readingGate.toObject(), ...patch };
  await settings.save();
};

const setNovelGate = (novel, patch) =>
  Novel.updateOne({ _id: novel._id }, { readingGate: { override: true, ...patch } });

const read = (slug, number, token) => {
  const request = api().get(`/api/novels/${slug}/chapters/${number}`);
  return token ? request.set('Authorization', `Bearer ${token}`) : request;
};

const comment = (chapterId, token, content) =>
  api().post(`/api/community/chapters/${chapterId}/comments`).set('Authorization', `Bearer ${token}`).send({ content });

const reviewNovel = (novelId, token, rating) =>
  api().post(`/api/novels/id/${novelId}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating });

const reviewChapter = (chapterId, token, rating) =>
  api().post(`/api/community/chapters/${chapterId}/reviews`).set('Authorization', `Bearer ${token}`).send({ rating });

const seedNovel = async (chapterCount) => {
  const novel = await createNovel();
  const chapters = [];
  for (let number = 1; number <= chapterCount; number += 1) {
    chapters.push(await createChapter(novel, { number, title: `Chapter ${number}` }));
  }
  return { novel, chapters };
};

describe('Reading gate', () => {
  it('lets anyone read every chapter while the gate is off', async () => {
    const { novel } = await seedNovel(2);
    const res = await read(novel.slug, 2);
    expect(res.status).toBe(200);
    expect(res.body.chapter.content).toBeDefined();
    expect(res.body.gate).toEqual({ locked: false, nextCheckpoint: 0 });
  });

  describe('login gate', () => {
    beforeEach(() => setSiteGate({ loginEnabled: true, loginAfterChapter: 2 }));

    it('serves the free run to anonymous readers', async () => {
      const { novel } = await seedNovel(3);
      const res = await read(novel.slug, 2);
      expect(res.status).toBe(200);
      expect(res.body.chapter.content).toBeDefined();
    });

    it('withholds content past the free run and names the reason', async () => {
      const { novel } = await seedNovel(3);
      const res = await read(novel.slug, 3);
      expect(res.status).toBe(403);
      expect(res.body.gate.reason).toBe(GATE_REASONS.LOGIN);
      expect(res.body.chapter).toMatchObject({ number: 3, title: 'Chapter 3' });
      expect(res.body.chapter.id).toBeDefined();
      expect(res.body.chapter.content).toBeUndefined();
      expect(res.body.novel.slug).toBe(novel.slug);
      expect(res.body.prev.number).toBe(2);
    });

    it('does not count a blocked read as a view', async () => {
      const { novel, chapters } = await seedNovel(3);
      await read(novel.slug, 3);
      expect((await Chapter.findById(chapters[2]._id)).views).toBe(0);
      expect((await Novel.findById(novel._id)).views).toBe(0);
    });

    it('lets a signed-in reader through', async () => {
      const { token } = await createUser();
      const { novel } = await seedNovel(3);
      const res = await read(novel.slug, 3, token);
      expect(res.status).toBe(200);
      expect(res.body.chapter.content).toBeDefined();
    });
  });

  describe('engagement gate', () => {
    it('asks an anonymous reader to log in first, listing what comes next', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 1,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
      });
      const { novel } = await seedNovel(2);
      const res = await read(novel.slug, 2);
      expect(res.status).toBe(403);
      expect(res.body.gate.reason).toBe(GATE_REASONS.LOGIN);
      expect(res.body.gate.requirements).toEqual([{ key: GATE_REQUIREMENTS.NOVEL_COMMENT, satisfied: false }]);
    });

    it('unlocks once every requirement is met', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 1,
        recurrence: GATE_RECURRENCE.ONCE,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT, GATE_REQUIREMENTS.NOVEL_REVIEW],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(3);

      const blocked = await read(novel.slug, 2, token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.gate.reason).toBe(GATE_REASONS.ENGAGEMENT);
      expect(blocked.body.gate.checkpoint.number).toBe(2);

      await comment(chapters[0]._id, token, 'Enjoying this so far');
      const halfway = await read(novel.slug, 2, token);
      expect(halfway.status).toBe(403);
      expect(halfway.body.gate.requirements).toEqual([
        { key: GATE_REQUIREMENTS.NOVEL_COMMENT, satisfied: true },
        { key: GATE_REQUIREMENTS.NOVEL_REVIEW, satisfied: false },
      ]);

      await reviewNovel(novel._id, token, 5);
      const unlocked = await read(novel.slug, 2, token);
      expect(unlocked.status).toBe(200);
      expect(unlocked.body.chapter.content).toBeDefined();
    });

    it('stays unlocked for later chapters when asking once', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 1,
        recurrence: GATE_RECURRENCE.ONCE,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(5);
      await comment(chapters[0]._id, token, 'One comment is enough');
      expect((await read(novel.slug, 5, token)).status).toBe(200);
    });

    it('asks again on every chapter when set to always', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 1,
        recurrence: GATE_RECURRENCE.ALL,
        requirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(3);

      await comment(chapters[1]._id, token, 'Thoughts on chapter 2');
      expect((await read(novel.slug, 2, token)).status).toBe(200);
      expect((await read(novel.slug, 3, token)).status).toBe(403);

      await comment(chapters[2]._id, token, 'Thoughts on chapter 3');
      expect((await read(novel.slug, 3, token)).status).toBe(200);
    });

    it('bills a chapter requirement to the checkpoint, not the chapter being opened', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 10,
        recurrence: GATE_RECURRENCE.EVERY,
        everyChapters: 10,
        requirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(15);

      const blocked = await read(novel.slug, 15, token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.gate.checkpoint.number).toBe(11);

      // Commenting on chapter 15 does not pay the toll for checkpoint 11.
      await comment(chapters[14]._id, token, 'Wrong chapter');
      expect((await read(novel.slug, 15, token)).status).toBe(403);

      await comment(chapters[10]._id, token, 'Right chapter');
      expect((await read(novel.slug, 15, token)).status).toBe(200);
    });

    it('gates only the chapter numbers the admin listed', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 0,
        recurrence: GATE_RECURRENCE.CHAPTERS,
        chapterNumbers: [3],
        requirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(4);

      expect((await read(novel.slug, 2, token)).status).toBe(200);
      expect((await read(novel.slug, 3, token)).status).toBe(403);
      expect((await read(novel.slug, 4, token)).status).toBe(403);

      await comment(chapters[2]._id, token, 'Paying at chapter 3');
      expect((await read(novel.slug, 4, token)).status).toBe(200);
    });

    it('switches to the stricter requirement set past the escalation chapter', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 0,
        recurrence: GATE_RECURRENCE.ALL,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
        escalateAfterChapter: 2,
        escalatedRequirements: [GATE_REQUIREMENTS.CHAPTER_REVIEW],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(3);

      await comment(chapters[0]._id, token, 'A novel-level comment');
      expect((await read(novel.slug, 2, token)).status).toBe(200);

      const escalated = await read(novel.slug, 3, token);
      expect(escalated.status).toBe(403);
      expect(escalated.body.gate.requirements).toEqual([
        { key: GATE_REQUIREMENTS.CHAPTER_REVIEW, satisfied: false },
      ]);

      await reviewChapter(chapters[2]._id, token, 4);
      expect((await read(novel.slug, 3, token)).status).toBe(200);
    });

    it('escalates even when there is only one checkpoint', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 1,
        recurrence: GATE_RECURRENCE.ONCE,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
        escalateAfterChapter: 3,
        escalatedRequirements: [GATE_REQUIREMENTS.NOVEL_REVIEW],
      });
      const { token } = await createUser();
      const { novel, chapters } = await seedNovel(5);

      await comment(chapters[0]._id, token, 'Base requirement met');
      expect((await read(novel.slug, 3, token)).status).toBe(200);

      const escalated = await read(novel.slug, 4, token);
      expect(escalated.status).toBe(403);
      expect(escalated.body.gate.requirements).toEqual([
        { key: GATE_REQUIREMENTS.NOVEL_REVIEW, satisfied: false },
      ]);

      await reviewNovel(novel._id, token, 4);
      expect((await read(novel.slug, 4, token)).status).toBe(200);
    });

    it('ignores an enabled gate that requires nothing', async () => {
      await setSiteGate({ engagementEnabled: true, engagementAfterChapter: 0, requirements: [] });
      const { novel } = await seedNovel(2);
      expect((await read(novel.slug, 2)).status).toBe(200);
    });

    it('reports the next checkpoint on an unlocked read', async () => {
      await setSiteGate({
        engagementEnabled: true,
        engagementAfterChapter: 10,
        recurrence: GATE_RECURRENCE.EVERY,
        everyChapters: 10,
        requirements: [GATE_REQUIREMENTS.NOVEL_COMMENT],
      });
      const { novel } = await seedNovel(5);
      const res = await read(novel.slug, 5);
      expect(res.status).toBe(200);
      expect(res.body.gate.nextCheckpoint).toBe(11);
    });
  });

  describe('per-novel override', () => {
    it('replaces the site gate when the novel opts in', async () => {
      await setSiteGate({ loginEnabled: true, loginAfterChapter: 0 });
      const { novel } = await seedNovel(2);
      expect((await read(novel.slug, 1)).status).toBe(403);

      await setNovelGate(novel, { loginEnabled: false, engagementEnabled: false });
      expect((await read(novel.slug, 1)).status).toBe(200);
    });

    it('is ignored while override is off', async () => {
      await setSiteGate({ loginEnabled: false });
      const { novel } = await seedNovel(2);
      await Novel.updateOne({ _id: novel._id }, { readingGate: { override: false, loginEnabled: true, loginAfterChapter: 0 } });
      expect((await read(novel.slug, 1)).status).toBe(200);
    });
  });

  describe('admin configuration', () => {
    it('stores the gate from the settings form, coercing numbers and chapter lists', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${token}`)
        .field(
          'readingGate',
          JSON.stringify({
            loginEnabled: 'true',
            loginAfterChapter: '4',
            engagementEnabled: 'true',
            engagementAfterChapter: '6',
            recurrence: GATE_RECURRENCE.CHAPTERS,
            chapterNumbers: '7, 14, oops, 21',
            requirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
          })
        );
      expect(res.status).toBe(200);
      expect(res.body.settings.readingGate).toMatchObject({
        loginEnabled: true,
        loginAfterChapter: 4,
        engagementEnabled: true,
        engagementAfterChapter: 6,
        recurrence: GATE_RECURRENCE.CHAPTERS,
        chapterNumbers: [7, 14, 21],
        requirements: [GATE_REQUIREMENTS.CHAPTER_COMMENT],
      });
      const publicSettings = await api().get('/api/settings');
      expect(publicSettings.body.settings.readingGate.loginAfterChapter).toBe(4);
    });

    it('rejects malformed gate JSON as a bad request', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${token}`)
        .field('readingGate', '{"loginEnabled":true');
      expect(res.status).toBe(400);
    });

    it('falls back to the default interval when everyChapters is blank', async () => {
      const { token } = await createAdmin();
      const res = await api()
        .put('/api/admin/settings')
        .set('Authorization', `Bearer ${token}`)
        .field('readingGate', JSON.stringify({ recurrence: GATE_RECURRENCE.EVERY, everyChapters: '' }));
      expect(res.status).toBe(200);
      expect(res.body.settings.readingGate.everyChapters).toBeGreaterThanOrEqual(1);
    });

    it('stores a per-novel override from the novel form', async () => {
      const { token } = await createAdmin();
      const novel = await createNovel();
      const res = await api()
        .put(`/api/admin/novels/${novel._id}`)
        .set('Authorization', `Bearer ${token}`)
        .field('readingGate', JSON.stringify({ override: 'true', engagementEnabled: 'true', engagementAfterChapter: '2' }));
      expect(res.status).toBe(200);
      expect(res.body.novel.readingGate).toMatchObject({
        override: true,
        engagementEnabled: true,
        engagementAfterChapter: 2,
      });
    });
  });
});

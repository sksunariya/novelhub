const { api, createAdmin, createNovel } = require('./helpers');
const CarouselSlide = require('../src/models/CarouselSlide');

describe('Carousel API', () => {
  it('returns public slides with dynamic fallback when no custom slides exist', async () => {
    const novel = await createNovel({ title: 'Dynamic Novel Hero', featured: true });
    const res = await api().get('/api/carousel');

    expect(res.status).toBe(200);
    expect(res.body.slides).toBeDefined();
    expect(res.body.slides.length).toBeGreaterThan(0);
    expect(res.body.slides[0].title).toBe('Dynamic Novel Hero');
  });

  it('allows admin to create, list, reorder, update, and delete custom carousel slides', async () => {
    const { token: adminToken } = await createAdmin();
    const novel = await createNovel({ title: 'Linked Novel' });

    // 1. Create slide
    const createRes = await api()
      .post('/api/admin/carousel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Custom Hero Slide 1',
        subtitle: 'Special Launch',
        description: 'Check out our new release',
        badgeText: 'HOT',
        badgeColor: 'crimson',
        primaryButtonText: 'Read Now',
        primaryButtonUrl: '/browse',
        novelId: novel._id,
        autoSyncWithNovel: true,
        themeStyle: 'dark-violet',
        isActive: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.title).toBe('Custom Hero Slide 1');

    const slide1Id = createRes.body._id;

    // Create 2nd slide
    const create2Res = await api()
      .post('/api/admin/carousel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Custom Hero Slide 2',
        themeStyle: 'dark-gold',
        isActive: true,
      });
    expect(create2Res.status).toBe(201);
    const slide2Id = create2Res.body._id;

    // 2. Fetch admin slides
    const adminList = await api()
      .get('/api/admin/carousel')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.length).toBe(2);

    // 3. Public GET returns custom slide formatted with novel sync
    const publicRes = await api().get('/api/carousel');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.slides[0].title).toBe('Custom Hero Slide 1');
    expect(publicRes.body.slides[0].novelSlug).toBe(novel.slug);

    // 4. Reorder slides
    const reorderRes = await api()
      .put('/api/admin/carousel/reorder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slideIds: [slide2Id, slide1Id] });
    expect(reorderRes.status).toBe(200);

    // 5. Update slide
    const updateRes = await api()
      .put(`/api/admin/carousel/${slide1Id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Updated Slide Title' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.title).toBe('Updated Slide Title');

    // 6. Delete slide
    const deleteRes = await api()
      .delete(`/api/admin/carousel/${slide1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const checkList = await api()
      .get('/api/admin/carousel')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(checkList.body.length).toBe(1);
  });

  it('updates global carousel settings via admin settings endpoint', async () => {
    const { token: adminToken } = await createAdmin();

    const setRes = await api()
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        carouselMode: 'custom_only',
        carouselAutoPlayInterval: 10,
        enableCarouselAutoPlay: false,
      });

    expect(setRes.status).toBe(200);
    expect(setRes.body.settings.carouselMode).toBe('custom_only');
    expect(setRes.body.settings.carouselAutoPlayInterval).toBe(10);
    expect(setRes.body.settings.enableCarouselAutoPlay).toBe(false);

    const publicRes = await api().get('/api/carousel');
    expect(publicRes.body.settings.autoPlayInterval).toBe(10);
    expect(publicRes.body.settings.enableAutoPlay).toBe(false);
  });
});

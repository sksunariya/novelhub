const { api, createUser, createAdmin, createNovel } = require('./helpers');

describe('Library and notifications', () => {
  describe('library', () => {
    it('toggles a novel in and out of the library', async () => {
      const { token } = await createUser();
      const novel = await createNovel();
      const add = await api().post(`/api/library/${novel._id}`).set('Authorization', `Bearer ${token}`);
      expect(add.body.inLibrary).toBe(true);
      const list = await api().get('/api/library').set('Authorization', `Bearer ${token}`);
      expect(list.body.novels).toHaveLength(1);
      const remove = await api().post(`/api/library/${novel._id}`).set('Authorization', `Bearer ${token}`);
      expect(remove.body.inLibrary).toBe(false);
      const emptied = await api().get('/api/library').set('Authorization', `Bearer ${token}`);
      expect(emptied.body.novels).toHaveLength(0);
    });

    it('requires authentication', async () => {
      const res = await api().get('/api/library');
      expect(res.status).toBe(401);
    });
  });

  describe('notifications', () => {
    it('notifies library users when a chapter is published', async () => {
      const { token: userToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const novel = await createNovel();
      await api().post(`/api/library/${novel._id}`).set('Authorization', `Bearer ${userToken}`);
      await api()
        .post(`/api/admin/novels/${novel._id}/chapters`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'New Chapter', content: '<p>text</p>' });
      const res = await api().get('/api/library/notifications/list').set('Authorization', `Bearer ${userToken}`);
      expect(res.body.unreadCount).toBe(1);
      expect(res.body.notifications[0].type).toBe('new_chapter');
    });

    it('marks notifications as read', async () => {
      const { token: userToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const novel = await createNovel();
      await api().post(`/api/library/${novel._id}`).set('Authorization', `Bearer ${userToken}`);
      await api()
        .post(`/api/admin/novels/${novel._id}/chapters`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Ch', content: '<p>t</p>' });
      await api().put('/api/library/notifications/read').set('Authorization', `Bearer ${userToken}`).send({});
      const res = await api().get('/api/library/notifications/list').set('Authorization', `Bearer ${userToken}`);
      expect(res.body.unreadCount).toBe(0);
    });

    it('broadcasts announcements to all users', async () => {
      const { token: userToken } = await createUser();
      const { token: adminToken } = await createAdmin();
      const res = await api()
        .post('/api/admin/announcements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'Site update tonight' });
      expect(res.status).toBe(201);
      expect(res.body.notifiedCount).toBe(2);
      const list = await api().get('/api/library/notifications/list').set('Authorization', `Bearer ${userToken}`);
      expect(list.body.notifications[0].type).toBe('announcement');
    });
  });
});

const scheduler = require('../src/services/schedulerService');
const settingsService = require('../src/services/settingsService');
const JobLock = require('../src/models/JobLock');
const JobRun = require('../src/models/JobRun');
const Novel = require('../src/models/Novel');
const Order = require('../src/models/Order');
const { JOBS, trendingReset } = require('../src/jobs');
const { api, createAdmin, createNovel } = require('./helpers');
const { ORDER_STATUS } = require('../src/config/constants');

beforeEach(() => {
  settingsService.clearCache();
  scheduler.registry.clear();
});

describe('job locking', () => {
  it('lets exactly one caller hold a lock', async () => {
    const first = await JobLock.acquire('demo', 60000, 'instance-a');
    const second = await JobLock.acquire('demo', 60000, 'instance-b');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('produces one winner when instances race', async () => {
    const results = await Promise.all(
      ['a', 'b', 'c', 'd'].map((id) => JobLock.acquire('race', 60000, id))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('lets another instance take over an expired lock', async () => {
    await JobLock.acquire('stale', -1000, 'instance-a'); // already expired
    const taken = await JobLock.acquire('stale', 60000, 'instance-b');
    expect(taken).not.toBeNull();
    expect(taken.owner).toBe('instance-b');
  });

  it('frees the lock on release', async () => {
    await JobLock.acquire('freeme', 60000, 'instance-a');
    expect(await JobLock.acquire('freeme', 60000, 'instance-b')).toBeNull();
    await JobLock.release('freeme', 'instance-a');
    expect(await JobLock.acquire('freeme', 60000, 'instance-b')).not.toBeNull();
  });

  it('will not let a different owner release a held lock', async () => {
    await JobLock.acquire('mine', 60000, 'instance-a');
    await JobLock.release('mine', 'instance-b');
    expect(await JobLock.acquire('mine', 60000, 'instance-c')).toBeNull();
  });
});

describe('running jobs', () => {
  it('records a successful run', async () => {
    scheduler.register({ name: 'ok', label: 'OK', run: async () => ({ did: 'work' }) });
    const result = await scheduler.runJob('ok', { trigger: 'manual' });

    expect(result.ran).toBe(true);
    const run = await JobRun.findOne({ job: 'ok' });
    expect(run.status).toBe('success');
    expect(run.result.did).toBe('work');
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failure without throwing', async () => {
    scheduler.register({
      name: 'boom',
      run: async () => {
        throw new Error('kaboom');
      },
    });
    const result = await scheduler.runJob('boom');
    expect(result.error).toBe('kaboom');
    const run = await JobRun.findOne({ job: 'boom' });
    expect(run.status).toBe('failed');
    expect(run.error).toBe('kaboom');
  });

  it('marks a self-skipped job as skipped', async () => {
    scheduler.register({ name: 'skippy', run: async () => ({ skipped: true, reason: 'disabled' }) });
    await scheduler.runJob('skippy');
    expect((await JobRun.findOne({ job: 'skippy' })).status).toBe('skipped');
  });

  it('releases the lock so the job can run again', async () => {
    scheduler.register({ name: 'twice', run: async () => ({ ok: true }) });
    await scheduler.runJob('twice');
    const second = await scheduler.runJob('twice');
    expect(second.ran).toBe(true);
    expect(await JobRun.countDocuments({ job: 'twice' })).toBe(2);
  });

  it('rejects an unknown job', async () => {
    await expect(scheduler.runJob('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('skips when another instance holds the lock', async () => {
    scheduler.register({ name: 'held', run: async () => ({ ok: true }) });
    await JobLock.acquire('held', 60000, 'someone-else');
    const result = await scheduler.runJob('held');
    expect(result.skipped).toBe(true);
    expect(await JobRun.countDocuments({ job: 'held' })).toBe(0);
  });

  it('steals the lock when forced', async () => {
    scheduler.register({ name: 'forced', run: async () => ({ ok: true }) });
    await JobLock.acquire('forced', 60000, 'someone-else');
    const result = await scheduler.runJob('forced', { force: true });
    expect(result.ran).toBe(true);
  });
});

describe('tick', () => {
  it('runs only the jobs whose cron matches', async () => {
    const ran = [];
    scheduler.register({ name: 'match', schedule: '0 3 * * *', run: async () => ran.push('match') });
    scheduler.register({ name: 'nomatch', schedule: '0 5 * * *', run: async () => ran.push('nomatch') });

    await scheduler.tick(new Date('2026-08-08T03:00:00'));
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(ran).toEqual(['match']);
  });

  it('uses the admin-configured schedule when a job declares one', async () => {
    await settingsService.update({ 'ranking.trendingResetCron': '0 9 * * *' });
    settingsService.clearCache();

    const ran = [];
    scheduler.register({ ...trendingReset, run: async () => ran.push('reset') });

    await scheduler.tick(new Date('2026-08-08T04:00:00')); // the default 04:00
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ran).toHaveLength(0);

    await scheduler.tick(new Date('2026-08-08T09:00:00')); // the configured 09:00
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ran).toEqual(['reset']);
  });

  it('falls back to the static schedule when the configured cron is invalid', async () => {
    await settingsService.update({ 'ranking.trendingResetCron': '0 4 * * 1' });
    settingsService.clearCache();
    const ran = [];
    scheduler.register({ ...trendingReset, run: async () => ran.push('reset') });
    // 2026-08-10 is a Monday.
    await scheduler.tick(new Date('2026-08-10T04:00:00'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ran).toEqual(['reset']);
  });
});

describe('the jobs themselves', () => {
  it('trending reset zeroes the rolling counter', async () => {
    // This job not existing is why trending has been identical to all-time
    // popular: weeklyViews was incremented and never reset.
    await createNovel({ slug: 'hot', weeklyViews: 500 });
    await createNovel({ slug: 'cold', weeklyViews: 0 });

    const result = await trendingReset.run();
    expect(result.novelsReset).toBe(1);
    expect((await Novel.findOne({ slug: 'hot' })).weeklyViews).toBe(0);
  });

  it('order expiry closes out stale price locks', async () => {
    const { expireOrders } = require('../src/jobs');
    const { user } = await createAdmin();
    await Order.create({
      orderNumber: 'NH-2026-0000001',
      user: user._id,
      credits: 100,
      totalCredits: 100,
      baseUsdCents: 999,
      netUsdCents: 999,
      chargeCurrency: 'USD',
      chargeAmountMinor: 999,
      status: ORDER_STATUS.CREATED,
      quoteExpiresAt: new Date(Date.now() - 1000),
    });
    const result = await expireOrders.run();
    expect(result.expired).toBe(1);
  });

  it('credit expiry does nothing while expiry is switched off', async () => {
    const { expireCredits } = require('../src/jobs');
    const result = await expireCredits.run();
    expect(result.skipped).toBe(true);
  });

  it('every shipped job declares a valid schedule', async () => {
    const { isValidCron } = require('../src/utils/cron');
    for (const job of JOBS) {
      const schedule = job.schedule || (job.scheduleKey ? await settingsService.get(job.scheduleKey) : null);
      expect(typeof job.run).toBe('function');
      expect(isValidCron(schedule)).toBe(true);
    }
  });
});

describe('admin job routes', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await createAdmin());
    JOBS.forEach((job) => scheduler.register(job));
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  it('lists jobs with their schedule and next run', async () => {
    const res = await auth(api().get('/api/admin/jobs')).expect(200);
    const reset = res.body.jobs.find((job) => job.name === 'trending.reset');
    expect(reset.schedule).toBe('0 4 * * 1');
    expect(reset.nextRun).toBeTruthy();
    expect(reset.scheduleKey).toBe('ranking.trendingResetCron');
  });

  it('triggers a job manually', async () => {
    await createNovel({ slug: 'trending-one', weeklyViews: 10 });
    const res = await auth(api().post('/api/admin/jobs/trending.reset/run')).expect(200);
    expect(res.body.ran).toBe(true);
    expect((await Novel.findOne({ slug: 'trending-one' })).weeklyViews).toBe(0);
  });

  it('404s an unknown job', async () => {
    await auth(api().post('/api/admin/jobs/not.a.job/run')).expect(404);
  });

  it('returns run history', async () => {
    await auth(api().post('/api/admin/jobs/trending.reset/run')).expect(200);
    const res = await auth(api().get('/api/admin/jobs/runs?job=trending.reset')).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.runs[0].trigger).toBe('manual');
    expect(res.body.runs[0].triggeredBy.username).toBeDefined();
  });

  it('requires an admin', async () => {
    await api().get('/api/admin/jobs').expect(401);
  });
});

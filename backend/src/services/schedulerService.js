// Job scheduler.
//
// Ticks once a minute, asks each registered job whether its cron matches, and
// runs the ones that do — but only after winning a database lock, so a single
// job fires once across the whole fleet rather than once per instance.
//
// Schedules come from the settings registry where a job declares a
// `scheduleKey`, so an admin can change a cadence without a deploy.

const crypto = require('crypto');
const JobLock = require('../models/JobLock');
const JobRun = require('../models/JobRun');
const settingsService = require('./settingsService');
const { matches, isValidCron, nextRun } = require('../utils/cron');
const { JOBS } = require('../jobs');

const TICK_MS = 60 * 1000;
const INSTANCE_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

const registry = new Map();
let timer = null;
let running = false;
const inFlight = new Set();

const register = (job) => {
  if (!job.name || typeof job.run !== 'function') throw new Error('A job needs a name and a run function');
  registry.set(job.name, job);
};

/** A job's cron: admin-configured when it declares a scheduleKey, else static. */
const scheduleFor = async (job) => {
  if (!job.scheduleKey) return job.schedule;
  try {
    const configured = await settingsService.get(job.scheduleKey);
    return isValidCron(configured) ? configured : job.schedule;
  } catch (error) {
    return job.schedule;
  }
};

/**
 * Run one job now.
 *
 * Lock acquisition is what makes this safe to call from every instance
 * simultaneously; the loser simply records nothing and returns.
 */
const runJob = async (name, { trigger = 'schedule', triggeredBy = null, force = false } = {}) => {
  const job = registry.get(name);
  if (!job) throw Object.assign(new Error(`Unknown job: ${name}`), { status: 404 });

  // Guard against a slow job overlapping itself within this process.
  if (inFlight.has(name)) return { skipped: true, reason: 'already running in this instance' };

  const ttl = job.ttlMs || 10 * 60 * 1000;
  const lock = force
    ? await JobLock.findOneAndUpdate(
        { _id: name },
        { $set: { lockedUntil: new Date(Date.now() + ttl), owner: INSTANCE_ID, acquiredAt: new Date() } },
        { new: true, upsert: true }
      )
    : await JobLock.acquire(name, ttl, INSTANCE_ID);

  if (!lock) return { skipped: true, reason: 'another instance holds the lock' };

  inFlight.add(name);
  const startedAt = new Date();
  const record = await JobRun.create({
    job: name,
    status: 'running',
    trigger,
    startedAt,
    owner: INSTANCE_ID,
    triggeredBy,
  });

  try {
    const result = await job.run();
    const finishedAt = new Date();
    record.status = result && result.skipped ? 'skipped' : 'success';
    record.result = result || {};
    record.finishedAt = finishedAt;
    record.durationMs = finishedAt - startedAt;
    await record.save();
    return { ran: true, result };
  } catch (error) {
    const finishedAt = new Date();
    record.status = 'failed';
    record.error = error.message;
    record.finishedAt = finishedAt;
    record.durationMs = finishedAt - startedAt;
    await record.save();
    console.error(`[scheduler] ${name} failed:`, error.message);
    return { ran: true, error: error.message };
  } finally {
    inFlight.delete(name);
    await JobLock.release(name, INSTANCE_ID).catch(() => {});
  }
};

const tick = async (now = new Date()) => {
  for (const job of registry.values()) {
    const schedule = await scheduleFor(job);
    if (!schedule || !isValidCron(schedule)) continue;
    if (!matches(schedule, now)) continue;
    // Deliberately not awaited: one slow job must not delay the others past
    // their minute.
    runJob(job.name, { trigger: 'schedule' }).catch((error) =>
      console.error(`[scheduler] ${job.name} threw:`, error.message)
    );
  }
};

/** Align the first tick to the top of the next minute so cron lands on time. */
const start = () => {
  if (running) return;
  JOBS.forEach(register);
  running = true;

  const msToNextMinute = 60000 - (Date.now() % 60000);
  setTimeout(() => {
    if (!running) return;
    tick().catch((error) => console.error('[scheduler] tick failed:', error.message));
    timer = setInterval(() => {
      tick().catch((error) => console.error('[scheduler] tick failed:', error.message));
    }, TICK_MS);
    if (timer.unref) timer.unref();
  }, msToNextMinute).unref?.();

  console.info(`[scheduler] started with ${registry.size} job(s), instance ${INSTANCE_ID}`);
};

const stop = async () => {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  // Let anything mid-run finish before the process exits.
  const deadline = Date.now() + 15000;
  while (inFlight.size && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** Status for the admin System → Jobs page. */
const status = async () => {
  const jobs = [];
  for (const job of registry.size ? registry.values() : JOBS) {
    const schedule = await scheduleFor(job);
    const [last, lock] = await Promise.all([
      JobRun.findOne({ job: job.name }).sort({ startedAt: -1 }),
      JobLock.findById(job.name),
    ]);
    jobs.push({
      name: job.name,
      label: job.label,
      schedule,
      scheduleKey: job.scheduleKey || null,
      nextRun: schedule && isValidCron(schedule) ? nextRun(schedule) : null,
      locked: Boolean(lock && lock.lockedUntil > new Date()),
      lastRun: last
        ? {
            status: last.status,
            startedAt: last.startedAt,
            durationMs: last.durationMs,
            result: last.result,
            error: last.error,
          }
        : null,
    });
  }
  return { instance: INSTANCE_ID, running, jobs };
};

module.exports = { start, stop, tick, runJob, register, status, registry, INSTANCE_ID };

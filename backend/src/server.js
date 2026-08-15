require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const scheduler = require('./services/schedulerService');
const counterService = require('./services/counterService');
const jobDispatcher = require('./services/jobDispatcher');

const PORT = process.env.PORT || 5000;
const SHUTDOWN_TIMEOUT_MS = 20000;

let server;
let shuttingDown = false;

/**
 * Drain before exiting.
 *
 * A deploy that kills the process mid-capture leaves money taken with credits
 * possibly unwritten. The PayPal webhook is the backstop, but finishing
 * in-flight work first is what keeps that path exceptional rather than routine.
 */
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[server] ${signal} received, shutting down`);

  // Hard ceiling — never hang a deploy waiting on a stuck request.
  const forceExit = setTimeout(() => {
    console.error('[server] shutdown timed out, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.info('[server] stopped accepting connections');
    }
    await scheduler.stop();
    console.info('[server] scheduler drained');

    // Background jobs accepted before the shutdown signal must finish, and
    // batched counters must reach the database. Both drain BEFORE the
    // connection closes — reversing the order silently discards the work.
    const jobs = await jobDispatcher.drain(5000);
    console.info(`[server] jobs drained (${jobs.drained ? 'clean' : `${jobs.inFlight} abandoned`})`);
    const counters = await counterService.shutdown();
    if (counters.flushed) console.info(`[server] flushed ${counters.flushed} counter updates`);

    await mongoose.disconnect();
    console.info('[server] database disconnected');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[server] shutdown error:', error.message);
    process.exit(1);
  }
};

const start = async () => {
  await connectDB(process.env.MONGO_URI);
  server = app.listen(PORT, () => {
    console.info(`NovelHub API running on port ${PORT}`);
  });

  // Opt-out for environments that run jobs in a dedicated worker process.
  // SCHEDULER DISABLED: Commented out to prevent schedulers from running.
  // if (process.env.SCHEDULER_ENABLED !== 'false') {
  //   scheduler.start();
  // }

  ['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled rejection:', reason);
  });
};

start();

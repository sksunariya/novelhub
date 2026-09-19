// The places that send a reader somewhere: PayPal return pages and the links
// stored on notifications. None of them may hand out a localhost URL.

jest.mock('../src/services/emailQueue', () => ({ setSender: jest.fn(), enqueue: jest.fn() }));
jest.mock('../src/services/settingsService', () => ({
  snapshot: jest.fn(async () => ({ get: () => false })),
  get: jest.fn(async () => 250),
}));
jest.mock('../src/services/orderService', () => ({
  createOrder: jest.fn(async () => ({
    order: { _id: 'o1', orderNumber: 'N-1', chargeCurrency: 'USD', chargeAmountMinor: 500, chargeDecimals: 2 },
    paypalOrder: { id: 'PP-1', status: 'CREATED' },
  })),
}));
jest.mock('../src/services/subscriptionService', () => ({
  start: jest.fn(async () => ({ subscription: { _id: 'sub1' }, approveUrl: 'https://www.paypal.com/approve' })),
}));

const orderService = require('../src/services/orderService');
const subscriptionService = require('../src/services/subscriptionService');
const emailQueue = require('../src/services/emailQueue');
const store = require('../src/controllers/storeController');
const subscriptions = require('../src/controllers/subscriptionController');
const Notification = require('../src/models/Notification');
const Campaign = require('../src/models/Campaign');
const SiteSettings = require('../src/models/SiteSettings');
const User = require('../src/models/User');
const { dispatchNotification, dispatchCampaign } = require('../src/services/notificationService');

const ENV_KEYS = ['APP_URL', 'CLIENT_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  jest.clearAllMocks();
});
afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
  jest.restoreAllMocks();
});

const invoke = async (handler, req) => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  await handler({ headers: {}, user: { _id: 'u1' }, ...req }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
};

describe('PayPal credit-pack return URLs', () => {
  const lastOrderArgs = () => orderService.createOrder.mock.calls.at(-1)[0];

  it('come from the Origin the reader is on', async () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    await invoke(store.createOrder, { headers: { origin: 'https://www.a2znovels.example' }, body: { packId: 'p1' } });
    expect(lastOrderArgs().returnUrl).toBe('https://www.a2znovels.example/store?paypal=return');
    expect(lastOrderArgs().cancelUrl).toBe('https://www.a2znovels.example/store?paypal=cancel');
  });

  it('fall back to the configured public URL', async () => {
    process.env.CLIENT_URL = 'https://a2znovels.example/';
    await invoke(store.createOrder, { body: { packId: 'p1' } });
    expect(lastOrderArgs().returnUrl).toBe('https://a2znovels.example/store?paypal=return');
  });

  it('are left out, not made up, when there is neither', async () => {
    await invoke(store.createOrder, { body: { packId: 'p1' } });
    // The old fallback produced "/store/success" — relative, and a page that does not exist.
    expect(lastOrderArgs().returnUrl).toBeUndefined();
    expect(lastOrderArgs().cancelUrl).toBeUndefined();
  });
});

describe('PayPal subscription return URLs', () => {
  const lastStartArgs = () => subscriptionService.start.mock.calls.at(-1)[0];

  it('return to /subscribe, where the page confirms the subscription', async () => {
    await invoke(subscriptions.subscribe, { headers: { origin: 'https://a2znovels.example' }, body: { planId: 'plan1' } });
    expect(lastStartArgs().returnUrl).toBe('https://a2znovels.example/subscribe');
    expect(lastStartArgs().cancelUrl).toBe('https://a2znovels.example/subscribe');
  });

  it('use the configured public URL without an Origin', async () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    await invoke(subscriptions.subscribe, { body: { planId: 'plan1' } });
    expect(lastStartArgs().returnUrl).toBe('https://a2znovels.example/subscribe');
  });

  it('keep the URLs the page sends', async () => {
    await invoke(subscriptions.subscribe, {
      body: { planId: 'plan1', returnUrl: 'https://a2znovels.example/subscribe?sub=1', cancelUrl: 'https://a2znovels.example/subscribe' },
    });
    expect(lastStartArgs().returnUrl).toBe('https://a2znovels.example/subscribe?sub=1');
  });
});

describe('notification links', () => {
  const settings = {
    enableInAppNotifications: true,
    enableEmailNotifications: true,
    enableReplyNotifications: true,
    enableMentionNotifications: true,
    enableChapterNotifications: true,
  };
  const reader = { _id: '64b000000000000000000001', email: 'reader@example.com', notificationPreferences: {} };

  beforeEach(() => {
    jest.spyOn(Notification, 'create').mockImplementation(async (doc) => doc);
  });

  it('store a pasted localhost link as the path it stands for, in-app and email', async () => {
    const record = await dispatchNotification({
      recipient: reader,
      type: 'campaign',
      title: 'Big news',
      message: 'Read it',
      link: 'http://localhost:5173/novel/the-tale#latest',
      channels: ['in_app', 'email'],
      settings,
    });
    expect(record.link).toBe('/novel/the-tale#latest');
    expect(emailQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ link: '/novel/the-tale#latest' }));
  });

  it('leave ordinary links alone', async () => {
    const record = await dispatchNotification({
      recipient: reader,
      type: 'new_chapter',
      title: 'New chapter',
      message: 'Chapter 135',
      link: '/novel/the-tale',
      channels: ['in_app'],
      settings,
    });
    expect(record.link).toBe('/novel/the-tale');
  });

  it('record the cleaned link on the campaign itself', async () => {
    jest.spyOn(User, 'find').mockReturnValue({ select: jest.fn(async () => [reader]) });
    jest.spyOn(SiteSettings, 'getSettings').mockResolvedValue(settings);
    const create = jest.spyOn(Campaign, 'create').mockImplementation(async (doc) => ({ _id: 'c1', ...doc }));

    await dispatchCampaign({
      title: 'Sale',
      message: 'Half price',
      link: 'http://127.0.0.1:5173/store',
      channels: ['in_app'],
      adminUser: { _id: '64b000000000000000000002' },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ link: '/store' }));

    // The fan-out runs on setImmediate; let it finish while the mocks are live.
    await new Promise((resolve) => setImmediate(resolve));
    expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ link: '/store' }));
  });
});

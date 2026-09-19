// Every link the server sends out of the site resolves through
// src/utils/publicUrl.js. The bug this guards against: notification emails were
// built from APP_URL, which nothing sets, with a http://localhost:5173 fallback,
// so every "View Details" button sent from a server pointed at localhost.

jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  return { createTransport: jest.fn(() => ({ sendMail })), __sendMail: sendMail };
});
// The real queue pulls in settings and models; the mailer only registers with it.
jest.mock('../src/services/emailQueue', () => ({ setSender: jest.fn(), enqueue: jest.fn() }));
jest.mock('../src/services/settingsService', () => ({
  snapshot: jest.fn(async () => ({ get: (key) => key === 'spaces.enabled' || key === 'spaces.publicBrowsing' })),
}));

const nodemailer = require('nodemailer');
const {
  normalise,
  isLoopback,
  publicBaseUrl,
  stripLoopbackOrigin,
  absoluteUrl,
  clientBaseUrl,
  warnIfMisconfigured,
} = require('../src/utils/publicUrl');

const ENV_KEYS = ['APP_URL', 'CLIENT_URL', 'NODE_ENV', 'SMTP_HOST'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
});

describe('publicBaseUrl', () => {
  it('uses CLIENT_URL, which is what every deployment already sets', () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    expect(publicBaseUrl()).toBe('https://a2znovels.example');
  });

  it('lets APP_URL override CLIENT_URL', () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    process.env.APP_URL = 'https://links.a2znovels.example';
    expect(publicBaseUrl()).toBe('https://links.a2znovels.example');
  });

  it('drops the trailing slash, query and hash but keeps a sub-path', () => {
    process.env.CLIENT_URL = 'https://a2znovels.example/';
    expect(publicBaseUrl()).toBe('https://a2znovels.example');
    process.env.CLIENT_URL = 'https://example.com/reader/?x=1#top';
    expect(publicBaseUrl()).toBe('https://example.com/reader');
  });

  it('skips a value that is not an absolute http(s) URL', () => {
    process.env.APP_URL = 'a2znovels.example';
    process.env.CLIENT_URL = 'https://a2znovels.example';
    expect(publicBaseUrl()).toBe('https://a2znovels.example');
    process.env.CLIENT_URL = 'http://443.205.32.128:4173'; // 443 is not an IPv4 octet
    expect(publicBaseUrl()).toBe('');
  });

  it('never invents localhost when nothing is configured', () => {
    expect(publicBaseUrl()).toBe('');
    process.env.NODE_ENV = 'development';
    expect(publicBaseUrl()).toBe('');
  });
});

describe('normalise and isLoopback', () => {
  it.each([
    ['ftp://example.com', ''],
    ['javascript:alert(1)', ''],
    ['null', ''],
    ['', ''],
    [undefined, ''],
    ['http://localhost:5173', 'http://localhost:5173'],
  ])('normalise(%p) is %p', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it.each([
    ['http://localhost:5173', true],
    ['http://app.localhost', true],
    ['http://127.0.0.1:5000', true],
    ['http://0.0.0.0:4173', true],
    ['http://[::1]:5173', true],
    ['https://a2znovels.example', false],
    ['http://43.204.140.152:4173', false],
    ['not a url', false],
  ])('isLoopback(%p) is %p', (input, expected) => {
    expect(isLoopback(input)).toBe(expected);
  });
});

describe('absoluteUrl', () => {
  beforeEach(() => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
  });

  it('joins a site path to the public base', () => {
    expect(absoluteUrl('/novel/the-tale')).toBe('https://a2znovels.example/novel/the-tale');
    expect(absoluteUrl('novel/the-tale')).toBe('https://a2znovels.example/novel/the-tale');
    expect(absoluteUrl('  /profile  ')).toBe('https://a2znovels.example/profile');
  });

  it('leaves an absolute link to another site alone', () => {
    expect(absoluteUrl('https://discord.gg/abc')).toBe('https://discord.gg/abc');
  });

  it('moves a pasted localhost link onto the public host', () => {
    expect(absoluteUrl('http://localhost:5173/novel/x/chapter/2?a=1#comment-9')).toBe(
      'https://a2znovels.example/novel/x/chapter/2?a=1#comment-9'
    );
    expect(absoluteUrl('http://127.0.0.1:5000/uploads/a.png')).toBe('https://a2znovels.example/uploads/a.png');
  });

  it('refuses protocol-relative links and other schemes', () => {
    expect(absoluteUrl('//evil.example/x')).toBe('');
    expect(absoluteUrl('javascript:alert(1)')).toBe('');
    expect(absoluteUrl('mailto:someone@example.com')).toBe('');
  });

  it('returns nothing rather than a broken link when no base is configured', () => {
    delete process.env.CLIENT_URL;
    expect(absoluteUrl('/novel/x')).toBe('');
    expect(absoluteUrl('')).toBe('');
    expect(absoluteUrl(undefined)).toBe('');
  });
});

describe('stripLoopbackOrigin', () => {
  it('turns a localhost link into the path it stands for', () => {
    expect(stripLoopbackOrigin('http://localhost:5173/novel/x#c')).toBe('/novel/x#c');
  });

  it('leaves paths, other hosts and non-strings untouched', () => {
    expect(stripLoopbackOrigin('/novel/x')).toBe('/novel/x');
    expect(stripLoopbackOrigin('https://a2znovels.example/novel/x')).toBe('https://a2znovels.example/novel/x');
    expect(stripLoopbackOrigin('')).toBe('');
    expect(stripLoopbackOrigin(undefined)).toBeUndefined();
  });
});

describe('clientBaseUrl', () => {
  it("prefers the request's own Origin", () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    expect(clientBaseUrl({ headers: { origin: 'https://www.a2znovels.example' } })).toBe(
      'https://www.a2znovels.example'
    );
  });

  it('falls back to the configured URL for a missing or opaque Origin', () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    expect(clientBaseUrl({ headers: {} })).toBe('https://a2znovels.example');
    expect(clientBaseUrl({ headers: { origin: 'null' } })).toBe('https://a2znovels.example');
  });

  it('returns nothing when there is neither', () => {
    expect(clientBaseUrl({ headers: {} })).toBe('');
  });
});

describe('warnIfMisconfigured', () => {
  const run = () => warnIfMisconfigured(() => {});

  it('is quiet when CLIENT_URL is a real address', () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.NODE_ENV = 'production';
    expect(run()).toEqual([]);
  });

  it('flags a missing public URL', () => {
    expect(run()).toEqual([expect.stringMatching(/No public site URL/)]);
  });

  it('flags an unparseable value by name', () => {
    process.env.CLIENT_URL = 'http://443.205.32.128:4173';
    expect(run()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^CLIENT_URL="http:\/\/443\.205\.32\.128:4173" is not a valid/)])
    );
  });

  it('flags localhost on a server that sends email', () => {
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(run()).toEqual([expect.stringMatching(/point at http:\/\/localhost:5173/)]);
  });

  it('flags localhost in production', () => {
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.NODE_ENV = 'production';
    expect(run()).toHaveLength(1);
  });

  it('leaves local development alone', () => {
    process.env.CLIENT_URL = 'http://localhost:5173';
    expect(run()).toEqual([]);
  });
});

describe('notification email links', () => {
  const { deliverNotificationEmail, notificationHtml } = require('../src/utils/mailer');
  const sendMail = nodemailer.__sendMail;

  beforeEach(() => {
    sendMail.mockClear();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.CLIENT_URL = 'https://a2znovels.example';
  });

  it('points "View Details" at the public site, not localhost', async () => {
    await deliverNotificationEmail({
      to: 'reader@example.com',
      title: 'New chapter of The Tale of Cultivation and Demon Extermination',
      message: 'New chapter of The Tale of Cultivation and Demon Extermination: Chapter 135',
      link: '/novel/the-tale',
    });

    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('href="https://a2znovels.example/novel/the-tale"');
    expect(mail.html).toContain('View Details');
    expect(mail.html).not.toMatch(/localhost/);
  });

  it('puts the same absolute link in the plain-text part', async () => {
    await deliverNotificationEmail({ to: 'reader@example.com', title: 't', message: 'm', link: '/profile' });
    expect(sendMail.mock.calls[0][0].text).toContain('Link: https://a2znovels.example/profile');
  });

  it('rewrites a campaign link an admin pasted from a local copy', async () => {
    await deliverNotificationEmail({
      to: 'reader@example.com',
      title: 't',
      message: 'm',
      link: 'http://localhost:5173/store',
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('href="https://a2znovels.example/store"');
    expect(mail.text).toContain('Link: https://a2znovels.example/store');
  });

  it('leaves the button out rather than link to localhost when unconfigured', () => {
    delete process.env.CLIENT_URL;
    const html = notificationHtml({ title: 't', message: 'm', link: '/novel/the-tale' });
    expect(html).not.toContain('View Details');
    expect(html).not.toMatch(/localhost/);
  });
});

describe('robots.txt and sitemap index', () => {
  const sitemap = require('../src/controllers/sitemapController');

  const call = async (handler) => {
    const res = { type: jest.fn(), set: jest.fn(), send: jest.fn() };
    const next = jest.fn();
    await handler({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    return res.send.mock.calls[0][0];
  };

  it('uses the public URL in the Sitemap line', async () => {
    process.env.CLIENT_URL = 'https://a2znovels.example/';
    expect(await call(sitemap.robots)).toContain('Sitemap: https://a2znovels.example/sitemap.xml');
  });

  it('uses the public URL for every segment in the index', async () => {
    process.env.CLIENT_URL = 'https://a2znovels.example';
    const xml = await call(sitemap.sitemapIndex);
    expect(xml).toContain('<loc>https://a2znovels.example/sitemap-spaces.xml</loc>');
    expect(xml).not.toMatch(/localhost/);
  });
});

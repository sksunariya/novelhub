describe('mailer util', () => {
  const original = process.env.SMTP_HOST;
  afterEach(() => {
    if (original === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = original;
  });

  it('reports not configured without SMTP_HOST', () => {
    delete process.env.SMTP_HOST;
    const { isMailerConfigured } = require('../src/utils/mailer');
    expect(isMailerConfigured()).toBe(false);
  });

  it('reports configured with SMTP_HOST', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const { isMailerConfigured } = require('../src/utils/mailer');
    expect(isMailerConfigured()).toBe(true);
  });

  it('logs the code instead of sending when unconfigured', async () => {
    delete process.env.SMTP_HOST;
    const { sendOtpEmail } = require('../src/utils/mailer');
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    await expect(sendOtpEmail({ to: 'a@b.com', code: '123456', purpose: 'signup' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

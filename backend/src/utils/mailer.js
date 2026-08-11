const nodemailer = require('nodemailer');

let transport;

const isMailerConfigured = () => Boolean(process.env.SMTP_HOST);

const getTransport = () => {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transport;
};

const SUBJECTS = {
  signup: 'Verify your email',
  password_reset: 'Reset your password',
};

const brandName = () => process.env.MAIL_BRAND || 'Apex NovelHub';

const copyFor = (purpose) => {
  if (purpose === 'password_reset') {
    return {
      heading: 'Reset your password',
      lead: 'Use the code below to reset your password. If you didn’t request this, you can safely ignore this email.',
    };
  }
  return {
    heading: 'Verify your email',
    lead: 'Welcome! Use the code below to verify your email address and finish creating your account.',
  };
};

const bodyText = (code, purpose) => {
  const action = purpose === 'password_reset' ? 'reset your password' : 'verify your email';
  const minutes = Number(process.env.OTP_TTL_MINUTES) || 10;
  return `Your code to ${action} is ${code}. It expires in ${minutes} minutes. If you didn't request this, ignore this email.`;
};

const bodyHtml = (code, purpose) => {
  const minutes = Number(process.env.OTP_TTL_MINUTES) || 10;
  const { heading, lead } = copyFor(purpose);
  const spaced = code.split('').join('&nbsp;&nbsp;');
  return `
  <div style="margin:0;padding:0;background-color:#0a0507;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0507;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#140a0e;border:1px solid #2c1a20;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#e7e5e4;">${brandName()}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;text-align:center;">
                <h1 style="margin:12px 0 8px;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#e7e5e4;">${heading}</h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#a8a29e;">${lead}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;">
                <div style="border:1px solid #2c1a20;border-radius:12px;background-color:#1e1015;padding:18px 12px;text-align:center;font-family:'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:4px;color:#ef4444;">
                  ${spaced}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;text-align:center;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#a8a29e;">
                  This code expires in ${minutes} minutes. For your security, never share it with anyone.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#57534e;">&copy; ${brandName()}</p>
        </td>
      </tr>
    </table>
  </div>`;
};

const sendOtpEmail = async ({ to, code, purpose }) => {
  if (!isMailerConfigured()) {
    console.info(`[mailer] (${purpose}) code for ${to}: ${code}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || 'Apex NovelHub <no-reply@novelhub.com>',
    to,
    subject: SUBJECTS[purpose] || 'Your code',
    text: bodyText(code, purpose),
    html: bodyHtml(code, purpose),
  });
};

const notificationHtml = ({ title, message, link }) => {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const fullLink = link ? (link.startsWith('http') ? link : `${appUrl}${link}`) : '';
  return `
  <div style="margin:0;padding:0;background-color:#0a0507;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0507;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#140a0e;border:1px solid #2c1a20;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#e7e5e4;">${brandName()}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;text-align:center;">
                <h1 style="margin:12px 0 8px;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#e7e5e4;">${title}</h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#a8a29e;">${message}</p>
              </td>
            </tr>
            ${
              fullLink
                ? `
            <tr>
              <td style="padding:20px 32px;text-align:center;">
                <a href="${fullLink}" style="display:inline-block;background-color:#dc2626;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:10px 24px;border-radius:9999px;">
                  View Details
                </a>
              </td>
            </tr>`
                : ''
            }
          </table>
          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#57534e;">&copy; ${brandName()}</p>
        </td>
      </tr>
    </table>
  </div>`;
};

/** Actually deliver a notification email. Called by the queue, not directly. */
const deliverNotificationEmail = async ({ to, title, message, link }) => {
  if (!isMailerConfigured()) {
    console.info(`[mailer] Notification for ${to}: "${title}" - ${message}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || 'Apex NovelHub <no-reply@novelhub.com>',
    to,
    subject: title || 'New Notification',
    text: `${title}\n\n${message}${link ? `\n\nLink: ${link}` : ''}`,
    html: notificationHtml({ title, message, link }),
  });
};

// Notification mail goes through the queue so a campaign cannot open hundreds
// of concurrent SMTP connections. OTP and password-reset mail deliberately does
// not — those are interactive and must not sit behind a bulk send.
const emailQueue = require('../services/emailQueue');
emailQueue.setSender(deliverNotificationEmail);

const sendNotificationEmail = async (payload) => {
  emailQueue.enqueue(payload);
};

module.exports = {
  isMailerConfigured,
  sendOtpEmail,
  sendNotificationEmail,
  deliverNotificationEmail,
};

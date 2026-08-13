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

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatEmailMessage = (message) => {
  if (!message) return '';
  const paragraphs = String(message)
    .trim()
    .split(/\n\s*\n/);

  return paragraphs
    .map((p) => {
      const escaped = escapeHtml(p);
      const formattedLines = escaped.replace(/\n/g, '<br />');
      return `<p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#d1d5db;">${formattedLines}</p>`;
    })
    .join('');
};

const bodyHtml = (code, purpose) => {
  const minutes = Number(process.env.OTP_TTL_MINUTES) || 10;
  const { heading, lead } = copyFor(purpose);
  const spaced = escapeHtml(code.split('').join(' '));
  const safeBrand = escapeHtml(brandName());
  return `
  <div style="margin:0;padding:0;background-color:#09070c;width:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#09070c;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background-color:#16121e;border:1px solid #292236;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
            <!-- Top Gradient Accent -->
            <tr>
              <td style="height:4px;background:linear-gradient(90deg, #ef4444 0%, #f97316 100%);"></td>
            </tr>
            <!-- Header Brand -->
            <tr>
              <td style="padding:32px 36px 12px;text-align:left;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">
                  <span style="color:#ef4444;">&#9670;</span> ${safeBrand}
                </div>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding:12px 36px 0;text-align:left;">
                <h1 style="margin:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;line-height:28px;color:#f9fafb;">${escapeHtml(heading)}</h1>
                <p style="margin:0 0 24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#9ca3af;">${escapeHtml(lead)}</p>
              </td>
            </tr>
            <!-- Code Box -->
            <tr>
              <td style="padding:0 36px 24px;">
                <div style="border:1px solid #372e4a;border-radius:12px;background-color:#1f192b;padding:20px 16px;text-align:center;font-family:'Courier New',Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#ef4444;">
                  ${spaced}
                </div>
              </td>
            </tr>
            <!-- Expiry Note -->
            <tr>
              <td style="padding:0 36px 32px;text-align:left;">
                <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                  This code expires in <strong style="color:#9ca3af;">${minutes} minutes</strong>. For your security, never share this code with anyone.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center;">&copy; ${safeBrand} &bull; All rights reserved</p>
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
  const safeBrand = escapeHtml(brandName());

  return `
  <div style="margin:0;padding:0;background-color:#09070c;width:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#09070c;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background-color:#16121e;border:1px solid #292236;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
            <!-- Top Gradient Accent -->
            <tr>
              <td style="height:4px;background:linear-gradient(90deg, #ef4444 0%, #f97316 100%);"></td>
            </tr>
            <!-- Header Brand -->
            <tr>
              <td style="padding:32px 36px 12px;text-align:left;">
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">
                  <span style="color:#ef4444;">&#9670;</span> ${safeBrand}
                </div>
              </td>
            </tr>
            <!-- Title & Message Body -->
            <tr>
              <td style="padding:12px 36px 24px;text-align:left;">
                ${title ? `<h1 style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;line-height:28px;color:#f9fafb;">${escapeHtml(title)}</h1>` : ''}
                <div style="margin:0;">
                  ${formatEmailMessage(message)}
                </div>
                ${
                  fullLink
                    ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td align="left">
                      <a href="${escapeHtml(fullLink)}" target="_blank" style="display:inline-block;background-color:#ef4444;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;box-shadow:0 4px 12px rgba(239,68,68,0.25);">
                        View Details &rarr;
                      </a>
                    </td>
                  </tr>
                </table>`
                    : ''
                }
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center;">&copy; ${safeBrand} &bull; All rights reserved</p>
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

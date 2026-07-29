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

const bodyText = (code, purpose) => {
  const action = purpose === 'password_reset' ? 'reset your password' : 'verify your email';
  const minutes = Number(process.env.OTP_TTL_MINUTES) || 10;
  return `Your code to ${action} is ${code}. It expires in ${minutes} minutes.`;
};

const sendOtpEmail = async ({ to, code, purpose }) => {
  if (!isMailerConfigured()) {
    console.info(`[mailer] (${purpose}) code for ${to}: ${code}`);
    return;
  }
  const text = bodyText(code, purpose);
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || 'Apex NovelHub <no-reply@novelhub.com>',
    to,
    subject: SUBJECTS[purpose] || 'Your code',
    text,
    html: `<p>${text}</p>`,
  });
};

module.exports = { isMailerConfigured, sendOtpEmail };

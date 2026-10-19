import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtp
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const mailEnabled = Boolean(transport);

export async function sendVerificationEmail(to, name, link) {
  const text = `Hi ${name},\n\nConfirm your college email to start uploading papers on PYQ Hub:\n${link}\n\nIf you didn't sign up, ignore this email.`;
  if (!transport) {
    console.log(`[mail disabled] Verification link for ${to}: ${link}`);
    return;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject: 'Confirm your PYQ Hub account', text });
}

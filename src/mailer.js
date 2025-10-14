// src/mailer.js
import nodemailer from "nodemailer";

const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
  IMAP_USER // we'll use this as default recipient
} = process.env;

let transporter;

export function initMailer() {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port: Number(SMTP_PORT || 465),
    secure: (SMTP_SECURE || "true") === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter.verify().then(() => {
    console.log("[mail] smtp ready");
  }).catch(err => {
    console.error("[mail] smtp verify failed:", err.message);
  });
}

/**
 * Send a generated email to yourself.
 * @param {Object} param0
 * @param {string} param0.subject
 * @param {string} param0.body
 * @param {string} [param0.to] - optional override, defaults to IMAP_USER
 */
export async function sendGeneratedEmail({ subject, body, to }) {
  if (!transporter) throw new Error("mailer not initialized");
  const recipient = to || IMAP_USER;
  if (!recipient) throw new Error("No recipient (IMAP_USER) configured");
  const fromAddr = SMTP_USER || recipient;

  const info = await transporter.sendMail({
    from: `"AuraLinkPlant" <${fromAddr}>`,   // ← pretty From
    to: recipient,
    subject,
    text: body,
  });
  console.log("[mail] sent", info.messageId);
}
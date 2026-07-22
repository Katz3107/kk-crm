import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ImapFlow } from 'imapflow';

const SMTP_HOST = 'smtp.strato.de';
const SMTP_PORT = 587;
const IMAP_HOST = 'imap.strato.de';
const IMAP_PORT = 993;
const SMTP_USER = 'kontakt@katzenmayer-coaching.com';
const SENT_FOLDER = 'Gesendete Elemente';

// Signatur bewusst kleiner als der Fliesstext (9pt), wie von Kirsten fuer
// den Abbinder angegeben - gilt nur fuer die Signatur, nicht die ganze Mail.
const SIGNATUR_HTML = `
<p style="margin: 8px 0 0 0; font-size: 9pt;">Birkenweg 4<br>
61273 Wehrheim<br>
+49 6081 586770<br>
+49 171 3596354<br>
<a href="https://katzenmayer-coaching.com/" style="color:#0A5F6A; text-decoration:none;">katzenmayer-coaching.com</a><br>
<a href="https://katzenmayer-coaching.com/impressum/" style="color:#0A5F6A; text-decoration:none;">Impressum</a></p>`;

// Verwandelt rohe URLs im Text (z.B. den Kurzgespraech-Buchungslink) in
// klickbare Links, in derselben Linkfarbe wie im Abbinder.
function linkifyUrls(text) {
  return text.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:#0A5F6A; text-decoration:none;">${url}</a>`
  );
}

// Wandelt einfachen Text (mit Leerzeilen als Absatztrenner) in HTML-Absaetze um.
// Enger Absatzabstand statt Browser-Standard (der wirkt sonst zu weit auseinandergezogen).
function textToHtmlParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((absatz) => `<p style="margin: 0 0 8px 0;">${linkifyUrls(absatz).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function buildHtml(text) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0;">
<div style="max-width: 600px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; color: #404040; line-height: 1.5;">
${textToHtmlParagraphs(text)}
${SIGNATUR_HTML}
</div>
</body>
</html>`;
}

function makeTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: process.env.KONTAKT_MAIL_PASSWORD },
  });
}

function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    new MailComposer(mailOptions).compile().build((err, message) => {
      if (err) reject(err); else resolve(message);
    });
  });
}

// Legt eine Kopie der gesendeten Mail im IMAP-Ordner "Gesendete Elemente" ab.
// Reiner SMTP-Versand speichert bei Strato keine Kopie automatisch, dadurch
// tauchte die Mail bisher nicht in Outlook auf. Fehler hier sind nicht fatal -
// der eigentliche Versand ist zu dem Zeitpunkt schon erfolgreich durch.
async function appendToSentFolder(raw) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: SMTP_USER, pass: process.env.KONTAKT_MAIL_PASSWORD },
    logger: false,
  });
  try {
    await client.connect();
    await client.append(SENT_FOLDER, raw, ['\\Seen']);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function sendMail({ to, subject, text }) {
  if (!process.env.KONTAKT_MAIL_PASSWORD) {
    throw new Error('KONTAKT_MAIL_PASSWORD env-var ist nicht gesetzt');
  }

  const mailOptions = {
    from: `Kirsten Katzenmayer <${SMTP_USER}>`,
    to,
    subject,
    text,
    html: buildHtml(text),
  };

  const raw = await buildRawMessage(mailOptions);

  const transport = makeTransport();
  await transport.sendMail({ raw, envelope: { from: SMTP_USER, to } });

  try {
    await appendToSentFolder(raw);
  } catch (err) {
    console.warn('Kopie in "Gesendete Elemente" fehlgeschlagen (Versand war trotzdem erfolgreich):', err.message);
  }
}

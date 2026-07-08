import nodemailer from 'nodemailer';

const SMTP_HOST = 'smtp.strato.de';
const SMTP_PORT = 587;
const SMTP_USER = 'kontakt@katzenmayer-coaching.com';

const SIGNATUR_HTML = `
<p style="margin: 18px 0 0 0;">Birkenweg 4<br>
61273 Wehrheim<br>
+49 6081 586770<br>
+49 171 3596354<br>
<a href="https://katzenmayer-coaching.com/" style="color:#0A5F6A; text-decoration:none;">katzenmayer-coaching.com</a><br>
<a href="https://katzenmayer-coaching.com/impressum/" style="color:#0A5F6A; text-decoration:none;">Impressum</a></p>`;

// Wandelt einfachen Text (mit Leerzeilen als Absatztrenner) in HTML-Absaetze um.
// Enger Absatzabstand statt Browser-Standard (der wirkt sonst zu weit auseinandergezogen).
function textToHtmlParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((absatz) => `<p style="margin: 0 0 4px 0;">${absatz.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function buildHtml(text) {
  return `<div style="max-width: 600px; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 9pt; color: #404040; line-height: 1.5;">
${textToHtmlParagraphs(text)}
${SIGNATUR_HTML}
</div>`;
}

function makeTransport() {
  if (!process.env.KONTAKT_MAIL_PASSWORD) {
    throw new Error('KONTAKT_MAIL_PASSWORD env-var ist nicht gesetzt');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USER, pass: process.env.KONTAKT_MAIL_PASSWORD },
  });
}

export async function sendMail({ to, subject, text }) {
  const transport = makeTransport();
  await transport.sendMail({
    from: `Kirsten Katzenmayer <${SMTP_USER}>`,
    to,
    subject,
    text,
    html: buildHtml(text),
  });
}

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const IMAP_HOST = 'imap.strato.de';
const IMAP_PORT = 993;
const IMAP_USER = 'kontakt@katzenmayer-coaching.com';

function makeClient() {
  if (!process.env.KONTAKT_MAIL_PASSWORD) {
    throw new Error('KONTAKT_MAIL_PASSWORD env-var ist nicht gesetzt');
  }
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: process.env.KONTAKT_MAIL_PASSWORD },
    logger: false,
  });
}

// Findet den tatsaechlichen Namen des Gesendet-Ordners (variiert je nach
// Mailserver: "Sent", "Gesendet", "INBOX.Sent" usw.) statt ihn zu raten.
async function findSentFolder(client) {
  const list = await client.list();
  const match = list.find((box) => /^(sent|gesendet)/i.test(box.name) || box.specialUse === '\\Sent');
  return match ? match.path : null;
}

async function fetchFromFolder(client, folderPath, email, richtung) {
  const results = [];
  let lock = await client.getMailboxLock(folderPath);
  try {
    const searchCriteria = richtung === 'eingehend' ? { from: email } : { to: email };
    const uids = await client.search(searchCriteria, { uid: true });
    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg) continue;
      const parsed = await simpleParser(msg.source);
      results.push({
        externalId: `imap:${folderPath}:${uid}`,
        betreff: parsed.subject || '',
        inhalt: (parsed.text || '').trim() || (parsed.html || ''),
        datum: parsed.date || new Date(),
        richtung,
      });
    }
  } finally {
    lock.release();
  }
  return results;
}

// Holt alle Mails an/von der angegebenen Adresse aus Posteingang + Gesendet.
export async function fetchMailsForAddress(email) {
  const client = makeClient();
  await client.connect();
  try {
    const inbox = await fetchFromFolder(client, 'INBOX', email, 'eingehend');
    const sentFolder = await findSentFolder(client);
    const sent = sentFolder ? await fetchFromFolder(client, sentFolder, email, 'ausgehend') : [];
    return [...inbox, ...sent].sort((a, b) => new Date(a.datum) - new Date(b.datum));
  } finally {
    await client.logout().catch(() => {});
  }
}

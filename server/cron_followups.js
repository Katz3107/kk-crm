/**
 * Cronjob: Taegliche Follow-up Erinnerungsmail.
 * Laeuft taeglich um 7:30 Uhr via crontab.
 * Sendet eine Zusammenfassung aller faelligen Follow-ups an Kirsten.
 * Nutzt Make.com Webhook zum Mailversand.
 */
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'kk_unternehmens_db',
  user: process.env.DB_USER || 'katzenmayer',
  password: process.env.DB_PASSWORD || 'kk-crm-2026!',
});

// Make.com Webhook fuer Follow-up Erinnerungsmail
const WEBHOOK_URL = 'https://hook.eu2.make.com/followup-reminder-placeholder';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function sendFollowupReminder() {
  const heute = new Date().toISOString().slice(0, 10);
  console.log(`[${heute}] Pruefe faellige Follow-ups...`);

  try {
    const result = await pool.query(`
      SELECT k.id, k.vorname, k.nachname, k.email, k.telefon,
             k.stand_interessent, k.datum_naechste_aktion, k.notizen
      FROM kontakte k
      WHERE k.typ = 'interessent'
        AND k.datum_naechste_aktion IS NOT NULL
        AND k.datum_naechste_aktion <= CURRENT_DATE
        AND (k.stand_interessent IN ('EG', 'Schwebe') OR k.stand_interessent IS NULL)
      ORDER BY k.datum_naechste_aktion ASC
    `);

    if (result.rows.length === 0) {
      console.log('Keine faelligen Follow-ups.');
      await pool.end();
      return;
    }

    console.log(`${result.rows.length} faellige(s) Follow-up(s) gefunden.`);

    // HTML-Liste der faelligen Follow-ups
    const lines = result.rows.map((r) => {
      const name = `${r.vorname || ''} ${r.nachname || ''}`.trim() || 'Unbekannt';
      const fuDatum = formatDate(r.datum_naechste_aktion);
      const kontakt = r.telefon || r.email || '-';
      const notiz = r.notizen ? ` — ${r.notizen.substring(0, 80)}` : '';
      return `- ${name} (FU: ${fuDatum}, ${kontakt}${notiz})`;
    });

    const mailBody = `Hallo Kirsten,\n\ndu hast ${result.rows.length} faellige(s) Follow-up(s):\n\n${lines.join('\n')}\n\nLink: https://crm.katzenmayer-coaching.com/interessenten?filter=followup\n\nViele Gruesse\nDein CRM`;

    const payload = {
      typ: 'followup-erinnerung',
      anzahl: result.rows.length,
      text: mailBody,
      details: result.rows.map((r) => ({
        name: `${r.vorname || ''} ${r.nachname || ''}`.trim(),
        email: r.email,
        telefon: r.telefon,
        fuDatum: r.datum_naechste_aktion,
        stand: r.stand_interessent,
      })),
    };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`Erinnerungsmail gesendet (${result.rows.length} Follow-ups).`);
      } else {
        console.error(`FEHLER: HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`FEHLER beim Senden: ${err.message}`);
    }
  } catch (err) {
    console.error('DB-Fehler:', err.message);
  }

  await pool.end();
  console.log('Fertig.');
}

sendFollowupReminder();

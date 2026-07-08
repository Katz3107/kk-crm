/**
 * Cronjob: Faellige Rechnungen automatisch an Make senden.
 * Laeuft taeglich um 7:00 Uhr via crontab.
 * Prueft: gestellt_am <= heute AND webhook_gesendet_am IS NULL
 */
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'kk_unternehmens_db',
  user: process.env.DB_USER || 'katzenmayer',
  password: process.env.DB_PASSWORD || 'kk-crm-2026!',
});

const WEBHOOK_URL = 'https://hook.eu2.make.com/7ampgkqciw0z3f5ralsthwk5y399tnvu';

async function sendeFaelligeRechnungen() {
  const heute = new Date().toISOString().slice(0, 10);
  console.log(`[${heute}] Pruefe faellige Rechnungen...`);

  try {
    const result = await pool.query(
      `SELECT r.*, k.vorname, k.nachname
       FROM rechnungen r
       LEFT JOIN kontakte k ON r.kontakt_id = k.id
       WHERE r.gestellt_am <= $1
         AND r.webhook_gesendet_am IS NULL
       ORDER BY r.gestellt_am ASC, r.rate_nr ASC`,
      [heute]
    );

    if (result.rows.length === 0) {
      console.log('Keine faelligen Rechnungen gefunden.');
      await pool.end();
      return;
    }

    console.log(`${result.rows.length} Rechnung(en) zu senden.`);

    for (const r of result.rows) {
      const payload = {
        rgNr: r.rg_nr,
        email: r.email,
        vorname: r.vorname || '',
        nachname: r.nachname || '',
        betrag: parseFloat(r.betrag),
        rateNr: r.rate_nr,
        ratenGesamt: r.raten_gesamt,
        produktkuerzel: r.produkt_kuerzel,
        pdfDateiname: r.pdf_pfad ? r.pdf_pfad.split(/[/\\]/).pop() : '',
        gestelltAm: r.gestellt_am,
        faelligAm: r.faellig_am,
      };

      try {
        const response = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          await pool.query(
            'UPDATE rechnungen SET webhook_gesendet_am = NOW() WHERE id = $1',
            [r.id]
          );
          console.log(`  OK: ${r.rg_nr} -> ${r.email} (${r.betrag} EUR)`);
        } else {
          console.error(`  FEHLER: ${r.rg_nr} -> HTTP ${response.status}`);
        }
      } catch (err) {
        console.error(`  FEHLER: ${r.rg_nr} -> ${err.message}`);
      }
    }
  } catch (err) {
    console.error('DB-Fehler:', err.message);
  }

  await pool.end();
  console.log('Fertig.');
}

sendeFaelligeRechnungen();

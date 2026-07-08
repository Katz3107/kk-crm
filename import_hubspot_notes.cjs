const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: 'kk_unternehmens_db',
  user: 'katzenmayer',
  password: 'kk-crm-2026!',
});

// HTML-Tags entfernen und Whitespace bereinigen
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const entries = JSON.parse(fs.readFileSync('hubspot_notes_export.json', 'utf8'));
  console.log(`${entries.length} Eintraege zu importieren.\n`);

  let imported = 0, skipped = 0, noContact = 0;

  for (const entry of entries) {
    if (!entry.email) { noContact++; continue; }

    // Kontakt in DB finden
    const kontaktRes = await pool.query(
      "SELECT id, vorname, nachname FROM kontakte WHERE LOWER(email) = LOWER($1) AND typ = 'interessent' LIMIT 1",
      [entry.email]
    );

    if (kontaktRes.rows.length === 0) {
      skipped++;
      continue;
    }

    const kontakt = kontaktRes.rows[0];
    const body = stripHtml(entry.body || '');
    const subject = entry.subject ? stripHtml(entry.subject) : '';

    if (!body && !subject) { skipped++; continue; }

    // Datum aus dem Engagement
    const datum = entry.date ? entry.date.substring(0, 19).replace('T', ' ') : null;

    // Notiztext zusammensetzen
    let notizText = '';
    if (entry.type === 'TASK' && subject) {
      notizText = subject;
      if (body && body !== subject) notizText += '\n' + body;
    } else {
      notizText = body;
    }

    // Pruefen ob schon ein Gespraech mit exakt gleichem Text existiert
    const existing = await pool.query(
      "SELECT id FROM interessenten_gespraeche WHERE kontakt_id = $1 AND LEFT(protokoll_eigen, 50) = LEFT($2, 50)",
      [kontakt.id, notizText]
    );

    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    // Typ bestimmen
    let typ = entry.type === 'NOTE' ? 'Notiz' : 'Aufgabe';

    // Als Gespraech einfuegen
    await pool.query(
      `INSERT INTO interessenten_gespraeche (kontakt_id, kuerzel, datum, typ, protokoll_eigen)
       VALUES ($1, $2, $3, $4, $5)`,
      [kontakt.id, 'KK', datum, typ, notizText]
    );

    imported++;
    console.log(`  ${kontakt.vorname} ${kontakt.nachname || ''} | ${typ} | ${datum ? datum.substring(0, 10) : '-'} | ${notizText.substring(0, 60)}`);
  }

  console.log(`\nImportiert: ${imported}`);
  console.log(`Uebersprungen (Duplikat/leer): ${skipped}`);
  console.log(`Kein Kontakt gefunden: ${noContact}`);

  await pool.end();
}

main();

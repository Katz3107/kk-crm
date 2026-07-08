const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: 'kk_unternehmens_db',
  user: 'katzenmayer',
  password: 'kk-crm-2026!',
});

async function main() {
  const entries = JSON.parse(fs.readFileSync('hubspot_meetings_export.json', 'utf8'));

  // Nur echte Protokolle (keine TidyCal-Buchungen)
  const protokolle = entries.filter(e => !e.isTidycal && e.body && e.body.length > 5);
  console.log(`${protokolle.length} Meeting-Protokolle zu importieren.\n`);

  let imported = 0, updated = 0, skipped = 0, noContact = 0;

  for (const entry of protokolle) {
    if (!entry.email) { noContact++; continue; }

    // Kontakt in DB finden
    const kontaktRes = await pool.query(
      "SELECT id, vorname, nachname FROM kontakte WHERE LOWER(email) = LOWER($1) AND typ = 'interessent' LIMIT 1",
      [entry.email]
    );

    if (kontaktRes.rows.length === 0) { skipped++; continue; }

    const kontakt = kontaktRes.rows[0];
    const datum = entry.date ? entry.date.substring(0, 19).replace('T', ' ') : null;
    const datumDate = datum ? datum.substring(0, 10) : null;

    // Pruefen ob schon ein Gespraech mit gleichem Datum existiert (vom CSV-Import)
    const existing = await pool.query(
      "SELECT id, protokoll_eigen FROM interessenten_gespraeche WHERE kontakt_id = $1 AND datum::date = $2::date",
      [kontakt.id, datumDate]
    );

    if (existing.rows.length > 0) {
      // Bestehendes Gespraech: Protokoll ergaenzen wenn das bestehende nur den Termintyp enthaelt
      const ex = existing.rows[0];
      const existingProto = (ex.protokoll_eigen || '').trim();
      const isShort = existingProto.length < 80;
      const isTermintyp = existingProto.includes('Gratis-Gespräch') ||
                          existingProto.includes('Strategiegespräch') ||
                          existingProto.includes('Analyse-Session') ||
                          existingProto.includes('Gratisgespräch') ||
                          existingProto.includes('Gratis-Kurzgespräch');

      if (isShort || isTermintyp) {
        // Protokoll ersetzen mit dem echten Gespraechsprotokoll
        const newProto = isTermintyp
          ? existingProto + '\n\n--- Gespraechsnotizen ---\n' + entry.body
          : entry.body;
        await pool.query(
          "UPDATE interessenten_gespraeche SET protokoll_eigen = $1 WHERE id = $2",
          [newProto, ex.id]
        );
        updated++;
        console.log(`  UPDATE: ${kontakt.vorname} ${kontakt.nachname || ''} | ${datumDate} | +${entry.body.length} Zeichen`);
      } else {
        // Schon ein langes Protokoll vorhanden - pruefen ob gleicher Text
        if (existingProto.includes(entry.body.substring(0, 40))) {
          skipped++;
        } else {
          // Neues Gespraech anlegen (anderes Protokoll zum gleichen Tag)
          await pool.query(
            `INSERT INTO interessenten_gespraeche (kontakt_id, kuerzel, datum, typ, protokoll_eigen)
             VALUES ($1, $2, $3, $4, $5)`,
            [kontakt.id, 'KK', datum, 'Protokoll', entry.body]
          );
          imported++;
          console.log(`  NEU: ${kontakt.vorname} ${kontakt.nachname || ''} | ${datumDate} | ${entry.body.substring(0, 60)}`);
        }
      }
    } else {
      // Kein bestehendes Gespraech - neu anlegen
      await pool.query(
        `INSERT INTO interessenten_gespraeche (kontakt_id, kuerzel, datum, typ, protokoll_eigen, meeting_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [kontakt.id, 'KK', datum, 'Protokoll', entry.body, entry.meetingUrl || null]
      );
      imported++;
      console.log(`  NEU: ${kontakt.vorname} ${kontakt.nachname || ''} | ${datumDate} | ${entry.body.substring(0, 60)}`);
    }
  }

  console.log(`\nNeu angelegt: ${imported}`);
  console.log(`Bestehendes ergaenzt: ${updated}`);
  console.log(`Uebersprungen (Duplikat): ${skipped}`);
  console.log(`Kein Kontakt: ${noContact}`);

  await pool.end();
}

main();

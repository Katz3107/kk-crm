const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: 'kk_unternehmens_db',
  user: 'katzenmayer',
  password: 'kk-crm-2026!',
});

function parseCSV(text) {
  const rows = []; let row = []; let field = ''; let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') { inQuote = false; } else { field += c; } }
    else { if (c === '"') { inQuote = true; } else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || (c === '\r' && text[i+1] === '\n')) { row.push(field); field = ''; if (c === '\r') i++; rows.push(row); row = []; } else { field += c; } }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const content = fs.readFileSync('/tmp/hubspot.csv', 'utf8');
  const rows = parseCSV(content);
  const headers = rows[0];

  const emailIdx = headers.indexOf('E-Mail');
  const vnIdx = headers.indexOf('Vorname');
  const nnIdx = headers.indexOf('Nachname');
  const jobIdx = headers.indexOf('Jobbezeichnung');
  const anmerkIdx = 13; // "Anmerkungen zu Zugriffsberechtigung"

  console.log('E-Mail:', emailIdx, '| Job:', jobIdx, '| Anmerk:', anmerkIdx);

  let updatedHinweise = 0, updatedAnmerkungen = 0;

  for (let r = 1; r < rows.length; r++) {
    const email = (rows[r][emailIdx] || '').trim();
    if (!email) continue;

    const job = (rows[r][jobIdx] || '').trim();
    const anmerk = (rows[r][anmerkIdx] || '').trim();

    // Jobbezeichnung -> hinweise (nur wenn es nach Notiz aussieht, nicht nach echtem Jobtitel)
    if (job && (job.includes('FU') || job.includes('Mail') || job.includes('mail') || job.includes('E-mail') || job.includes('Telefon') || job.includes('Anruf') || job.includes('Terminlink') || job.includes('schreiben') || job.includes('nachfassen'))) {
      const result = await pool.query(
        "UPDATE kontakte SET hinweise = CASE WHEN hinweise IS NULL OR hinweise = '' THEN $1 ELSE hinweise || E'\\n' || $1 END WHERE LOWER(email) = LOWER($2) AND typ = 'interessent' RETURNING id, vorname, nachname",
        [job, email]
      );
      if (result.rows.length > 0) {
        const k = result.rows[0];
        console.log(`  Hinweise: ${k.vorname} ${k.nachname} <- "${job}"`);
        updatedHinweise++;
      }
    }

    // Anmerkungen -> anmerkungen
    if (anmerk) {
      const result = await pool.query(
        "UPDATE kontakte SET anmerkungen = CASE WHEN anmerkungen IS NULL OR anmerkungen = '' THEN $1 ELSE anmerkungen || E'\\n' || $1 END WHERE LOWER(email) = LOWER($2) AND typ = 'interessent' RETURNING id, vorname, nachname",
        [anmerk, email]
      );
      if (result.rows.length > 0) {
        const k = result.rows[0];
        console.log(`  Anmerkungen: ${k.vorname} ${k.nachname} <- "${anmerk}"`);
        updatedAnmerkungen++;
      }
    }
  }

  console.log('\nHinweise aktualisiert:', updatedHinweise);
  console.log('Anmerkungen aktualisiert:', updatedAnmerkungen);

  await pool.end();
}

main();

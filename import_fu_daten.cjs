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
  const content = fs.readFileSync('hubspot-crm-exports-alle-kontakte-katz-2026-04-09.csv', 'utf8');
  const rows = parseCSV(content);
  const headers = rows[0];

  const emailIdx = headers.indexOf('E-Mail');
  const fuIdx = headers.indexOf('Datum n\u00e4chste Aktion');

  console.log('E-Mail Spalte:', emailIdx, '| FU-Datum Spalte:', fuIdx);

  let updated = 0, notFound = 0;

  for (let r = 1; r < rows.length; r++) {
    const email = (rows[r][emailIdx] || '').trim();
    const fuDatum = (rows[r][fuIdx] || '').trim();

    if (!email || !fuDatum) continue;

    const result = await pool.query(
      "UPDATE kontakte SET datum_naechste_aktion = $1 WHERE LOWER(email) = LOWER($2) AND typ = 'interessent' RETURNING id",
      [fuDatum, email]
    );

    if (result.rows.length > 0) {
      updated++;
    } else {
      notFound++;
    }
  }

  console.log('FU-Daten aktualisiert:', updated);
  console.log('Nicht gefunden:', notFound);

  await pool.end();
}

main();

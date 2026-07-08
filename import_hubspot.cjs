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
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuote = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || (c === '\r' && text[i+1] === '\n')) {
        row.push(field); field = '';
        if (c === '\r') i++;
        rows.push(row); row = [];
      }
      else { field += c; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const content = fs.readFileSync('hubspot-crm-exports-alle-kontakte-katz-2026-04-09.csv', 'utf8');
  const rows = parseCSV(content);
  const headers = rows[0];

  // Build column index
  const col = {};
  const wanted = ['Datensatz-ID','Vorname','Nachname','E-Mail','Handynummer','Telefonnummer',
    'Stadt','Land/Region','Erstellungsdatum','Stand','Quelle','Investitionsbereitschaft',
    'Datum Erstkontakt','Nachricht','Adresszeile','Postleitzahl','Geburtsdatum',
    'Start Date & Time','Zoom'];
  for (const w of wanted) col[w] = headers.indexOf(w);

  // Calendly Q/A indices
  const qIdx = {}, aIdx = {};
  for (let i = 0; i < headers.length; i++) {
    const m = headers[i].match(/^Calendly Custom Question (\d+)$/);
    if (m) qIdx[parseInt(m[1])] = i;
    const m2 = headers[i].match(/^Calendly Custom Answer (\d+)$/);
    if (m2) aIdx[parseInt(m2[1])] = i;
  }

  const client = await pool.connect();
  let imported = 0, skipped = 0, antwortenCount = 0, gespraecheCount = 0;

  try {
    await client.query('BEGIN');

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const vorname = (row[col['Vorname']] || '').trim();
      const nachname = (row[col['Nachname']] || '').trim();
      const email = (row[col['E-Mail']] || '').trim();
      const stand = (row[col['Stand']] || '').trim();
      const nachricht = (row[col['Nachricht']] || '').trim();

      // Skip: Nachricht genau "Coaching" oder Stand "Bestandskunde"
      if (nachricht.toLowerCase() === 'coaching' || stand === 'Bestandskunde') {
        skipped++;
        continue;
      }

      // Skip empty rows
      if (!vorname && !nachname && !email) {
        skipped++;
        continue;
      }

      const handy = (row[col['Handynummer']] || '').trim();
      const telefon = (row[col['Telefonnummer']] || '').trim();
      const stadt = (row[col['Stadt']] || '').trim();
      const land = (row[col['Land/Region']] || '').trim();
      const erstellDatum = (row[col['Erstellungsdatum']] || '').trim();
      const quelle = (row[col['Quelle']] || '').trim();
      const datumErstkontakt = (row[col['Datum Erstkontakt']] || '').trim();
      const strasse = (row[col['Adresszeile']] || '').trim();
      const plz = (row[col['Postleitzahl']] || '').trim();
      const geburtsdatum = (row[col['Geburtsdatum']] || '').trim();
      const startDateTime = (row[col['Start Date & Time']] || '').trim();
      const zoomUrl = (row[col['Zoom']] || '').trim();

      // Combine PLZ + Stadt
      const ortKombiniert = [plz, stadt].filter(Boolean).join(' ');

      // Parse erstellDatum to timestamp
      let erstellTs = null;
      if (erstellDatum) {
        erstellTs = erstellDatum.replace(' ', 'T') + ':00.000Z';
      }

      // Insert kontakt
      const res = await client.query(`
        INSERT INTO kontakte (
          typ, vorname, nachname, email, telefon, mobilfon,
          strasse, ort, land, quelle, stand_interessent, notizen,
          erstellungsdatum, datum_erstkontakt, geburtsdatum,
          meeting_url, gespraechspartner, zustaendig
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id
      `, [
        'interessent',
        vorname || null,
        nachname || null,
        email || null,
        telefon || null,
        handy || null,
        strasse || null,
        ortKombiniert || null,
        land || null,
        quelle || null,
        stand || null,
        nachricht || null,
        erstellTs || null,
        datumErstkontakt || null,
        geburtsdatum || null,
        zoomUrl || null,
        'Kirsten',
        'Kirsten',
      ]);

      const kontaktId = res.rows[0].id;
      imported++;

      // Insert Calendly Q/A as tidycal_antworten
      let sortNr = 0;
      for (let i = 1; i <= 10; i++) {
        const frage = qIdx[i] !== undefined ? (row[qIdx[i]] || '').trim() : '';
        const antwort = aIdx[i] !== undefined ? (row[aIdx[i]] || '').trim() : '';
        if (frage || antwort) {
          sortNr++;
          await client.query(`
            INSERT INTO tidycal_antworten (kontakt_id, frage, antwort, sortierung)
            VALUES ($1, $2, $3, $4)
          `, [kontaktId, frage || null, antwort || null, sortNr]);
          antwortenCount++;
        }
      }

      // Investitionsbereitschaft als eigenes Feld, falls nicht schon in Antworten
      const invest = (row[col['Investitionsbereitschaft']] || '').trim();
      if (invest) {
        const hasInvest = [1,2,3,4,5,6,7,8,9,10].some(i => {
          const q = qIdx[i] !== undefined ? (row[qIdx[i]] || '').trim().toLowerCase() : '';
          return q.includes('investier') || q.includes('summe');
        });
        if (!hasInvest) {
          sortNr++;
          await client.query(`
            INSERT INTO tidycal_antworten (kontakt_id, frage, antwort, sortierung)
            VALUES ($1, $2, $3, $4)
          `, [kontaktId, 'Investitionsbereitschaft', invest, sortNr]);
          antwortenCount++;
        }
      }

      // Erstgespraech anlegen wenn Termin oder Erstkontakt-Datum vorhanden
      if (startDateTime || datumErstkontakt) {
        const gespraechDatum = startDateTime || datumErstkontakt;
        await client.query(`
          INSERT INTO interessenten_gespraeche (kontakt_id, datum, typ, meeting_url, protokoll_eigen)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          kontaktId,
          gespraechDatum || null,
          'Erstgespraech',
          zoomUrl || null,
          nachricht || null,
        ]);
        gespraecheCount++;
      }
    }

    await client.query('COMMIT');
    console.log('Import abgeschlossen:');
    console.log('  Kontakte importiert: ' + imported);
    console.log('  Kontakte uebersprungen: ' + skipped);
    console.log('  Antworten gespeichert: ' + antwortenCount);
    console.log('  Gespraeche angelegt: ' + gespraecheCount);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FEHLER:', err.message);
    console.error('Bei Zeile ca.:', imported + skipped + 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

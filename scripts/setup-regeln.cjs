const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://katzenmayer:kk-crm-2026!@localhost/kk_unternehmens_db' });

const regeln = [
  // Prio 10: Spezifische Kombis (Name+Zweck oder Zweck+Betrag)
  { zweck_pattern: 'Google', betrag_von: -5.99, betrag_bis: -5.99, steuerschluessel: 'U-229', schluessel: 'Bürobedarf', beschreibung: 'YT Premium Lite', prioritaet: 10 },
  { zweck_pattern: 'Google', betrag_von: -21.99, betrag_bis: -21.99, steuerschluessel: 'U-229', schluessel: 'Bürobedarf', beschreibung: 'Google AI (Gemini)', prioritaet: 10 },
  { name_pattern: 'Google', zweck_pattern: 'ADWORDS', steuerschluessel: 'U-224', schluessel: 'Werbung', beschreibung: 'adwords', prioritaet: 10 },
  { name_pattern: 'FA Nidda', betrag_bis: -0.01, steuerschluessel: 'U-186', schluessel: 'Steuer-U', prioritaet: 10 },
  { name_pattern: 'FA Nidda', betrag_von: 0.01, steuerschluessel: 'U-224', schluessel: 'Steuer-U', prioritaet: 10 },
  { zweck_pattern: 'RE-20', betrag_von: 0.01, steuerschluessel: 'U-112', schluessel: 'Kunde', prioritaet: 10 },

  // Prio 20: Spezifische Name-Matches (laengere Patterns zuerst)
  { name_pattern: 'AFNB GmbH', steuerschluessel: 'U-223', schluessel: 'Verband', beschreibung: 'AFNB', prioritaet: 20 },
  { name_pattern: 'Generali Deutschland Leben', steuerschluessel: 'E-XV', schluessel: 'Versicherung LV', beschreibung: 'Generali', prioritaet: 20 },
  { name_pattern: '11 88 0 Internet Services AG', steuerschluessel: 'U-224', schluessel: 'Werbung', beschreibung: '11880', prioritaet: 20 },
  { name_pattern: 'R+V Pensionsversicherung', steuerschluessel: 'E-XV', schluessel: 'Versicherung RV', beschreibung: 'R+V', prioritaet: 20 },

  // Prio 30: Normale Name-Matches
  { name_pattern: 'DM DROGERIEMARKT', schluessel: 'Haushalt', prioritaet: 30 },
  { name_pattern: 'Penny', schluessel: 'Haushalt', beschreibung: 'Lebensmittel', prioritaet: 30 },
  { name_pattern: 'SOS-Kinderdörfer', steuerschluessel: 'E-Spende', schluessel: 'Spende', beschreibung: 'SOS', prioritaet: 30 },
  { name_pattern: 'Rundfunk', steuerschluessel: 'U-280', schluessel: 'Medien', beschreibung: 'Rundfunk', prioritaet: 30 },
  { name_pattern: 'Deutsche Glasfaser', steuerschluessel: 'U-280', schluessel: 'Medien', prioritaet: 30 },
  { name_pattern: 'STRATO', steuerschluessel: 'U-228', schluessel: 'IT laufend', beschreibung: 'Homepage', prioritaet: 30 },
  { name_pattern: 'freenet', steuerschluessel: 'U-280', schluessel: 'Medien', prioritaet: 30 },
  { name_pattern: 'Haufe', steuerschluessel: 'U-229', schluessel: 'Bürobedarf', beschreibung: 'Steuerprogramm Lexoffice', prioritaet: 30 },
  { name_pattern: 'Expertiger', steuerschluessel: 'U-228', schluessel: 'IT laufend', beschreibung: 'Wartung', prioritaet: 30 },
  { name_pattern: 'AFNB', steuerschluessel: 'U-223', schluessel: 'Verband', beschreibung: 'AFNB', prioritaet: 30 },
  { name_pattern: 'ENTEGA', steuerschluessel: 'U-Haus', schluessel: 'Strom', prioritaet: 30 },
  { name_pattern: 'GEMEINDE WEHRHEIM', steuerschluessel: 'U-Haus', schluessel: 'Haus', prioritaet: 30 },
  { name_pattern: 'HANSEMERKUR', steuerschluessel: 'E-XV', schluessel: 'Versicherung KV', beschreibung: 'HANSEMERKUR', prioritaet: 30 },
  { name_pattern: 'VOLKSWOHL BUND', steuerschluessel: 'E-XV', schluessel: 'Versicherung LV', beschreibung: 'Volkswohl Bund', prioritaet: 30 },
  { name_pattern: 'Generali Leben', steuerschluessel: 'E-XV', schluessel: 'Versicherung LV', beschreibung: 'Generali', prioritaet: 30 },
  { name_pattern: 'Ideal Leben', steuerschluessel: 'E-XV', schluessel: 'Versicherung LV', beschreibung: 'Ideal', prioritaet: 30 },
  { name_pattern: 'DRV BUND', steuerschluessel: 'E-XV', schluessel: 'Versicherung RV', beschreibung: 'DRV', prioritaet: 30 },
  { name_pattern: 'Roswitha Vogt', schluessel: 'Geschenke', prioritaet: 30 },

  // Prio 40: Normale Zweck-Matches
  { zweck_pattern: 'Kindle Unltd', steuerschluessel: 'U-229', schluessel: 'Bürobedarf', beschreibung: 'Fachliteratur', prioritaet: 40 },
  { zweck_pattern: 'Abschluss per', steuerschluessel: 'U-194', schluessel: 'Kofü', prioritaet: 40 },
  { zweck_pattern: 'namotto', steuerschluessel: 'U-281', schluessel: 'Weiterbildung', beschreibung: 'KI-Business-Club', prioritaet: 40 },
  { zweck_pattern: 'quentn.com', steuerschluessel: 'U-224', schluessel: 'Werbung', beschreibung: 'Quentn', prioritaet: 40 },
  { zweck_pattern: 'Vistaprint BV', steuerschluessel: 'U-224', schluessel: 'Werbung', prioritaet: 40 },
  { zweck_pattern: 'Zoom', steuerschluessel: 'U-280', schluessel: 'Medien', prioritaet: 40 },
  { zweck_pattern: 'OpenAI', steuerschluessel: 'U-229', schluessel: 'Bürobedarf', beschreibung: 'KI - ChatGPT', prioritaet: 40 },
  { zweck_pattern: 'Meta Platforms', steuerschluessel: 'U-224', schluessel: 'Werbung', beschreibung: 'Social Media', prioritaet: 40 },
  { zweck_pattern: 'Avia', steuerschluessel: 'U-146', schluessel: 'Sprit', prioritaet: 40 },
  { zweck_pattern: 'Canva', steuerschluessel: 'U-224', schluessel: 'Werbung', beschreibung: 'Canva', prioritaet: 40 },

  // Prio 50: Generische Zweck-Matches (Supermaerkte etc.)
  { zweck_pattern: 'Aldi', schluessel: 'Haushalt', prioritaet: 50 },
  { zweck_pattern: 'Edeka', schluessel: 'Haushalt', prioritaet: 50 },
  { zweck_pattern: 'HIT MARKT', schluessel: 'Haushalt', prioritaet: 50 },
  { zweck_pattern: 'REWE', schluessel: 'Haushalt', prioritaet: 50 },
];

(async () => {
  // Tabelle anlegen
  await p.query(`
    CREATE TABLE IF NOT EXISTS kategorisierungsregeln (
      id SERIAL PRIMARY KEY,
      name_pattern VARCHAR(255),
      zweck_pattern VARCHAR(255),
      betrag_von NUMERIC(10,2),
      betrag_bis NUMERIC(10,2),
      steuerschluessel VARCHAR(20),
      schluessel VARCHAR(50),
      beschreibung VARCHAR(255),
      prioritaet INTEGER NOT NULL DEFAULT 100,
      aktiv BOOLEAN NOT NULL DEFAULT true,
      erstellt_am TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Tabelle erstellt');

  // Pruefen ob schon Regeln existieren
  const existing = await p.query('SELECT COUNT(*) FROM kategorisierungsregeln');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`Es existieren bereits ${existing.rows[0].count} Regeln. Ueberspringe Insert.`);
    p.end();
    return;
  }

  // Regeln einfuegen
  for (const r of regeln) {
    await p.query(
      `INSERT INTO kategorisierungsregeln (name_pattern, zweck_pattern, betrag_von, betrag_bis, steuerschluessel, schluessel, beschreibung, prioritaet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.name_pattern || null, r.zweck_pattern || null, r.betrag_von ?? null, r.betrag_bis ?? null,
       r.steuerschluessel || null, r.schluessel || null, r.beschreibung || null, r.prioritaet]
    );
  }
  console.log(`${regeln.length} Regeln eingefuegt.`);
  p.end();
})();

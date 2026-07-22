import { config as dotenvConfig } from 'dotenv';
// Zentrale Env-Datei (nur root-lesbar) — enthaelt DB_PASSWORD u.a.
// MUSS vor allen anderen Importen geladen werden, die process.env nutzen.
// override:true ueberschreibt evtl. veraltete Env-Vars von PM2/Shell.
dotenvConfig({ path: '/etc/kk-apps.env', override: true });

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { mkdirSync, existsSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import pg from 'pg';
import { fetchMailsForAddress } from './mail_imap.js';
import { generateFollowupDraft } from './followup_draft.js';
import { sendMail } from './mail_smtp.js';

// TIMESTAMP WITHOUT TIME ZONE (OID 1114) als rohen String zurueckgeben.
// Sonst interpretiert node-pg die Wanduhr-Zeit in der lokalen TZ des Node-
// Prozesses und der Browser verschiebt das Ergebnis nochmal. Wir wollen die
// DB-Werte unveraendert als Wanduhr-Zeit darstellen.
pg.types.setTypeParser(1114, (val) => val);

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3005;

// Database
if (!process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD env-var ist nicht gesetzt. Server kann nicht starten.');
  process.exit(1);
}
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'kk_unternehmens_db',
  user: process.env.DB_USER || 'katzenmayer',
  password: process.env.DB_PASSWORD,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// ============================================================
// KK-ToDo Helper — verbindet Rechnungen & Follow-ups mit KK-ToDo
// ============================================================
// kk-todo laeuft auf demselben Server unter Port 3001. Calls schlagen leise
// fehl, wenn der Service mal nicht laeuft — die CRM-Aktion soll davon nicht
// abhaengen.
const KK_TODO_URL = process.env.KK_TODO_URL || 'http://localhost:3001';
const KUNDENAUFGABEN_PROJEKT_ID = 'bd32b2ad-ca2a-447c-98a8-b7af4fdf86c0';

async function kkTodoCreate({ title, description, scheduledDate, dueDate, priority = 3 }) {
  try {
    const res = await fetch(`${KK_TODO_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: KUNDENAUFGABEN_PROJEKT_ID,
        title,
        description: description || '',
        scheduledDate: scheduledDate || null,
        dueDate: dueDate || null,
        priority,
        status: 'open',
        createdBy: 'CRM',
      }),
    });
    if (!res.ok) return null;
    const task = await res.json();
    return task.id || null;
  } catch (err) {
    console.warn('kk-todo create fehlgeschlagen:', err.message);
    return null;
  }
}

async function kkTodoUpdate(taskId, patch) {
  if (!taskId) return false;
  try {
    const res = await fetch(`${KK_TODO_URL}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, changedBy: 'CRM' }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`kk-todo update ${taskId} fehlgeschlagen:`, err.message);
    return false;
  }
}

async function kkTodoMarkDone(taskId) {
  return kkTodoUpdate(taskId, { status: 'done' });
}

// Konvertiert Date-Objekte (aus pg) oder ISO-Strings sauber nach 'YYYY-MM-DD'
// (Berlin-Lokalzeit). Wichtig fuer kk-todo, das pure Datums-Strings erwartet —
// String(dateObj) wuerde 'Wed May 13' liefern.
function toIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toLocaleDateString('sv-SE');
  return String(value).slice(0, 10);
}

// Formatiert ein Datum (Date aus pg oder ISO-String) als 'TT.MM.JJJJ' fuer
// deutsche Belegtexte. String(dateObj) wuerde sonst 'Wed May 06 2026 ...' liefern.
function toDeDate(value) {
  const iso = toIsoDate(value);
  if (!iso) return '';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

// Geheimer Token zwischen kk-todo und kk-crm — verhindert, dass Fremde
// gefaelschte Sync-Events einschleusen. kk-todo setzt diesen Token in einem
// X-Internal-Sync-Secret-Header.
const KK_INTERNAL_SYNC_SECRET = process.env.KK_INTERNAL_SYNC_SECRET
  || 'kk-internal-sync-2026-05-9d8f3a-do-not-share';

// Wird von kk-todo aufgerufen, wenn dort eine Aufgabe geaendert wurde, die zu
// einer Rechnung oder einem Follow-up gehoert. Spielt die Aenderungen zurueck.
//   - Rechnung: Status 'done' nur erlauben, wenn Rechnung wirklich versendet ist
//                (sonst auto-Revert auf 'open'). Datum-Aenderung -> gestellt_am
//                und faellig_am proportional verschieben.
//   - Followup: Status 'done' -> datum_naechste_aktion = NULL.
//               Datum-Aenderung -> datum_naechste_aktion mitziehen.
// Sync-Loops werden vermieden, indem CRM-Updates mit changedBy='CRM*' markiert
// sind und der kk-todo-Webhook diese Faelle uebersprungen werden.
app.post('/api/sync/todo', async (req, res) => {
  try {
    // Auth: nur kk-todo darf das aufrufen, geprueft via Internal-Secret-Header
    const übergebenerSecret = req.headers['x-internal-sync-secret'];
    if (übergebenerSecret !== KK_INTERNAL_SYNC_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { before, after } = req.body || {};
    if (!after || !after.id) return res.json({ ok: false, reason: 'no-task' });

    // Sync-Loops abblocken: Aenderungen, die das CRM selbst gemacht hat, ignorieren
    const lastEdit = (after.changedBy || after.lastChangedBy || '').toString();
    if (lastEdit.startsWith('CRM')) return res.json({ ok: true, ignored: 'self' });

    // Ist es ein Rechnungs-Todo?
    const rgRes = await pool.query(
      `SELECT id, gestellt_am, faellig_am, webhook_gesendet_am, manuell_versendet_am, erhalten_am
         FROM rechnungen WHERE todo_id = $1 LIMIT 1`,
      [after.id]
    );
    if (rgRes.rows.length > 0) {
      const r = rgRes.rows[0];

      // Status auf "done" gesetzt? Nur ok, wenn Rechnung wirklich versendet ist
      if (after.status === 'done' && (before?.status !== 'done')) {
        const versendet = r.webhook_gesendet_am || r.manuell_versendet_am || r.erhalten_am;
        if (!versendet) {
          // Auto-Revert: kk-todo wieder auf open setzen mit Hinweis
          await kkTodoUpdate(after.id, {
            status: 'open',
            description: (after.description || '')
              + '\n\n⚠️ Auto-Revert: Diese Rechnung wurde im CRM noch nicht versendet. Bitte erst im CRM auf "Senden" klicken.',
          });
          return res.json({ ok: true, action: 'reverted-rechnung-nicht-versendet' });
        }
      }

      // Datum verschoben? gestellt_am im CRM updaten und faellig_am proportional
      if (after.scheduledDate && after.scheduledDate !== before?.scheduledDate) {
        const altGestellt = toIsoDate(r.gestellt_am);
        const altFaellig = toIsoDate(r.faellig_am);
        const tageDelta = altGestellt && altFaellig
          ? Math.round((new Date(altFaellig) - new Date(altGestellt)) / 86400000)
          : 7;
        const neuFaellig = new Date(after.scheduledDate);
        neuFaellig.setDate(neuFaellig.getDate() + tageDelta);
        await pool.query(
          `UPDATE rechnungen SET gestellt_am = $1, faellig_am = $2 WHERE id = $3`,
          [after.scheduledDate, neuFaellig.toISOString().slice(0, 10), r.id]
        );
        return res.json({ ok: true, action: 'rechnung-datum-verschoben' });
      }

      return res.json({ ok: true, action: 'rechnung-nichts-zu-tun' });
    }

    // Ist es ein Follow-up-Todo?
    const fuRes = await pool.query(
      `SELECT id, datum_naechste_aktion FROM kontakte WHERE followup_todo_id = $1 LIMIT 1`,
      [after.id]
    );
    if (fuRes.rows.length > 0) {
      const k = fuRes.rows[0];

      // Status auf "done" -> Followup erledigt -> datum_naechste_aktion loeschen
      if (after.status === 'done' && (before?.status !== 'done')) {
        await pool.query(
          `UPDATE kontakte SET datum_naechste_aktion = NULL, followup_todo_id = NULL WHERE id = $1`,
          [k.id]
        );
        return res.json({ ok: true, action: 'followup-erledigt' });
      }

      // Datum verschoben -> datum_naechste_aktion mitziehen
      if (after.scheduledDate && after.scheduledDate !== before?.scheduledDate) {
        await pool.query(
          `UPDATE kontakte SET datum_naechste_aktion = $1 WHERE id = $2`,
          [after.scheduledDate, k.id]
        );
        return res.json({ ok: true, action: 'followup-datum-verschoben' });
      }

      return res.json({ ok: true, action: 'followup-nichts-zu-tun' });
    }

    res.json({ ok: true, ignored: 'unknown-task' });
  } catch (err) {
    console.error('sync/todo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Hinweis: /api/admin/migriere-todos wurde nach einmaliger Verwendung entfernt
// (Sicherheit). Falls erneut benoetigt, manuell hier wieder einfuegen mit Token-Schutz.

// ============================================================
// API Routes
// ============================================================

// --- Kontakte ---

// GET /api/kontakte - alle Kunden (typ='kunde'), mit optionaler Suche
app.get('/api/kontakte', async (req, res) => {
  try {
    const { search } = req.query;
    let query = `SELECT k.id, k.kuerzel, k.vorname, k.nachname, k.email, k.status, k.paket, k.telefon, k.mobilfon, k.quelle, k.aktiv, k.onboardingdatum, k.geb_am,
                   (SELECT MAX(kt.datum) FROM kundentermine kt WHERE kt.kontakt_id = k.id) AS letzter_termin,
                   (SELECT COUNT(*) FROM kundentermine kt WHERE kt.kontakt_id = k.id AND kt.aktion ~ '^(T[0-9]|T[SK]|T-|E[0-9])') AS anzahl_termine,
                   (SELECT UPPER(LEFT(kt.aktion, 1))
                      FROM kundentermine kt
                      WHERE kt.kontakt_id = k.id AND kt.aktion ~ '^(T[0-9]|T[SK]|T-|E[0-9])'
                      ORDER BY kt.datum ASC NULLS LAST
                      LIMIT 1) AS erster_termin_typ
                 FROM kontakte k WHERE k.typ = 'kunde'`;
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(k.kuerzel) LIKE $${params.length} OR
        LOWER(k.vorname) LIKE $${params.length} OR
        LOWER(k.nachname) LIKE $${params.length} OR
        LOWER(k.email) LIKE $${params.length} OR
        LOWER(k.paket) LIKE $${params.length} OR
        LOWER(COALESCE(k.name,'')) LIKE $${params.length} OR
        LOWER(COALESCE(k.status,'')) LIKE $${params.length}
      )`;
    }

    const { statusFilter } = req.query;
    if (statusFilter === 'aktiv') {
      query += ` AND k.status = 'aktiv'`;
    } else if (statusFilter === 'inaktiv') {
      query += ` AND (k.status IS NULL OR k.status != 'aktiv')`;
    }

    query += ` ORDER BY k.onboardingdatum DESC NULLS LAST, k.nachname ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/kontakte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kontakte/:id - einzelner Kontakt
app.get('/api/kontakte/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM kontakte WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/kontakte/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kontakte - neuer Kontakt
app.post('/api/kontakte', async (req, res) => {
  try {
    const fields = [
      'typ', 'kuerzel', 'vorname', 'nachname', 'email', 'email_2', 'telefon', 'mobilfon',
      'quelle', 'strasse', 'ort', 'land', 'gespraechspartner', 'paket',
      'nebenabreden', 'onboardingdatum', 'geburtsdatum', 'lebenszahl',
      'status', 'hinweise', 'anmerkungen', 'zusatzinfos', 'aktueller_stand',
      'aktiv', 'dateipfad', 'in_quentn', 'karriere_kompass_infos',
      'eg_geb', 'eg_am', 'geb_am'
    ];
    const data = req.body;
    data.typ = data.typ || 'kunde';
    data.datum_letzte_aenderung = new Date().toISOString();

    // Pflicht: Wer als Kunde angelegt wird, muss ein Kuerzel haben
    if (data.typ === 'kunde' && !(data.kuerzel || '').trim()) {
      return res.status(400).json({
        error: `Neue Kunden brauchen zwingend ein Kuerzel. Bitte Kuerzel eingeben, dann speichern.`
      });
    }

    const usedFields = fields.filter((f) => data[f] !== undefined);
    usedFields.push('datum_letzte_aenderung');

    const cols = usedFields.join(', ');
    const placeholders = usedFields.map((_, i) => `$${i + 1}`).join(', ');
    const values = usedFields.map((f) => data[f] === '' ? null : data[f]);

    const result = await pool.query(
      `INSERT INTO kontakte (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505' && /kuerzel/i.test(err.message || '')) {
      const kuerzelDup = req.body?.kuerzel || '';
      return res.status(409).json({
        error: `Kuerzel "${kuerzelDup}" ist bereits an einen anderen Kontakt vergeben. Bitte ein anderes Kuerzel waehlen.`
      });
    }
    console.error('POST /api/kontakte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/kontakte/:id - Kontakt aktualisieren
app.put('/api/kontakte/:id', async (req, res) => {
  try {
    const fields = [
      'kuerzel', 'vorname', 'nachname', 'email', 'telefon', 'mobilfon',
      'quelle', 'strasse', 'ort', 'land', 'gespraechspartner', 'paket',
      'nebenabreden', 'onboardingdatum', 'geburtsdatum', 'lebenszahl',
      'status', 'hinweise', 'anmerkungen', 'zusatzinfos', 'aktueller_stand',
      'aktiv', 'dateipfad', 'in_quentn', 'karriere_kompass_infos',
      'eg_geb', 'eg_am', 'geb_am'
    ];
    const data = req.body;
    data.datum_letzte_aenderung = new Date().toISOString();

    const usedFields = fields.filter((f) => data[f] !== undefined);
    usedFields.push('datum_letzte_aenderung');

    const setClauses = usedFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = usedFields.map((f) => data[f] === '' ? null : data[f]);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE kontakte SET ${setClauses} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    // Kuerzel-Dublette (case-insensitive UNIQUE-Index)
    if (err.code === '23505' && /kuerzel/i.test(err.message || '')) {
      const kuerzelDup = req.body?.kuerzel || '';
      return res.status(409).json({
        error: `Kuerzel "${kuerzelDup}" ist bereits an einen anderen Kontakt vergeben. Bitte ein anderes Kuerzel waehlen.`
      });
    }
    console.error('PUT /api/kontakte/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Kontakt-Bilder ---

// GET /api/kontakte/:id/bilder - Metadaten aller Bilder eines Kontakts
app.get('/api/kontakte/:id/bilder', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, kontakt_id, dateiname, mimetype, groesse_bytes, ist_hauptbild, erstellt_am
       FROM kontakt_bilder WHERE kontakt_id = $1
       ORDER BY ist_hauptbild DESC, erstellt_am DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET bilder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kontakte/:id/bilder - Bild hochladen (base64 im JSON-Body)
// Body: { dateiname, mimetype, daten_base64, ist_hauptbild }
app.post('/api/kontakte/:id/bilder', async (req, res) => {
  try {
    const { dateiname, mimetype, daten_base64, ist_hauptbild } = req.body;
    if (!daten_base64 || !mimetype) {
      return res.status(400).json({ error: 'daten_base64 und mimetype sind Pflicht' });
    }
    if (!mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Nur Bilder erlaubt (image/*)' });
    }
    const buffer = Buffer.from(daten_base64, 'base64');
    if (buffer.length > 12 * 1024 * 1024) {
      return res.status(400).json({ error: 'Bild zu gross (max. 12 MB)' });
    }

    // Wenn als Hauptbild markiert: bisheriges Hauptbild demoten
    if (ist_hauptbild) {
      await pool.query(
        'UPDATE kontakt_bilder SET ist_hauptbild = FALSE WHERE kontakt_id = $1 AND ist_hauptbild = TRUE',
        [req.params.id]
      );
    }

    // Wenn noch kein Hauptbild existiert, dieses automatisch zum Hauptbild machen
    let setAsMain = !!ist_hauptbild;
    if (!setAsMain) {
      const existing = await pool.query(
        'SELECT 1 FROM kontakt_bilder WHERE kontakt_id = $1 AND ist_hauptbild = TRUE LIMIT 1',
        [req.params.id]
      );
      if (existing.rows.length === 0) setAsMain = true;
    }

    const result = await pool.query(
      `INSERT INTO kontakt_bilder (kontakt_id, dateiname, mimetype, daten, groesse_bytes, ist_hauptbild)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kontakt_id, dateiname, mimetype, groesse_bytes, ist_hauptbild, erstellt_am`,
      [req.params.id, dateiname || null, mimetype, buffer, buffer.length, setAsMain]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST bilder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bilder/:id - Binaerdaten ausliefern
app.get('/api/bilder/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT daten, mimetype FROM kontakt_bilder WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).send('Nicht gefunden');
    const row = result.rows[0];
    res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(row.daten);
  } catch (err) {
    console.error('GET bild error:', err);
    res.status(500).send(err.message);
  }
});

// PUT /api/bilder/:id/hauptbild - als Hauptbild markieren
app.put('/api/bilder/:id/hauptbild', async (req, res) => {
  try {
    const info = await pool.query(
      'SELECT kontakt_id FROM kontakt_bilder WHERE id = $1',
      [req.params.id]
    );
    if (info.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    const kontaktId = info.rows[0].kontakt_id;
    await pool.query(
      'UPDATE kontakt_bilder SET ist_hauptbild = FALSE WHERE kontakt_id = $1',
      [kontaktId]
    );
    await pool.query(
      'UPDATE kontakt_bilder SET ist_hauptbild = TRUE WHERE id = $1',
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT hauptbild error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bilder/:id
app.delete('/api/bilder/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM kontakt_bilder WHERE id = $1 RETURNING kontakt_id, ist_hauptbild',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });

    // Falls Hauptbild geloescht: naechstes Bild zum Hauptbild machen
    const { kontakt_id, ist_hauptbild } = result.rows[0];
    if (ist_hauptbild) {
      await pool.query(
        `UPDATE kontakt_bilder SET ist_hauptbild = TRUE
         WHERE id = (SELECT id FROM kontakt_bilder WHERE kontakt_id = $1 ORDER BY erstellt_am DESC LIMIT 1)`,
        [kontakt_id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE bild error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Termine ---

// GET /api/kontakte/:id/termine
app.get('/api/kontakte/:id/termine', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM kundentermine WHERE kontakt_id = $1 ORDER BY datum DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET termine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kontakte/:id/termine
app.post('/api/kontakte/:id/termine', async (req, res) => {
  try {
    const data = req.body;
    const result = await pool.query(
      `INSERT INTO kundentermine (kontakt_id, kuerzel, einzel_paket, aktion, datum, inhalt, hausaufgabe, uebung, einzelpreis, einzeldauer, logbuch_versendet_am)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        req.params.id,
        data.kuerzel || null,
        data.einzel_paket || null,
        data.aktion || null,
        data.datum || null,
        data.inhalt || null,
        data.hausaufgabe || null,
        data.uebung || null,
        data.einzelpreis || null,
        data.einzeldauer || null,
        data.logbuch_versendet_am || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST termine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/termine/:id
app.put('/api/termine/:id', async (req, res) => {
  try {
    const data = req.body;
    const result = await pool.query(
      `UPDATE kundentermine SET
        kuerzel = $1, einzel_paket = $2, aktion = $3, datum = $4,
        inhalt = $5, hausaufgabe = $6, uebung = $7, einzelpreis = $8,
        einzeldauer = $9, logbuch_versendet_am = $10
       WHERE id = $11 RETURNING *`,
      [
        data.kuerzel || null,
        data.einzel_paket || null,
        data.aktion || null,
        data.datum || null,
        data.inhalt || null,
        data.hausaufgabe || null,
        data.uebung || null,
        data.einzelpreis || null,
        data.einzeldauer || null,
        data.logbuch_versendet_am || null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Termin nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT termine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/termine/:id
app.delete('/api/termine/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM kundentermine WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Termin nicht gefunden' });
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE termine error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Rechnungen ---

// GET /api/kontakte/:id/rechnungen
// Wenn Rechnung keine eigene bezeichnung/beschreibung hat, aus der produkte-Tabelle
// nachladen (COALESCE). So steht im PDF nie "P8" sondern immer der echte Text.
// Stornierte Rechnungen kommen mit (fuer Belegkette / Historie), sind aber durch
// storniert_am erkennbar und werden im UI grau/durchgestrichen dargestellt.
app.get('/api/kontakte/:id/rechnungen', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*,
              COALESCE(r.bezeichnung, p.bezeichnung)   AS bezeichnung,
              COALESCE(r.beschreibung, p.beschreibung) AS beschreibung
         FROM rechnungen r
         LEFT JOIN produkte p ON p.kuerzel = r.produkt_kuerzel
        WHERE r.kontakt_id = $1
        ORDER BY r.gestellt_am DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET rechnungen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rechnungen/naechste-nummer — naechste freie Rechnungsnummer
app.get('/api/rechnungen/naechste-nummer', async (req, res) => {
  try {
    const monat = req.query.monat || new Date().toISOString().slice(0, 7).replace('-', '.');
    const prefix = `RE-${monat}`;
    // Hoechste laufende Nummer ueber alle Monate
    const result = await pool.query(
      "SELECT rg_nr FROM rechnungen WHERE rg_nr LIKE 'RE-%' ORDER BY rg_nr DESC"
    );
    let maxNr = 0;
    for (const row of result.rows) {
      const teile = row.rg_nr.split('-');
      if (teile.length >= 3) {
        const nr = parseInt(teile[teile.length - 1], 10);
        if (!isNaN(nr) && nr > maxNr) maxNr = nr;
      }
    }
    res.json({ naechste_nummer: `${prefix}-${String(maxNr + 1).padStart(3, '0')}` });
  } catch (err) {
    console.error('naechste-nummer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kontakte/:id/rechnungen — Rechnungen erstellen (alle Raten auf einmal)
app.post('/api/kontakte/:id/rechnungen', async (req, res) => {
  const client = await pool.connect();
  try {
    const { produkt_kuerzel, bezeichnung, beschreibung, einleitungstext, danke_text,
            danke_text_teilrechnung,
            brutto_gesamt, anzahl_raten, faellig_tage, closer_name,
            abweichende_rechnungsadresse } = req.body;
    const kontaktId = req.params.id;

    // Kundendaten holen
    const kontaktRes = await client.query('SELECT * FROM kontakte WHERE id = $1', [kontaktId]);
    if (kontaktRes.rows.length === 0) return res.status(404).json({ error: 'Kontakt nicht gefunden' });
    const kontakt = kontaktRes.rows[0];

    // Raten berechnen (10er-Rundung wie in Access)
    const gesamt = parseFloat(brutto_gesamt);
    let folgeRate, ersteRate;
    if (anzahl_raten === 1) {
      ersteRate = gesamt;
      folgeRate = 0;
    } else {
      folgeRate = Math.floor(gesamt / anzahl_raten / 10) * 10;
      ersteRate = gesamt - (anzahl_raten - 1) * folgeRate;
    }

    // Hoechste Rechnungsnummer ermitteln
    const nrRes = await client.query(
      "SELECT rg_nr FROM rechnungen WHERE rg_nr LIKE 'RE-%' ORDER BY rg_nr DESC"
    );
    let maxNr = 0;
    for (const row of nrRes.rows) {
      const teile = row.rg_nr.split('-');
      if (teile.length >= 3) {
        const nr = parseInt(teile[teile.length - 1], 10);
        if (!isNaN(nr) && nr > maxNr) maxNr = nr;
      }
    }

    await client.query('BEGIN');
    const erstellteRechnungen = [];

    for (let i = 1; i <= anzahl_raten; i++) {
      const rateBetrag = i === 1 ? ersteRate : folgeRate;
      const rechnungsDatum = new Date();
      if (i > 1) rechnungsDatum.setMonth(rechnungsDatum.getMonth() + (i - 1));
      const faelligDatum = new Date(rechnungsDatum);
      faelligDatum.setDate(faelligDatum.getDate() + (faellig_tage || 5));

      maxNr++;
      const monatStr = `${rechnungsDatum.getFullYear()}.${String(rechnungsDatum.getMonth() + 1).padStart(2, '0')}`;
      const rgNr = `RE-${monatStr}-${String(maxNr).padStart(3, '0')}`;

      const netto = Math.round(rateBetrag / 1.19 * 100) / 100;
      const mwst = Math.round((rateBetrag - netto) * 100) / 100;

      const titel = anzahl_raten === 1 ? 'Rechnung' : `Rechnung - ${i}. Rate`;
      const kuerzel = kontakt.kuerzel || '';
      const pdfDateiname = `${kuerzel}_${rgNr}.pdf`;
      const jahr = rechnungsDatum.getFullYear();
      const pdfPfad = `G:\\Kunden\\Rechnungen\\Rgn ${jahr}\\${pdfDateiname}`;

      // Dank-Text: Rate 1 nutzt danke_text, Teilrechnungen (Rate 2+) nutzen
      // danke_text_teilrechnung (falls gesetzt). So kann der Kunde pro Rate
      // einen anderen Schlusstext sehen.
      const rateDankeText = (i === 1)
        ? (danke_text || null)
        : (danke_text_teilrechnung || danke_text || null);

      const insertRes = await client.query(
        `INSERT INTO rechnungen (kontakt_id, kuerzel, rg_nr, produkt_kuerzel, betrag,
         brutto_gesamt, netto, mwst, anzahl_raten, betrag_pro_rate, rate_nr, raten_gesamt,
         gestellt_am, faellig_am, closer_name, pdf_pfad, email,
         bezeichnung, beschreibung, einleitungstext, danke_text, abweichende_rechnungsadresse)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [kontaktId, kuerzel, rgNr, produkt_kuerzel, rateBetrag,
         gesamt, netto, mwst, anzahl_raten, folgeRate || gesamt, i, anzahl_raten,
         rechnungsDatum.toISOString().slice(0, 10),
         faelligDatum.toISOString().slice(0, 10),
         closer_name || null, pdfPfad, kontakt.email || '',
         bezeichnung || null, beschreibung || null, einleitungstext || null, rateDankeText,
         abweichende_rechnungsadresse || null]
      );

      // Wichtig: insertRes.rows[0] hat die korrekten per-Rate Werte
      // (insbesondere danke_text). NICHT pauschal mit den Body-Werten ueberschreiben!
      erstellteRechnungen.push({
        ...insertRes.rows[0],
        titel,
        // Kunde aus Kontakt-Tabelle, nicht aus Body (steht nicht in rechnungen.*)
        kunde_name: `${kontakt.vorname || ''} ${kontakt.nachname || ''}`.trim(),
        kunde_strasse: kontakt.strasse || '',
        kunde_plz_ort: `${kontakt.ort || ''}`,
        kunde_land: kontakt.land || 'DE',
      });
    }

    await client.query('COMMIT');

    // Nach erfolgreichem COMMIT: pro Rate eine Aufgabe in KK-ToDo anlegen.
    // Schlaegt das fehl, ist die Rechnung trotzdem korrekt — Todos sind nur Reminder.
    // Fuer ToDo-Titel: NUR Kuerzel verwenden (Kirsten-Regel: keine Langnamen
    // ausserhalb des Kundenprofils). Fallback: Nachname, wenn kein Kuerzel.
    const kundenLabel = kontakt.kuerzel || kontakt.nachname || '(unbekannt)';
    for (const r of erstellteRechnungen) {
      const rateInfo = r.raten_gesamt > 1 ? ` (Rate ${r.rate_nr}/${r.raten_gesamt})` : '';
      const betragStr = `${parseFloat(r.betrag).toFixed(2).replace('.', ',')} €`;
      const versandTag = toIsoDate(r.gestellt_am);
      const fallTag = toIsoDate(r.faellig_am);
      // Beide Datums-Felder bekommen den Versand-Tag (gestellt_am).
      // Die Rechnungs-Faelligkeit (faellig_am) steht in der Beschreibung.
      const todoId = await kkTodoCreate({
        title: `Rechnung ${r.rg_nr} an ${kundenLabel} versenden`,
        description: `${r.produkt_kuerzel}${rateInfo} — ${betragStr}\nRechnungs-Faelligkeit: ${fallTag}`,
        scheduledDate: versandTag,
        dueDate: versandTag,
        priority: 2,
      });
      if (todoId) {
        await pool.query('UPDATE rechnungen SET todo_id = $1 WHERE id = $2', [todoId, r.id]);
      }
    }

    res.json(erstellteRechnungen);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST rechnungen error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/rechnungen/:id — Rechnung aktualisieren
// Dynamisch: nur die uebergebenen Felder werden geaendert, der Rest bleibt.
app.put('/api/rechnungen/:id', async (req, res) => {
  try {
    const editable = ['erhalten_am', 'danke_text', 'einleitungstext',
                      'bezeichnung', 'beschreibung', 'gestellt_am', 'faellig_am',
                      'manuell_versendet_am', 'abweichende_rechnungsadresse',
                      'storniert_am', 'storno_grund', 'storno_referenz_id'];
    const setParts = [];
    const values = [];
    let p = 1;
    for (const feld of editable) {
      if (feld in req.body) {
        setParts.push(`${feld} = $${p++}`);
        values.push(req.body[feld] === '' ? null : req.body[feld]);
      }
    }
    if (setParts.length === 0) {
      return res.status(400).json({ error: 'Kein aenderbares Feld uebergeben' });
    }
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE rechnungen SET ${setParts.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    const updated = result.rows[0];

    // Wenn die Rechnung jetzt versendet (manuell oder webhook) oder bezahlt ist,
    // die zugehoerige Todo-Aufgabe auf erledigt setzen.
    const wurdeManuellVersendet = 'manuell_versendet_am' in req.body && req.body.manuell_versendet_am;
    const wurdeBezahlt = 'erhalten_am' in req.body && req.body.erhalten_am;
    if ((wurdeManuellVersendet || wurdeBezahlt) && updated.todo_id) {
      await kkTodoMarkDone(updated.todo_id);
    }

    res.json(updated);
  } catch (err) {
    console.error('PUT rechnungen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rechnungen/pdf — PDF generieren und zurueckgeben
app.post('/api/rechnungen/pdf', async (req, res) => {
  try {
    const params = req.body;
    const tmpDir = path.join(__dirname, '..', 'tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const pdfDatei = `rechnung_${Date.now()}.pdf`;
    const pdfPfad = path.join(tmpDir, pdfDatei);
    params.ausgabe_pfad = pdfPfad;

    const pythonScript = path.join(__dirname, 'rechnung_generator.py');
    const jsonStr = JSON.stringify(params);

    await new Promise((resolve, reject) => {
      const pythonBin = process.env.PYTHON_BIN || (existsSync('/var/www/kk-crm/venv/bin/python3') ? '/var/www/kk-crm/venv/bin/python3' : 'python');
      const proc = execFile(pythonBin, [pythonScript], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
      proc.stdin.write(jsonStr);
      proc.stdin.end();
    });

    res.sendFile(pdfPfad, (err) => {
      // Temp-Datei nach Senden loeschen
      try { unlinkSync(pdfPfad); } catch {}
    });
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Beim Versand auf das tatsaechliche Versanddatum aktualisieren:
//   - gestellt_am = heute
//   - faellig_am  = heute + altes Zahlungsziel (faellig_am - gestellt_am vorher)
// Bei Verspaetung > 0 zusaetzlich die uebergebenen Folge-Raten um genau dieselbe
// Tages-Differenz nach hinten schieben — ToDo-Aufgaben mitziehend.
// Liefert { tageDifferenz, neuGestelltStr, neuFaelligStr }.
async function aktualisiereVersandDatum(rechnungId, folgerateIds = []) {
  const r = await pool.query(
    'SELECT id, gestellt_am, faellig_am FROM rechnungen WHERE id = $1',
    [rechnungId]
  );
  if (r.rows.length === 0) throw new Error('Rechnung nicht gefunden');
  const alt = r.rows[0];
  const altGestellt = new Date(alt.gestellt_am);
  const altFaellig = new Date(alt.faellig_am);
  const zahlungsziel = Math.round((altFaellig - altGestellt) / 86400000);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const neuFaellig = new Date(heute);
  neuFaellig.setDate(neuFaellig.getDate() + zahlungsziel);
  const neuGestelltStr = toIsoDate(heute);
  const neuFaelligStr = toIsoDate(neuFaellig);
  const tageDifferenz = Math.round((heute - altGestellt) / 86400000);

  await pool.query(
    'UPDATE rechnungen SET gestellt_am = $1, faellig_am = $2 WHERE id = $3',
    [neuGestelltStr, neuFaelligStr, rechnungId]
  );

  if (folgerateIds.length > 0 && tageDifferenz > 0) {
    const fres = await pool.query(
      `UPDATE rechnungen
         SET gestellt_am = gestellt_am + make_interval(days => $1::int),
             faellig_am  = faellig_am  + make_interval(days => $1::int)
       WHERE id = ANY($2::int[])
       RETURNING id, todo_id, gestellt_am`,
      [tageDifferenz, folgerateIds]
    );
    for (const row of fres.rows) {
      if (row.todo_id) {
        const datum = toIsoDate(row.gestellt_am);
        await kkTodoUpdate(row.todo_id, { scheduledDate: datum, dueDate: datum });
      }
    }
  }

  return { tageDifferenz, neuGestelltStr, neuFaelligStr };
}

// POST /api/rechnungen/:id/stornieren — Rechnung stornieren
// Markiert die Original-Rechnung als storniert (`storniert_am`, `storno_grund`)
// und erstellt - falls erwuenscht - eine Stornorechnung mit negativem Betrag,
// neuer fortlaufender Rg-Nr und Bezug auf die Original-Rechnung. Beide bleiben
// in der DB fuer eine lueckenlose Belegkette.
//
// Body:
//   { grund?: 'Sammelzahlung ...', mit_stornorechnung?: true|false }
// Returns:
//   { ok: true, storno_rechnung_id: ID|null }
app.post('/api/rechnungen/:id/stornieren', async (req, res) => {
  const client = await pool.connect();
  try {
    const { grund, mit_stornorechnung } = req.body || {};
    await client.query('BEGIN');

    const orgRes = await client.query('SELECT * FROM rechnungen WHERE id = $1', [req.params.id]);
    if (orgRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }
    const org = orgRes.rows[0];
    if (org.storniert_am) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rechnung ist bereits storniert' });
    }

    // 1. Original-Rechnung als storniert markieren
    await client.query(
      `UPDATE rechnungen SET storniert_am = CURRENT_DATE, storno_grund = $1 WHERE id = $2`,
      [grund || null, org.id]
    );

    // Verknuepfte Todo-Aufgabe als erledigt setzen
    if (org.todo_id) {
      try { await kkTodoMarkDone(org.todo_id); } catch (e) { /* ignore */ }
    }

    let stornoRechnungId = null;
    if (mit_stornorechnung) {
      // Naechste fortlaufende Rg-Nr ermitteln
      const nrRes = await client.query(
        "SELECT rg_nr FROM rechnungen WHERE rg_nr LIKE 'RE-%' ORDER BY rg_nr DESC"
      );
      let maxNr = 0;
      for (const row of nrRes.rows) {
        const teile = row.rg_nr.split('-');
        if (teile.length >= 3) {
          const nr = parseInt(teile[teile.length - 1], 10);
          if (!isNaN(nr) && nr > maxNr) maxNr = nr;
        }
      }
      const heute = new Date();
      const monatStr = `${heute.getFullYear()}.${String(heute.getMonth() + 1).padStart(2, '0')}`;
      const stornoRgNr = `RE-${monatStr}-${String(maxNr + 1).padStart(3, '0')}`;
      const stornoBetrag = -Math.abs(parseFloat(org.betrag));
      const stornoBrutto = stornoBetrag;
      const stornoNetto = Math.round(stornoBrutto / 1.19 * 100) / 100;
      const stornoMwst = Math.round((stornoBrutto - stornoNetto) * 100) / 100;
      const heuteStr = heute.toISOString().slice(0, 10);
      const jahr = heute.getFullYear();
      const stornoPdfPfad = `G:\\Kunden\\Rechnungen\\Rgn ${jahr}\\${org.kuerzel}_${stornoRgNr}.pdf`;

      const insRes = await client.query(`
        INSERT INTO rechnungen (
          kontakt_id, kuerzel, rg_nr, produkt_kuerzel, betrag,
          brutto_gesamt, netto, mwst,
          gestellt_am, faellig_am,
          email, pdf_pfad,
          bezeichnung, beschreibung, danke_text,
          storno_referenz_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING id`,
        [org.kontakt_id, org.kuerzel, stornoRgNr, org.produkt_kuerzel, stornoBetrag,
         stornoBrutto, stornoNetto, stornoMwst,
         heuteStr, heuteStr,
         org.email, stornoPdfPfad,
         `Storno zu Rechnung ${org.rg_nr}`,
         `Diese Rechnung storniert die Rechnung ${org.rg_nr} vom ${toDeDate(org.gestellt_am)} vollstaendig. Der ausgewiesene Betrag ist negativ und mindert den urspruenglich abgerechneten Betrag.`,
         'Vielen Dank fuer Ihr Verstaendnis.',
         org.id]
      );
      stornoRechnungId = insRes.rows[0].id;
    }

    await client.query('COMMIT');
    res.json({ ok: true, storno_rechnung_id: stornoRechnungId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('stornieren error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/kontakte/:kontaktId/raten-terminieren
// Verschiebt alle noch offenen Raten einer Serie (gleiches produkt_kuerzel)
// so, dass die naechste ungesendete Rate am gewuenschten Datum gestellt wird.
// Weitere Raten folgen dann monatlich (setMonth+1). faellig_am wird mit
// gleichem Abstand zu gestellt_am mitgezogen.
// Betroffen sind nur Raten:
//   - noch nicht versendet (webhook_gesendet_am UND manuell_versendet_am NULL)
//   - noch nicht bezahlt (erhalten_am NULL)
//   - nicht storniert (storniert_am NULL, storno_referenz_id NULL)
//
// Body: { produkt_kuerzel: 'P8', erstes_datum: 'YYYY-MM-DD' }
// Returns: { ok: true, verschoben: [{ id, rg_nr, rate_nr, gestellt_am_alt, gestellt_am_neu }] }
app.post('/api/kontakte/:kontaktId/raten-terminieren', async (req, res) => {
  const client = await pool.connect();
  try {
    const { produkt_kuerzel, erstes_datum } = req.body || {};
    if (!produkt_kuerzel || !erstes_datum) {
      return res.status(400).json({ error: 'produkt_kuerzel und erstes_datum sind Pflicht' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(erstes_datum)) {
      return res.status(400).json({ error: 'erstes_datum muss YYYY-MM-DD sein' });
    }

    await client.query('BEGIN');

    // Alle offenen Raten der Serie holen, nach rate_nr sortiert
    const q = await client.query(`
      SELECT id, rg_nr, rate_nr, gestellt_am, faellig_am
      FROM rechnungen
      WHERE kontakt_id = $1
        AND produkt_kuerzel = $2
        AND webhook_gesendet_am IS NULL
        AND manuell_versendet_am IS NULL
        AND erhalten_am IS NULL
        AND storniert_am IS NULL
        AND storno_referenz_id IS NULL
      ORDER BY rate_nr ASC NULLS LAST, id ASC
    `, [req.params.kontaktId, produkt_kuerzel]);

    if (q.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Keine offenen Raten fuer diese Serie gefunden' });
    }

    const verschoben = [];
    for (let i = 0; i < q.rows.length; i++) {
      const r = q.rows[i];
      // Zieldatum: erstes_datum + i Monate
      const d = new Date(erstes_datum + 'T00:00:00');
      d.setMonth(d.getMonth() + i);
      const neuGestellt = d.toISOString().slice(0, 10);

      // faellig_am: gleiches Delta wie vorher (Zahlungsziel-Tage bleiben gleich)
      let neuFaellig = null;
      if (r.faellig_am && r.gestellt_am) {
        const alt_g = new Date(r.gestellt_am);
        const alt_f = new Date(r.faellig_am);
        const deltaTage = Math.round((alt_f - alt_g) / (1000 * 60 * 60 * 24));
        const fd = new Date(neuGestellt + 'T00:00:00');
        fd.setDate(fd.getDate() + deltaTage);
        neuFaellig = fd.toISOString().slice(0, 10);
      }

      await client.query(
        `UPDATE rechnungen SET gestellt_am = $1, faellig_am = $2 WHERE id = $3`,
        [neuGestellt, neuFaellig, r.id]
      );

      verschoben.push({
        id: r.id,
        rg_nr: r.rg_nr,
        rate_nr: r.rate_nr,
        gestellt_am_alt: r.gestellt_am ? new Date(r.gestellt_am).toISOString().slice(0, 10) : null,
        gestellt_am_neu: neuGestellt,
      });
    }

    await client.query('COMMIT');
    res.json({ ok: true, verschoben });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('raten-terminieren error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/rechnungen/:id/webhook — Webhook an Make senden
// Body (optional): { verschiebe_folge_raten: number[] } — IDs unversendeter Folge-Raten,
// die um die gleiche Versand-Verspaetung mitverschoben werden sollen.
app.post('/api/rechnungen/:id/webhook', async (req, res) => {
  try {
    const folgerateIds = Array.isArray(req.body?.verschiebe_folge_raten)
      ? req.body.verschiebe_folge_raten.map(Number).filter(Number.isInteger)
      : [];

    // JOIN mit kontakte, um die immer aktuelle Email zu bekommen.
    // rechnungen.email ist nur eine Momentaufnahme beim Anlegen — wenn der Kontakt
    // spaeter eine korrigierte Email bekommt, soll der Versand an die neue gehen.
    const result = await pool.query(
      `SELECT r.*, k.vorname, k.nachname, k.email AS kontakt_email
         FROM rechnungen r
         LEFT JOIN kontakte k ON r.kontakt_id = k.id
        WHERE r.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    const r = result.rows[0];
    // Aktuelle Kontakt-Email priorisieren — Fallback auf Rechnungs-Email
    const versandEmail = r.kontakt_email || r.email;

    // Neue Versand-Daten vorausberechnen (DB wird erst nach Webhook-Erfolg geaendert).
    const altGestellt = new Date(r.gestellt_am);
    const altFaellig = new Date(r.faellig_am);
    const zahlungsziel = Math.round((altFaellig - altGestellt) / 86400000);
    const heute = new Date();
    heute.setHours(0, 0, 0, 0);
    const neuFaellig = new Date(heute);
    neuFaellig.setDate(neuFaellig.getDate() + zahlungsziel);

    // Rechnungstyp fuer Make bestimmen — ein klares Feld, kein Rechnen ueber mehrere
    //   'einzel'       → Einzelrechnung (kein Paket)
    //   'paket-erst'   → erste Rechnung eines Pakets (mit Anhaengen, ausfuehrlicher Text)
    //   'paket-folge'  → Folge-Rate im Paket (nur Rechnung als Anhang, knapper Text)
    const istPaket = (r.produkt_kuerzel || '').toUpperCase().startsWith('P');
    let rechnungstyp = 'einzel';
    if (istPaket) {
      if (r.rate_nr && r.rate_nr > 1) rechnungstyp = 'paket-folge';
      else rechnungstyp = 'paket-erst';
    }

    const webhookUrl = 'https://hook.eu2.make.com/7ampgkqciw0z3f5ralsthwk5y399tnvu';
    const payload = {
      rgNr: r.rg_nr,
      email: versandEmail,
      vorname: r.vorname || '',
      nachname: r.nachname || '',
      betrag: parseFloat(r.betrag),
      rateNr: r.rate_nr,
      ratenGesamt: r.raten_gesamt,
      produktkuerzel: r.produkt_kuerzel,
      rechnungstyp,  // 'einzel' | 'paket-erst' | 'paket-folge'
      // Dateiname dynamisch aus aktuellem Kuerzel + RgNr — nicht aus pdf_pfad,
      // weil das eingefroren sein kann (falls Kuerzel nach Erstellung dazukam)
      pdfDateiname: `${r.kuerzel || ''}_${r.rg_nr}.pdf`,
      gestelltAm: toIsoDate(heute),
      faelligAm: toIsoDate(neuFaellig),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      // Erst nach Webhook-Erfolg: DB-Updates (Datum + Folge-Raten + Status + ToDo)
      await aktualisiereVersandDatum(req.params.id, folgerateIds);
      await pool.query('UPDATE rechnungen SET webhook_gesendet_am = NOW() WHERE id = $1', [req.params.id]);
      if (r.todo_id) await kkTodoMarkDone(r.todo_id);
    }

    res.json({ success: response.ok, status: response.status });
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rechnungen/:id/manuell-versenden — Markiert die Rechnung als manuell
// versendet (kein Make-Webhook). Setzt gestellt_am/faellig_am wie beim normalen
// Versand auf das tatsaechliche Versanddatum und verschiebt optional die Folge-Raten.
// Body (optional): { verschiebe_folge_raten: number[] }.
app.post('/api/rechnungen/:id/manuell-versenden', async (req, res) => {
  try {
    const folgerateIds = Array.isArray(req.body?.verschiebe_folge_raten)
      ? req.body.verschiebe_folge_raten.map(Number).filter(Number.isInteger)
      : [];

    await aktualisiereVersandDatum(req.params.id, folgerateIds);

    const result = await pool.query(
      'UPDATE rechnungen SET manuell_versendet_am = CURRENT_DATE WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    const updated = result.rows[0];
    if (updated.todo_id) await kkTodoMarkDone(updated.todo_id);

    res.json(updated);
  } catch (err) {
    console.error('manuell-versenden error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rechnungen/:id/paypal-bezahlt — Markiert die Rechnung als bezahlt
// (erhalten_am) UND erstellt einen passenden Eintrag in kontobewegungen, sodass
// der Eingang in Buchhaltung/Kontostand auftaucht. Ersetzt das vergessliche
// "in PayPal nachschauen + manuell als bezahlt klicken"-Pattern durch einen Klick.
//
// Body: { datum: 'YYYY-MM-DD', betrag: number }
app.post('/api/rechnungen/:id/paypal-bezahlt', async (req, res) => {
  const client = await pool.connect();
  try {
    const datum = (req.body?.datum || new Date().toLocaleDateString('sv-SE')).slice(0, 10);
    const betragInput = req.body?.betrag;
    const istTestzahlung = req.body?.testzahlung === true;

    await client.query('BEGIN');

    // Rechnung lesen + erhalten_am setzen
    const r = await client.query(
      'SELECT r.*, k.vorname, k.nachname FROM rechnungen r JOIN kontakte k ON k.id = r.kontakt_id WHERE r.id = $1',
      [req.params.id]
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }
    const rechnung = r.rows[0];
    const betrag = (betragInput != null) ? parseFloat(betragInput) : parseFloat(rechnung.betrag);

    await client.query(
      'UPDATE rechnungen SET erhalten_am = $1 WHERE id = $2',
      [datum, req.params.id]
    );

    // Eintrag in kontobewegungen — gleicher Aufbau wie Bank-Eingaenge,
    // aber konto/iban='PayPal' und steuerschluessel='U-112' wie bei Kunden-Zahlungen.
    const monat = parseInt(datum.slice(5, 7), 10);
    const quartal = Math.ceil(monat / 3);
    const name = `${rechnung.vorname || ''} ${rechnung.nachname || ''}`.trim();

    // Testzahlung: schreibt "Testzahlung" in beschreibung. Auswertungen filtern darauf.
    const beschreibung = istTestzahlung ? 'Testzahlung' : null;

    await client.query(
      `INSERT INTO kontobewegungen
       (buchungstag, valutadatum, quartal, betrag, steuerschluessel, schluessel,
        name_zahlungsbeteiligter, zugeordnet, verwendungszweck, beschreibung,
        konto, iban_auftragskonto, waehrung)
       VALUES ($1, $1, $2, $3, 'U-112', 'Kunde', $4, $5, $6, $7, 'PayPal', 'PayPal', 'EUR')`,
      [datum, quartal, betrag, name, rechnung.kuerzel || null,
       `PayPal — ${rechnung.rg_nr}`, beschreibung]
    );

    await client.query('COMMIT');

    if (rechnung.todo_id) await kkTodoMarkDone(rechnung.todo_id);

    res.json({ success: true, datum, betrag });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('paypal-bezahlt error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/produkte/:id — Produkt aktualisieren
app.put('/api/produkte/:id', async (req, res) => {
  try {
    const { bezeichnung, beschreibung, brutto_gesamt, termine } = req.body;
    const result = await pool.query(
      `UPDATE produkte SET bezeichnung=$1, beschreibung=$2, brutto_gesamt=$3, termine=$4
       WHERE id=$5 RETURNING *`,
      [bezeichnung, beschreibung, brutto_gesamt, termine, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produkt nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT produkte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Systembeteiligte ---

// GET /api/kontakte/:id/systembeteiligte
app.get('/api/kontakte/:id/systembeteiligte', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM systembeteiligte WHERE kontakt_id = $1 ORDER BY name ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET systembeteiligte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kontakte/:id/systembeteiligte
app.post('/api/kontakte/:id/systembeteiligte', async (req, res) => {
  try {
    const data = req.body;
    const result = await pool.query(
      `INSERT INTO systembeteiligte (kontakt_id, kuerzel, name, funktion, beschreibung)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, data.kuerzel || null, data.name || null, data.funktion || null, data.beschreibung || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST systembeteiligte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/systembeteiligte/:id
app.put('/api/systembeteiligte/:id', async (req, res) => {
  try {
    const data = req.body;
    const result = await pool.query(
      `UPDATE systembeteiligte SET kuerzel = $1, name = $2, funktion = $3, beschreibung = $4
       WHERE id = $5 RETURNING *`,
      [data.kuerzel || null, data.name || null, data.funktion || null, data.beschreibung || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT systembeteiligte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Auswertungen ---

// Offene Logbuecher: Termine wo logbuch_versendet_am NULL ist
app.get('/api/auswertungen/offene-logbuecher', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT kt.id, kt.kontakt_id, kt.kuerzel, kt.aktion, kt.datum, kt.inhalt,
             k.vorname, k.nachname
      FROM kundentermine kt
      JOIN kontakte k ON k.id = kt.kontakt_id
      WHERE kt.logbuch_versendet_am IS NULL
        AND k.typ = 'kunde'
        AND kt.datum IS NOT NULL
        AND kt.datum <= NOW()
        AND (kt.aktion ~ '^T[0-9]' OR kt.aktion ~ '^TS[0-9]')
      ORDER BY kt.datum DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('offene-logbuecher error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Offene Betraege: Rechnungen wo erhalten_am NULL ist
app.get('/api/auswertungen/offene-betraege', async (req, res) => {
  try {
    // "In Rechnung gestellt" = Rechnung ist tatsaechlich versendet (Webhook ODER manuell ODER bezahlt).
    // Eine Rechnung, die nur als DB-Datensatz existiert aber noch nicht raus ist, zaehlt als
    // "noch offen" — sie ist dem Kunden formal noch nicht gestellt.
    const result = await pool.query(`
      WITH rechnungs_status AS (
        SELECT
          r.*,
          (r.webhook_gesendet_am IS NOT NULL
           OR r.manuell_versendet_am IS NOT NULL
           OR r.erhalten_am IS NOT NULL) AS versendet
        FROM rechnungen r
      )
      SELECT r.kuerzel, k.vorname, k.nachname, k.id AS kontakt_id,
             MAX(r.brutto_gesamt)::numeric(10,2) AS vereinbart,
             SUM(CASE WHEN r.versendet THEN r.betrag ELSE 0 END)::numeric(10,2) AS in_rechnung_gestellt,
             (MAX(r.brutto_gesamt) - SUM(CASE WHEN r.versendet THEN r.betrag ELSE 0 END))::numeric(10,2) AS noch_offen,
             json_agg(json_build_object(
               'rg_nr', r.rg_nr,
               'betrag', r.betrag,
               'gestellt_am', r.gestellt_am,
               'versendet', r.versendet,
               'erhalten_am', r.erhalten_am
             ) ORDER BY r.rg_nr) AS raten
      FROM rechnungs_status r
      JOIN kontakte k ON k.id = r.kontakt_id
      WHERE r.brutto_gesamt IS NOT NULL AND r.brutto_gesamt > 0
        AND k.typ = 'kunde'
      GROUP BY r.kuerzel, k.vorname, k.nachname, k.id
      HAVING (MAX(r.brutto_gesamt) - SUM(CASE WHEN r.versendet THEN r.betrag ELSE 0 END)) > 5
        AND SUM(r.betrag) > 5  -- Kunden mit Netto-Null (Storno hebt Original auf) rausfiltern
      ORDER BY (MAX(r.brutto_gesamt) - SUM(CASE WHEN r.versendet THEN r.betrag ELSE 0 END)) DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('offene-betraege error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Offene Rechnungen (gleich wie offene Betraege, aber mit faellig_am)
// JOIN auf produkte fuer Bezeichnung+Beschreibung-Fallback (sonst stuende "P8" auf dem PDF)
// Stornierte Rechnungen werden ausgeblendet — die sind buchhalterisch erledigt.
// Test-Kontakt (Kürzel "Kika") wird ebenfalls ausgeblendet.
app.get('/api/auswertungen/offene-rechnungen', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.kontakt_id, r.kuerzel, r.rg_nr, r.betrag, r.brutto_gesamt,
             r.gestellt_am, r.faellig_am, r.erhalten_am,
             r.produkt_kuerzel, r.rate_nr, r.raten_gesamt, r.betrag_pro_rate,
             r.einleitungstext, r.danke_text,
             COALESCE(r.bezeichnung, p.bezeichnung)   AS bezeichnung,
             COALESCE(r.beschreibung, p.beschreibung) AS beschreibung,
             r.webhook_gesendet_am, r.manuell_versendet_am,
             r.storniert_am, r.storno_grund, r.storno_referenz_id,
             k.vorname, k.nachname, k.email,
             k.strasse AS kunde_strasse, k.ort AS kunde_ort, k.land AS kunde_land
        FROM rechnungen r
        JOIN kontakte k ON k.id = r.kontakt_id
        LEFT JOIN produkte p ON p.kuerzel = r.produkt_kuerzel
       WHERE r.erhalten_am IS NULL
         AND r.storniert_am IS NULL
         AND r.storno_referenz_id IS NULL
         AND k.typ = 'kunde'
         AND k.kuerzel <> 'Kika'
       ORDER BY r.gestellt_am DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('offene-rechnungen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Terminanzahl pro Kunde
app.get('/api/auswertungen/terminanzahl', async (req, res) => {
  try {
    // Termine = echte Coaching-/Einzeltermine. Mails, Aufgaben, Merker, HA, WA,
    // Info, Vorbereitung, Planung etc. zaehlen NICHT als Termin.
    const result = await pool.query(`
      SELECT k.id AS kontakt_id, k.kuerzel, k.vorname, k.nachname, k.paket,
             COUNT(kt.id) FILTER (
               WHERE kt.aktion IS NOT NULL
                 AND kt.aktion <> ''
                 AND kt.aktion NOT ILIKE 'mail%'
                 AND kt.aktion NOT IN ('Aufgabe', 'Info', 'Merker', 'HA', 'WA', 'Vorbereitung', 'Planung')
             ) AS anzahl_termine
      FROM kontakte k
      LEFT JOIN kundentermine kt ON kt.kontakt_id = k.id
      WHERE k.typ = 'kunde'
      GROUP BY k.id, k.kuerzel, k.vorname, k.nachname, k.paket
      ORDER BY anzahl_termine DESC, k.nachname ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('terminanzahl error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Neukunden: aktive Kunden, sortiert nach Onboardingdatum DESC
app.get('/api/auswertungen/neukunden', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, kuerzel, vorname, nachname, paket, email, onboardingdatum, quelle
      FROM kontakte
      WHERE typ = 'kunde' AND status = 'aktiv'
      ORDER BY onboardingdatum DESC NULLS LAST
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('neukunden error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Neukunden pro Monat (Aufstellung) — basiert auf geb_am (Buchungsdatum),
// Testkunde Kika und stornierte Kunden ausgeschlossen
app.get('/api/auswertungen/neukunden-pro-monat', async (req, res) => {
  try {
    // LOWER(status) NOT IN ('storniert', 'storno') — deckt beide Schreibweisen ab
    // Bericht startet ab 2024-01-01 (aeltere Eintraege sind Altdaten)
    const whereBasis = `
      typ = 'kunde'
      AND kuerzel <> 'Kika'
      AND (status IS NULL OR LOWER(status) NOT IN ('storniert', 'storno'))
    `;
    const mitDatum = await pool.query(`
      SELECT TO_CHAR(geb_am, 'YYYY-MM') AS monat,
             COUNT(*)::int AS anzahl,
             ARRAY_AGG(json_build_object(
               'id', id, 'kuerzel', kuerzel, 'vorname', vorname, 'nachname', nachname,
               'paket', paket, 'quelle', quelle, 'geb_am', geb_am, 'status', status
             ) ORDER BY geb_am ASC) AS kunden
      FROM kontakte
      WHERE ${whereBasis} AND geb_am >= DATE '2024-01-01'
      GROUP BY TO_CHAR(geb_am, 'YYYY-MM')
      ORDER BY monat DESC
    `);
    const ohneDatum = await pool.query(`
      SELECT id, kuerzel, vorname, nachname, paket, quelle, status,
             onboardingdatum, eg_am, eg_geb
      FROM kontakte
      WHERE ${whereBasis} AND geb_am IS NULL
      ORDER BY COALESCE(onboardingdatum, eg_am, eg_geb) DESC NULLS LAST, kuerzel
    `);
    res.json({
      monate: mitDatum.rows,
      ohneDatum: ohneDatum.rows,
    });
  } catch (err) {
    console.error('neukunden-pro-monat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Interessenten ---

// GET /api/interessenten - alle Interessenten
app.get('/api/interessenten', async (req, res) => {
  try {
    const { search, inkl_kunden } = req.query;
    // Wenn inkl_kunden=true, auch Kunden mit anzeigen (fuer Conversion-Auswertungen).
    // Default: nur reine Interessenten.
    const typFilter = inkl_kunden === 'true'
      ? `k.typ IN ('interessent', 'kunde')`
      : `k.typ = 'interessent'`;
    let query = `SELECT k.id, k.vorname, k.nachname, k.email, k.telefon, k.mobilfon,
                        k.typ, k.paket,
                        k.stand_interessent, k.quelle, k.datum_naechste_aktion, k.erstellungsdatum,
                        (SELECT MIN(ig.datum) FROM interessenten_gespraeche ig
                         WHERE ig.kontakt_id = k.id AND ig.cancelled_at IS NULL AND ig.datum >= NOW()
                        ) AS naechster_termin
                 FROM kontakte k
                 WHERE ${typFilter}`;
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(COALESCE(k.vorname,'')) LIKE $1 OR
        LOWER(COALESCE(k.nachname,'')) LIKE $1 OR
        LOWER(COALESCE(k.email,'')) LIKE $1 OR
        LOWER(COALESCE(k.name,'')) LIKE $1
      )`;
    }

    query += ` ORDER BY naechster_termin ASC NULLS LAST, k.erstellungsdatum DESC NULLS LAST, k.nachname ASC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/interessenten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interessenten/faellige-followups - ueberfaellige und heutige Follow-ups
app.get('/api/interessenten/faellige-followups', async (req, res) => {
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
    res.json(result.rows);
  } catch (err) {
    console.error('faellige-followups error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interessenten - neuer Interessent
app.post('/api/interessenten', async (req, res) => {
  try {
    const fields = [
      'vorname', 'nachname', 'kuerzel', 'email', 'email_2', 'telefon', 'mobilfon',
      'stand_interessent', 'quelle', 'hinweise', 'anmerkungen', 'notizen',
      'strasse', 'ort', 'land', 'datum_erstkontakt', 'datum_naechste_aktion',
      'paket'
    ];
    const data = req.body;
    data.typ = 'interessent';
    data.gespraechspartner = data.gespraechspartner || 'Kirsten';
    data.zustaendig = data.zustaendig || 'Kirsten';

    const usedFields = ['typ', 'gespraechspartner', 'zustaendig', ...fields.filter((f) => data[f] !== undefined)];
    const cols = usedFields.join(', ');
    const placeholders = usedFields.map((_, i) => `$${i + 1}`).join(', ');
    const values = usedFields.map((f) => data[f] === '' ? null : data[f]);

    const result = await pool.query(
      `INSERT INTO kontakte (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    const inserted = result.rows[0];

    // Wenn Folge-Aktion gesetzt ist → Follow-up-Todo anlegen
    if (data.datum_naechste_aktion) {
      await syncFollowupTodo(inserted, data.datum_naechste_aktion);
    }

    res.status(201).json(inserted);
  } catch (err) {
    if (err.code === '23505' && /kuerzel/i.test(err.message || '')) {
      const kuerzelDup = req.body?.kuerzel || '';
      return res.status(409).json({
        error: `Kuerzel "${kuerzelDup}" ist bereits an einen anderen Kontakt vergeben. Bitte ein anderes Kuerzel waehlen.`
      });
    }
    console.error('POST /api/interessenten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Follow-up-Todo synchronisieren mit kk-todo.
//   datum gesetzt:  Todo anlegen oder bestehendes auf neues Datum updaten
//   datum geloescht: bestehendes Todo auf erledigt setzen
async function syncFollowupTodo(kontakt, neuesDatum) {
  // Fuer ToDo-Titel: Kuerzel bevorzugen (Kirsten-Regel: keine Langnamen ausserhalb
  // Kundenprofil). Fallback: Nachname, dann Kontakt-ID. Vollname nur wenn nichts
  // anderes verfuegbar (typisch bei Interessenten ganz frueh im Prozess).
  const name = kontakt.kuerzel
    || kontakt.nachname
    || `${kontakt.vorname || ''} ${kontakt.nachname || ''}`.trim()
    || `Kontakt ${kontakt.id}`;
  const stand = kontakt.stand_interessent ? ` [${kontakt.stand_interessent}]` : '';
  const datumKurz = toIsoDate(neuesDatum);

  if (datumKurz) {
    if (kontakt.followup_todo_id) {
      // Existierendes Todo: nur Datum mitziehen
      await kkTodoUpdate(kontakt.followup_todo_id, { scheduledDate: datumKurz, dueDate: datumKurz });
    } else {
      // Neues Todo anlegen
      const todoId = await kkTodoCreate({
        title: `Follow-up: ${name}${stand}`,
        description: kontakt.notizen || '',
        scheduledDate: datumKurz,
        dueDate: datumKurz,
        priority: 2,
      });
      if (todoId) {
        await pool.query('UPDATE kontakte SET followup_todo_id = $1 WHERE id = $2', [todoId, kontakt.id]);
      }
    }
  } else if (kontakt.followup_todo_id) {
    // Datum wurde geloescht → bestehendes Todo erledigen + Verknuepfung loesen
    await kkTodoMarkDone(kontakt.followup_todo_id);
    await pool.query('UPDATE kontakte SET followup_todo_id = NULL WHERE id = $1', [kontakt.id]);
  }
}

// GET /api/interessenten/:id - einzelner Interessent mit Antworten und Gespraechen
app.get('/api/interessenten/:id', async (req, res) => {
  try {
    const kontaktRes = await pool.query('SELECT * FROM kontakte WHERE id = $1', [req.params.id]);
    if (kontaktRes.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });

    const antworten = await pool.query(
      'SELECT * FROM tidycal_antworten WHERE kontakt_id = $1 ORDER BY sortierung ASC, id ASC',
      [req.params.id]
    );
    const gespraeche = await pool.query(
      'SELECT * FROM interessenten_gespraeche WHERE kontakt_id = $1 ORDER BY datum DESC',
      [req.params.id]
    );

    res.json({
      ...kontaktRes.rows[0],
      tidycal_antworten: antworten.rows,
      gespraeche: gespraeche.rows,
    });
  } catch (err) {
    console.error('GET /api/interessenten/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interessenten/:id/mails - Mail-Verlauf mit dieser Interessentin.
// Synct vorher per IMAP mit dem kontakt@-Postfach (Strato), Fehler beim Sync
// sind nicht fatal - gespeicherte Mails werden trotzdem zurueckgegeben.
app.get('/api/interessenten/:id/mails', async (req, res) => {
  try {
    const kontaktRes = await pool.query('SELECT email FROM kontakte WHERE id = $1', [req.params.id]);
    if (kontaktRes.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });
    const email = kontaktRes.rows[0].email;

    let syncFehler = null;
    if (email) {
      try {
        const gefunden = await fetchMailsForAddress(email);
        for (const mail of gefunden) {
          const exists = await pool.query('SELECT id FROM mails WHERE outlook_id = $1', [mail.externalId]);
          if (exists.rows.length > 0) continue;
          await pool.query(
            `INSERT INTO mails (kontakt_id, kuerzel, emailadresse, betreff, inhalt, datum, richtung, outlook_id, zugeordnet)
             VALUES ($1, (SELECT kuerzel FROM kontakte WHERE id = $1), $2, $3, $4, $5, $6, $7, true)`,
            [req.params.id, email, mail.betreff, mail.inhalt, mail.datum, mail.richtung, mail.externalId]
          );
        }
      } catch (syncErr) {
        console.warn(`IMAP-Sync fuer Interessent ${req.params.id} fehlgeschlagen:`, syncErr.message);
        syncFehler = syncErr.message;
      }
    }

    const mailsRes = await pool.query('SELECT * FROM mails WHERE kontakt_id = $1 ORDER BY datum DESC', [req.params.id]);
    res.json({ mails: mailsRes.rows, syncFehler });
  } catch (err) {
    console.error('GET /api/interessenten/:id/mails error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interessenten/:id/followup-entwurf - Claude generiert einen
// editierbaren Follow-up-Mail-Entwurf aus Stichworten + Kontext.
app.post('/api/interessenten/:id/followup-entwurf', async (req, res) => {
  try {
    const { anrede, datumEG, stichworte } = req.body;
    if (!stichworte || !stichworte.trim()) {
      return res.status(400).json({ error: 'Stichworte duerfen nicht leer sein' });
    }

    const kontaktRes = await pool.query('SELECT * FROM kontakte WHERE id = $1', [req.params.id]);
    if (kontaktRes.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });
    const kontakt = kontaktRes.rows[0];

    const gespraechRes = await pool.query(
      'SELECT protokoll_eigen FROM interessenten_gespraeche WHERE kontakt_id = $1 ORDER BY datum DESC LIMIT 1',
      [req.params.id]
    );
    const egZusammenfassung = gespraechRes.rows[0]?.protokoll_eigen || '';

    const mailsRes = await pool.query('SELECT * FROM mails WHERE kontakt_id = $1 ORDER BY datum DESC LIMIT 6', [req.params.id]);

    const entwurf = await generateFollowupDraft({
      vorname: kontakt.vorname || kontakt.name,
      anrede: anrede || 'du',
      datumEG: datumEG || kontakt.eg_am,
      stichworte,
      egZusammenfassung,
      bisherigeMails: mailsRes.rows.reverse(),
    });

    res.json(entwurf);
  } catch (err) {
    console.error('POST /api/interessenten/:id/followup-entwurf error:', err);
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY ist auf dem Server nicht konfiguriert.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interessenten/:id/followup-senden - versendet den (ggf. editierten)
// Entwurf per SMTP an die Interessentin und speichert ihn als gesendete Mail.
app.post('/api/interessenten/:id/followup-senden', async (req, res) => {
  try {
    const { betreff, text } = req.body;
    if (!betreff || !text) return res.status(400).json({ error: 'Betreff und Text duerfen nicht leer sein' });

    const kontaktRes = await pool.query('SELECT email, kuerzel FROM kontakte WHERE id = $1', [req.params.id]);
    if (kontaktRes.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });
    const { email, kuerzel } = kontaktRes.rows[0];
    if (!email) return res.status(400).json({ error: 'Kein E-Mail-Adresse fuer diesen Kontakt hinterlegt' });

    await sendMail({ to: email, subject: betreff, text });

    await pool.query(
      `INSERT INTO mails (kontakt_id, kuerzel, emailadresse, betreff, inhalt, datum, richtung, zugeordnet)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'ausgehend', true)`,
      [req.params.id, kuerzel, email, betreff, text]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/interessenten/:id/followup-senden error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/interessenten/:id - Interessent aktualisieren
app.put('/api/interessenten/:id', async (req, res) => {
  try {
    const fields = [
      'vorname', 'nachname', 'kuerzel', 'email', 'email_2', 'telefon', 'mobilfon',
      'stand_interessent', 'quelle', 'hinweise', 'anmerkungen', 'notizen',
      'strasse', 'ort', 'land', 'datum_erstkontakt', 'datum_naechste_aktion',
      'paket'
    ];
    const data = req.body;
    data.datum_letzte_aenderung = new Date().toISOString();

    // Auto-Promotion: Wenn Stand auf 'KU' (Gekauft) gesetzt wird, wird der Kontakt
    // automatisch zur Kundin. Stand "Gebucht" gibt es nicht mehr - wer gekauft hat, ist Kunde.
    // Dabei wird geb_am (= Tag, an dem der Interessent zur Kundin wurde) nur gesetzt,
    // falls es noch leer ist - einmal gesetzt, nie ueberschrieben.
    if (data.stand_interessent === 'KU') {
      // Pflichtfeld 1: Kuerzel muss gesetzt sein
      // Pflichtfeld 2: Paket muss gesetzt sein (was wurde gekauft?)
      const check = await pool.query('SELECT kuerzel, paket FROM kontakte WHERE id = $1', [req.params.id]);
      const row = check.rows[0] || {};
      const effektivKuerzel = ((data.kuerzel !== undefined ? data.kuerzel : row.kuerzel) || '').trim();
      const effektivPaket = ((data.paket !== undefined ? data.paket : row.paket) || '').trim();
      if (!effektivKuerzel) {
        return res.status(400).json({
          error: `Umwandlung zum Kunden nicht moeglich: Kuerzel fehlt. Bitte erst ein Kuerzel setzen, dann den Stand auf "Gekauft" aendern.`
        });
      }
      if (!effektivPaket) {
        return res.status(400).json({
          error: `Umwandlung zum Kunden nicht moeglich: Paket fehlt. Bitte angeben, was gekauft wurde (P4, P8, Einzel, KNeu, ...).`
        });
      }
      data.typ = 'kunde';
      const current = await pool.query('SELECT geb_am, status FROM kontakte WHERE id = $1', [req.params.id]);
      if (current.rows.length > 0) {
        if (!current.rows[0].geb_am) {
          data.geb_am = new Date().toISOString().substring(0, 10);
        }
        // Auto-Status: neue Kundinnen starten standardmaessig als 'aktiv' (nur wenn noch leer)
        if (!current.rows[0].status && !data.status) {
          data.status = 'aktiv';
        }
      }
    }

    const allFields = [...fields, 'typ', 'geb_am', 'status'];
    const usedFields = allFields.filter((f) => data[f] !== undefined);
    usedFields.push('datum_letzte_aenderung');

    const setClauses = usedFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = usedFields.map((f) => data[f] === '' ? null : data[f]);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE kontakte SET ${setClauses} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });
    const updated = result.rows[0];

    // Follow-up-Todo synchronisieren, wenn datum_naechste_aktion in dieser
    // Aenderung vorkam (gesetzt oder geloescht).
    if ('datum_naechste_aktion' in data) {
      await syncFollowupTodo(updated, updated.datum_naechste_aktion);
    }

    res.json(updated);
  } catch (err) {
    if (err.code === '23505' && /kuerzel/i.test(err.message || '')) {
      const kuerzelDup = req.body?.kuerzel || '';
      return res.status(409).json({
        error: `Kuerzel "${kuerzelDup}" ist bereits an einen anderen Kontakt vergeben. Bitte ein anderes Kuerzel waehlen.`
      });
    }
    console.error('PUT /api/interessenten/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interessenten/:id/gespraeche - neues Gespraech anlegen
app.post('/api/interessenten/:id/gespraeche', async (req, res) => {
  try {
    const { datum, typ, meeting_url, protokoll_eigen } = req.body;
    // Kuerzel vom Kontakt holen
    const kontaktRes = await pool.query('SELECT kuerzel FROM kontakte WHERE id = $1', [req.params.id]);
    const kuerzel = kontaktRes.rows.length > 0 ? kontaktRes.rows[0].kuerzel : null;

    const result = await pool.query(
      `INSERT INTO interessenten_gespraeche (kontakt_id, kuerzel, datum, typ, meeting_url, protokoll_eigen)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, kuerzel, datum || null, typ || 'Erstgespraech', meeting_url || null, protokoll_eigen || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST interessenten-gespraeche error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/interessenten/:id - Interessent loeschen
app.delete('/api/interessenten/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM kontakte WHERE id = $1 AND typ = $2 RETURNING id', [req.params.id, 'interessent']);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Interessent nicht gefunden' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /api/interessenten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/interessenten-gespraeche/:id - einzelnes Gespraech loeschen
app.delete('/api/interessenten-gespraeche/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM interessenten_gespraeche WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Gespraech nicht gefunden' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE interessenten-gespraeche error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/interessenten-gespraeche/:id - Gespraech aktualisieren (Protokoll + Typ)
app.put('/api/interessenten-gespraeche/:id', async (req, res) => {
  try {
    const { protokoll_eigen, protokoll_zoom, typ, datum, meeting_url } = req.body;
    const result = await pool.query(
      `UPDATE interessenten_gespraeche SET protokoll_eigen = $1, protokoll_zoom = $2, typ = COALESCE($3, typ), datum = COALESCE($4, datum), meeting_url = COALESCE($5, meeting_url) WHERE id = $6 RETURNING *`,
      [protokoll_eigen || null, protokoll_zoom || null, typ || null, datum || null, meeting_url || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Gespraech nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT interessenten-gespraeche error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- TidyCal-Antworten CRUD ---

// POST /api/interessenten/:id/antworten - neue Antwort anlegen
app.post('/api/interessenten/:id/antworten', async (req, res) => {
  try {
    const { frage, antwort } = req.body;
    // Naechste Sortierung ermitteln
    const maxSort = await pool.query(
      'SELECT COALESCE(MAX(sortierung), 0) + 1 AS next FROM tidycal_antworten WHERE kontakt_id = $1',
      [req.params.id]
    );
    const sortierung = maxSort.rows[0].next;
    const result = await pool.query(
      'INSERT INTO tidycal_antworten (kontakt_id, frage, antwort, sortierung) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, frage || '', antwort || '', sortierung]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST tidycal-antworten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tidycal-antworten/:id - Antwort aktualisieren
app.put('/api/tidycal-antworten/:id', async (req, res) => {
  try {
    const { frage, antwort } = req.body;
    const result = await pool.query(
      'UPDATE tidycal_antworten SET frage = $1, antwort = $2 WHERE id = $3 RETURNING *',
      [frage || '', antwort || '', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Antwort nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT tidycal-antworten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tidycal-antworten/:id - Antwort loeschen
app.delete('/api/tidycal-antworten/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM tidycal_antworten WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Antwort nicht gefunden' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('DELETE tidycal-antworten error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Zahlungsabgleich ---

// GET /api/zahlungsabgleich/vorschau - zeigt Matches ohne etwas zu aendern
app.get('/api/zahlungsabgleich/vorschau', async (req, res) => {
  try {
    // 1. Match ueber RgNr im Verwendungszweck
    const rgNrMatches = await pool.query(`
      SELECT r.id AS rechnung_id, r.rg_nr, r.kuerzel, r.betrag AS rg_betrag,
             kb.id AS kb_id, kb.buchungstag, kb.betrag AS bank_betrag,
             kb.name_zahlungsbeteiligter, kb.verwendungszweck,
             'rgnr' AS match_typ
      FROM rechnungen r
      JOIN kontobewegungen kb ON kb.verwendungszweck ILIKE '%' || r.rg_nr || '%'
      WHERE r.erhalten_am IS NULL
        AND r.rg_nr IS NOT NULL AND r.rg_nr != ''
        AND kb.betrag > 0
      ORDER BY kb.buchungstag DESC
    `);

    // 2. Fallback: Match ueber Name -> Kuerzel + Betrag
    //    Nur fuer Rechnungen die nicht schon per RgNr gematcht wurden
    const matchedRgIds = rgNrMatches.rows.map(r => r.rechnung_id);
    const placeholders = matchedRgIds.length > 0
      ? 'AND r.id NOT IN (' + matchedRgIds.join(',') + ')'
      : '';

    const nameMatches = await pool.query(`
      SELECT r.id AS rechnung_id, r.rg_nr, r.kuerzel, r.betrag AS rg_betrag,
             kb.id AS kb_id, kb.buchungstag, kb.betrag AS bank_betrag,
             kb.name_zahlungsbeteiligter, kb.verwendungszweck,
             'name_betrag' AS match_typ
      FROM rechnungen r
      JOIN kontakte k ON k.id = r.kontakt_id
      JOIN kontobewegungen kb ON kb.betrag = r.betrag
        AND (
          kb.zugeordnet = r.kuerzel
          OR LOWER(kb.name_zahlungsbeteiligter) LIKE '%' || LOWER(k.nachname) || '%'
        )
      WHERE r.erhalten_am IS NULL
        AND r.rg_nr IS NOT NULL AND r.rg_nr != ''
        AND kb.betrag > 0
        AND kb.schluessel = 'Kunde'
        ${placeholders}
      ORDER BY kb.buchungstag DESC
    `);

    res.json({
      rgnr_matches: rgNrMatches.rows,
      name_matches: nameMatches.rows,
      total: rgNrMatches.rows.length + nameMatches.rows.length,
    });
  } catch (err) {
    console.error('zahlungsabgleich vorschau error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zahlungsabgleich/ausfuehren - setzt erhalten_am fuer bestaetigte Matches
app.post('/api/zahlungsabgleich/ausfuehren', async (req, res) => {
  try {
    const { matches } = req.body; // Array von { rechnung_id, buchungstag }
    if (!matches || !Array.isArray(matches)) {
      return res.status(400).json({ error: 'matches Array erforderlich' });
    }
    let updated = 0;
    for (const m of matches) {
      const result = await pool.query(
        'UPDATE rechnungen SET erhalten_am = $1 WHERE id = $2 AND erhalten_am IS NULL RETURNING id, kuerzel',
        [m.buchungstag, m.rechnung_id]
      );
      if (result.rows.length > 0) {
        updated++;
        // Kuerzel in Kontobewegung schreiben
        if (m.kb_id && result.rows[0].kuerzel) {
          await pool.query('UPDATE kontobewegungen SET zugeordnet = $1 WHERE id = $2', [result.rows[0].kuerzel, m.kb_id]);
        }
      }
    }
    res.json({ updated });
  } catch (err) {
    console.error('zahlungsabgleich ausfuehren error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Kontobewegungen ---

// GET /api/kontobewegungen - alle Buchungen mit optionaler Filterung
app.get('/api/kontobewegungen', async (req, res) => {
  try {
    const { schluessel, suche, von, bis, konto, limit: lim } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (schluessel) {
      if (schluessel === '_leer') {
        where.push(`(schluessel IS NULL OR schluessel = '')`);
      } else {
        where.push(`schluessel = $${idx++}`);
        params.push(schluessel);
      }
    }
    if (suche) {
      where.push(`(name_zahlungsbeteiligter ILIKE $${idx} OR verwendungszweck ILIKE $${idx} OR beschreibung ILIKE $${idx} OR zugeordnet ILIKE $${idx})`);
      params.push(`%${suche}%`);
      idx++;
    }
    if (von) {
      where.push(`buchungstag >= $${idx++}`);
      params.push(von);
    }
    if (bis) {
      where.push(`buchungstag <= $${idx++}`);
      params.push(bis);
    }
    if (konto) {
      where.push(`iban_auftragskonto = $${idx++}`);
      params.push(konto);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    // Default-Limit hoch genug, um ALLE Buchungen auszuliefern — Frontend-Summen muessen stimmen
    const limitClause = lim ? `LIMIT ${parseInt(lim)}` : 'LIMIT 100000';

    const result = await pool.query(
      `SELECT * FROM kontobewegungen ${whereClause} ORDER BY buchungstag DESC, id DESC ${limitClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET kontobewegungen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ust-export - USt-relevante Buchungen als Excel-Download (.xlsx)
app.get('/api/ust-export', async (req, res) => {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const { von, bis } = req.query;
    let where = [];
    let params = [];
    let idx = 1;
    if (von) { where.push(`buchungstag >= $${idx++}`); params.push(von); }
    if (bis) { where.push(`buchungstag <= $${idx++}`); params.push(bis); }
    // Testzahlungen generell ausschliessen
    where.push(`(beschreibung IS NULL OR beschreibung NOT ILIKE '%testzahlung%')`);
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const result = await pool.query(
      `SELECT buchungstag, valutadatum, quartal, steuerschluessel, zugeordnet,
              betrag, verwendungszweck, schluessel, beschreibung, detail,
              name_zahlungsbeteiligter, iban_auftragskonto
       FROM kontobewegungen ${whereClause}
       ORDER BY buchungstag ASC, id ASC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('USt-Export');

    // Spalten definieren
    sheet.columns = [
      { header: 'Buchungstag',            key: 'buchungstag',             width: 14 },
      { header: 'Valuta',                 key: 'valuta',                  width: 14 },
      { header: 'gezVorsteuer',           key: 'gezVorsteuer',            width: 14 },
      { header: 'EÜR',                    key: 'euer',                    width: 14 },
      { header: 'Quartal',                key: 'quartal',                 width: 10 },
      { header: 'Steuerschlüssel',        key: 'steuerschluessel',        width: 16 },
      { header: 'Zugeordnet',             key: 'zugeordnet',              width: 12 },
      { header: 'Betrag',                 key: 'betrag',                  width: 14 },
      { header: 'Netto',                  key: 'netto',                   width: 14 },
      { header: 'MwSt',                   key: 'mwst',                    width: 14 },
      { header: 'Verwendungszweck',       key: 'verwendungszweck',        width: 50 },
      { header: 'Schlüssel',              key: 'schluessel',              width: 18 },
      { header: 'Beschreibung',           key: 'beschreibung',            width: 22 },
      { header: 'Detail',                 key: 'detail',                  width: 18 },
      { header: 'Name Zahlungsbeteiligter', key: 'name',                  width: 30 },
      { header: 'Konto',                  key: 'konto',                   width: 28 },
    ];

    // Header-Zeile fett
    sheet.getRow(1).font = { bold: true };

    const fmtDate = (v) => {
      if (!v) return '';
      if (v instanceof Date) {
        const d = String(v.getDate()).padStart(2, '0');
        const m = String(v.getMonth() + 1).padStart(2, '0');
        return `${d}.${m}.${v.getFullYear()}`;
      }
      const s = String(v);
      const parts = s.slice(0, 10).split('-');
      if (parts.length !== 3) return '';
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    };

    const eurFmt = '#,##0.00 "€"';

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const excelRow = i + 2; // Zeile 1 = Header
      const betrag = parseFloat(row.betrag) || 0;
      const netto  = betrag / 1.19;
      const mwst   = betrag - netto;
      let quartal  = row.quartal ? parseInt(row.quartal) : null;
      if (!quartal && row.buchungstag) {
        const monat = parseInt(String(row.buchungstag).slice(5, 7));
        quartal = Math.ceil(monat / 3);
      }

      // Steuerschluessel-Spalte ist F (Spalte 6)
      const stSchlRef = `F${excelRow}`;
      const gezFormel = `ODER(IDENTISCH(${stSchlRef};Schlüssel_gez_Vorsteuer[Schlüssel für gezahlte Vorsteuerbeträge (U-185)]))`;
      const euerFormel = `ODER(IDENTISCH(${stSchlRef};Schlüssel_EUeR[[#Alle];[Schlüssel EÜR Ausgaben]]))`;

      const r = sheet.addRow([
        fmtDate(row.buchungstag),   // A
        fmtDate(row.valutadatum),   // B
        null,                        // C gezVorsteuer — Formel wird unten gesetzt
        null,                        // D EÜR — Formel wird unten gesetzt
        quartal,                     // E
        row.steuerschluessel || '', // F
        row.zugeordnet || '',       // G
        Math.round(betrag * 100) / 100, // H
        Math.round(netto * 100) / 100,  // I
        Math.round(mwst * 100) / 100,   // J
        row.verwendungszweck || '',     // K
        row.schluessel || '',           // L
        row.beschreibung || '',         // M
        row.detail || '',               // N
        row.name_zahlungsbeteiligter || '', // O
        row.iban_auftragskonto || '',   // P
      ]);

      // Quartal als Ganzzahl
      r.getCell(5).numFmt = '0';
      // Betrag/Netto/MwSt als Währung
      r.getCell(8).numFmt = eurFmt;
      r.getCell(9).numFmt = eurFmt;
      r.getCell(10).numFmt = eurFmt;
      // Formel-Text (ohne fuehrendes =, damit Excel kein defektes XML erzeugt)
      // Einmalig in Excel: Spalte markieren -> Suchen/Ersetzen -> '' durch '=' ersetzen
      r.getCell(3).value = '=' + gezFormel;
      r.getCell(4).value = '=' + euerFormel;
    }

    const dateiname = `USt-Export_${von || 'alle'}_${bis || 'alle'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET ust-export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kontobewegungen/schluessel - alle vorhandenen Schluessel
app.get('/api/kontobewegungen/schluessel', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT schluessel, COUNT(*) AS anzahl FROM kontobewegungen
       WHERE schluessel IS NOT NULL AND schluessel != ''
       GROUP BY schluessel ORDER BY schluessel`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET schluessel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/kontobewegungen/:id - Kategorisierung bearbeiten
app.put('/api/kontobewegungen/:id', async (req, res) => {
  try {
    const { steuerschluessel, schluessel, beschreibung, zugeordnet, detail } = req.body;
    const result = await pool.query(
      `UPDATE kontobewegungen SET steuerschluessel = $1, schluessel = $2, beschreibung = $3, zugeordnet = $4, detail = $5
       WHERE id = $6 RETURNING *`,
      [steuerschluessel ?? null, schluessel ?? null, beschreibung ?? null, zugeordnet ?? null, detail ?? null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT kontobewegungen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Kontostand (echter Bankstand = Anfangssaldo + Bewegungen bis Stichtag) ---

// GET /api/kontostand?bis=YYYY-MM-DD&konto=IBAN
// Berechnet pro Konto: jungster Anfangssaldo <= bis + Summe aller Bewegungen seit Anfangssaldo bis Stichtag.
// Ohne Konto-Filter: aggregiert ueber alle Konten, die einen Anfangssaldo haben.
app.get('/api/kontostand', async (req, res) => {
  try {
    const bis = req.query.bis || new Date().toISOString().substring(0, 10);
    const konto = req.query.konto || null;

    // Juengste Anfangssalden je Konto, die <= bis liegen
    const saldenQ = konto
      ? `SELECT DISTINCT ON (iban_auftragskonto) iban_auftragskonto, stichtag, saldo, bemerkung
         FROM kontosalden WHERE stichtag <= $1 AND iban_auftragskonto = $2
         ORDER BY iban_auftragskonto, stichtag DESC`
      : `SELECT DISTINCT ON (iban_auftragskonto) iban_auftragskonto, stichtag, saldo, bemerkung
         FROM kontosalden WHERE stichtag <= $1
         ORDER BY iban_auftragskonto, stichtag DESC`;
    const params = konto ? [bis, konto] : [bis];
    const saldenRes = await pool.query(saldenQ, params);

    let gesamt = 0;
    const details = [];
    for (const s of saldenRes.rows) {
      const anfang = parseFloat(s.saldo);
      const bew = await pool.query(
        `SELECT COALESCE(SUM(betrag), 0)::numeric(14,2) AS summe
         FROM kontobewegungen
         WHERE iban_auftragskonto = $1 AND buchungstag > $2 AND buchungstag <= $3
           AND (LOWER(COALESCE(beschreibung, '')) NOT LIKE '%testzahlung%')`,
        [s.iban_auftragskonto, s.stichtag, bis]
      );
      const bewegungenSumme = parseFloat(bew.rows[0].summe);
      const kontoStand = anfang + bewegungenSumme;
      gesamt += kontoStand;
      details.push({
        iban: s.iban_auftragskonto,
        anfangssaldoDatum: s.stichtag,
        anfangssaldo: anfang,
        bewegungenSumme,
        kontostand: kontoStand,
        bemerkung: s.bemerkung || null,
      });
    }

    res.json({ bis, gesamt, konten: details });
  } catch (err) {
    console.error('GET kontostand error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Kategorisierungsregeln ---

app.get('/api/kategorisierungsregeln', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM kategorisierungsregeln ORDER BY prioritaet, id');
    res.json(result.rows);
  } catch (err) {
    console.error('GET regeln error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/verschluesselung/vorschlaege — Distinct-Werte aus Regeln + bestehenden
// Buchungen + Kundenkuerzel, fuer Dropdowns auf Kontobewegungen/Kategorisierungsregeln
app.get('/api/verschluesselung/vorschlaege', async (req, res) => {
  try {
    // Kombinationen (Haupt-Quelle = Regeln, Fallback = bereits verschluesselte Buchungen)
    const kombRes = await pool.query(`
      SELECT DISTINCT steuerschluessel, schluessel, beschreibung
      FROM (
        SELECT steuerschluessel, schluessel, beschreibung FROM kategorisierungsregeln WHERE aktiv = true
        UNION
        SELECT steuerschluessel, schluessel, beschreibung FROM kontobewegungen
          WHERE schluessel IS NOT NULL AND schluessel <> ''
      ) x
      ORDER BY schluessel NULLS LAST, beschreibung NULLS LAST, steuerschluessel NULLS LAST
    `);
    const kuerzelRes = await pool.query(
      `SELECT kuerzel FROM kontakte WHERE kuerzel IS NOT NULL AND kuerzel <> '' ORDER BY kuerzel`
    );

    const kombinationen = kombRes.rows.map(r => ({
      steuerschluessel: r.steuerschluessel || '',
      schluessel: r.schluessel || '',
      beschreibung: r.beschreibung || '',
    }));
    const uniq = (key) => [...new Set(kombinationen.map(k => k[key]).filter(Boolean))].sort();

    res.json({
      steuerschluessel: uniq('steuerschluessel'),
      schluessel: uniq('schluessel'),
      beschreibung: uniq('beschreibung'),
      kombinationen,
      kuerzel: kuerzelRes.rows.map(r => r.kuerzel),
    });
  } catch (err) {
    console.error('GET verschluesselung/vorschlaege error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kategorisierungsregeln', async (req, res) => {
  try {
    const { name_pattern, zweck_pattern, betrag_von, betrag_bis, steuerschluessel, schluessel, beschreibung, prioritaet } = req.body;
    const result = await pool.query(
      `INSERT INTO kategorisierungsregeln (name_pattern, zweck_pattern, betrag_von, betrag_bis, steuerschluessel, schluessel, beschreibung, prioritaet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name_pattern||null, zweck_pattern||null, betrag_von??null, betrag_bis??null, steuerschluessel||null, schluessel||null, beschreibung||null, prioritaet||100]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/kategorisierungsregeln/:id', async (req, res) => {
  try {
    const { name_pattern, zweck_pattern, betrag_von, betrag_bis, steuerschluessel, schluessel, beschreibung, prioritaet, aktiv } = req.body;
    const result = await pool.query(
      `UPDATE kategorisierungsregeln SET name_pattern=$1, zweck_pattern=$2, betrag_von=$3, betrag_bis=$4,
       steuerschluessel=$5, schluessel=$6, beschreibung=$7, prioritaet=$8, aktiv=$9 WHERE id=$10 RETURNING *`,
      [name_pattern||null, zweck_pattern||null, betrag_von??null, betrag_bis??null,
       steuerschluessel||null, schluessel||null, beschreibung||null, prioritaet||100, aktiv !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/kategorisierungsregeln/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM kategorisierungsregeln WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Verschluesselung anwenden ---

app.post('/api/kontobewegungen/verschluesseln', async (req, res) => {
  try {
    // Alle aktiven Regeln laden, sortiert nach Prioritaet
    const regelnResult = await pool.query(
      'SELECT * FROM kategorisierungsregeln WHERE aktiv = true ORDER BY prioritaet, id'
    );
    const regeln = regelnResult.rows;

    // Alle unverschluesselten Buchungen laden
    const buchungen = await pool.query(
      `SELECT id, name_zahlungsbeteiligter, verwendungszweck, betrag
       FROM kontobewegungen WHERE (schluessel IS NULL OR schluessel = '')`
    );

    let updated = 0;
    for (const b of buchungen.rows) {
      const name = (b.name_zahlungsbeteiligter || '').toLowerCase();
      const zweck = (b.verwendungszweck || '').toLowerCase();
      const betrag = parseFloat(b.betrag) || 0;

      for (const r of regeln) {
        let match = true;

        if (r.name_pattern && !name.includes(r.name_pattern.toLowerCase())) match = false;
        if (r.zweck_pattern && !zweck.includes(r.zweck_pattern.toLowerCase())) match = false;
        if (r.betrag_von !== null && r.betrag_von !== undefined && betrag < parseFloat(r.betrag_von)) match = false;
        if (r.betrag_bis !== null && r.betrag_bis !== undefined && betrag > parseFloat(r.betrag_bis)) match = false;

        if (match) {
          await pool.query(
            `UPDATE kontobewegungen SET steuerschluessel = COALESCE($1, steuerschluessel),
             schluessel = $2, beschreibung = COALESCE($3, beschreibung) WHERE id = $4`,
            [r.steuerschluessel, r.schluessel, r.beschreibung, b.id]
          );
          updated++;
          break; // Erste passende Regel gewinnt
        }
      }
    }

    res.json({ total: buchungen.rows.length, updated });
  } catch (err) {
    console.error('Verschluesseln error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- CSV Import ---

app.post('/api/kontobewegungen/import', async (req, res) => {
  try {
    const { dateipfad } = req.body;
    if (!dateipfad) return res.status(400).json({ error: 'dateipfad fehlt' });

    if (!existsSync(dateipfad)) {
      return res.status(404).json({ error: `Datei nicht gefunden: ${dateipfad}` });
    }

    // CSV einlesen (UTF-8-SIG: BOM am Anfang entfernen)
    let content = readFileSync(dateipfad, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.json({ imported: 0, skipped: 0, message: 'Keine Daten in CSV' });

    const headers = parseCsvLine(lines[0]);
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h.trim()] = i; });

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;

      const buchungstag = parseGermanDate(cols[colIdx['Buchungstag']]?.trim());
      const valutadatum = parseGermanDate(cols[colIdx['Valutadatum']]?.trim());
      const name_zb = cols[colIdx['Name Zahlungsbeteiligter']]?.trim() || '';
      const verwendungszweck = cols[colIdx['Verwendungszweck']]?.trim() || '';
      const betrag = parseGermanDecimal(cols[colIdx['Betrag']]?.trim());
      const buchungstext = cols[colIdx['Buchungstext']]?.trim() || '';
      const iban_auftragskonto = cols[colIdx['IBAN Auftragskonto']]?.trim() || '';
      const waehrung = cols[colIdx['Waehrung']]?.trim() || 'EUR';

      if (!buchungstag) { skipped++; continue; }

      // Duplikat-Check: Betrag + Buchungstag + Name + Verwendungszweck
      const dupCheck = await pool.query(
        `SELECT id FROM kontobewegungen
         WHERE betrag = $1 AND buchungstag = $2
           AND name_zahlungsbeteiligter = $3 AND verwendungszweck = $4
         LIMIT 1`,
        [betrag, buchungstag, name_zb, verwendungszweck]
      );

      if (dupCheck.rows.length > 0) {
        duplicates++;
        continue;
      }

      // Quartal berechnen
      const monat = parseInt(buchungstag.split('-')[1]);
      const quartal = Math.ceil(monat / 3);

      await pool.query(
        `INSERT INTO kontobewegungen (buchungstag, valutadatum, quartal, betrag, name_zahlungsbeteiligter,
         buchungstext, verwendungszweck, iban_auftragskonto, waehrung, konto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [buchungstag, valutadatum, quartal, betrag, name_zb, buchungstext, verwendungszweck,
         iban_auftragskonto, waehrung, iban_auftragskonto.includes('6001375456') ? 'Geschäft' : 'Privat']
      );
      imported++;
    }

    res.json({ imported, skipped, duplicates, total: lines.length - 1 });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CSV-Dateien auflisten (fuer Dateiauswahl im Frontend)
app.get('/api/kontobewegungen/csv-dateien', async (req, res) => {
  try {
    const csvDirs = ['/var/www/kk-crm', '/var/www/kk-crm/scripts'];
    let files = [];
    for (const csvDir of csvDirs) {
      if (!existsSync(csvDir)) continue;
      const found = readdirSync(csvDir)
        .filter(f => f.startsWith('Umsaetze_') && f.endsWith('.csv'))
        .map(f => ({ name: f, pfad: path.join(csvDir, f) }));
      files = files.concat(found);
    }
    files
      .sort((a, b) => b.name.localeCompare(a.name));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Bankabruf (FinTS) ---

app.post('/api/bankabruf', async (req, res) => {
  const { pin, benutzer } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN fehlt' });
  if (!benutzer) return res.status(400).json({ error: 'Benutzer fehlt' });

  // Startdatum = letzter Buchungstag in der DB
  let vonDatum;
  try {
    const maxResult = await pool.query("SELECT MAX(buchungstag)::text AS max_datum FROM kontobewegungen");
    vonDatum = maxResult.rows[0]?.max_datum;
  } catch (e) { /* ignore */ }
  if (!vonDatum) vonDatum = new Date(Date.now() - 30*86400000).toISOString().substring(0,10);

  // Von im deutschen Format fuer das Python-Skript
  const vonParts = vonDatum.split('-');
  const vonDE = `${vonParts[2]}.${vonParts[1]}.${vonParts[0]}`;
  const bisDE = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const pythonPath = '/var/www/kk-crm/scripts/venv/bin/python3';
  const scriptPath = '/var/www/kk-crm/scripts/bank_abruf.py';

  const args = [scriptPath, '--benutzer', benutzer, '--pin', pin, '--von', vonDE, '--bis', bisDE];

  try {
    // Python-Skript ausfuehren
    const result = await new Promise((resolve, reject) => {
      execFile(pythonPath, args, { timeout: 120000, cwd: '/var/www/kk-crm/scripts' }, (err, stdout, stderr) => {
        if (err) {
          // stderr kann nuetzliche Infos enthalten
          const msg = stderr || err.message;
          reject(new Error(msg.replace(pin, '***')));  // PIN aus Fehlermeldungen entfernen
          return;
        }
        resolve(stdout);
      });
    });

    // Ausgabe parsen — suche nach DATEI: Zeilen
    const lines = result.split('\n');
    const dateien = lines.filter(l => l.startsWith('DATEI:')).map(l => l.replace('DATEI:', '').trim());
    const erfolg = lines.find(l => l.startsWith('ERFOLG:'));

    // Gefundene CSVs importieren
    let totalImported = 0;
    let totalDuplicates = 0;

    for (const dateipfad of dateien) {
      if (!existsSync(dateipfad)) continue;

      let content = readFileSync(dateipfad, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

      const csvLines = content.split(/\r?\n/).filter(l => l.trim());
      if (csvLines.length < 2) continue;

      const headers = parseCsvLine(csvLines[0]);
      const colIdx = {};
      headers.forEach((h, i) => { colIdx[h.trim()] = i; });

      for (let i = 1; i < csvLines.length; i++) {
        const cols = parseCsvLine(csvLines[i]);
        if (cols.length < 5) continue;

        const buchungstag = parseGermanDate(cols[colIdx['Buchungstag']]?.trim());
        const valutadatum = parseGermanDate(cols[colIdx['Valutadatum']]?.trim());
        const name_zb = cols[colIdx['Name Zahlungsbeteiligter']]?.trim() || '';
        const verwendungszweck = cols[colIdx['Verwendungszweck']]?.trim() || '';
        const betrag = parseGermanDecimal(cols[colIdx['Betrag']]?.trim());
        const buchungstext = cols[colIdx['Buchungstext']]?.trim() || '';
        const iban_auftragskonto = cols[colIdx['IBAN Auftragskonto']]?.trim() || '';
        const waehrung = cols[colIdx['Waehrung']]?.trim() || 'EUR';

        if (!buchungstag) continue;

        const dupCheck = await pool.query(
          `SELECT id FROM kontobewegungen WHERE betrag = $1 AND buchungstag = $2
           AND name_zahlungsbeteiligter = $3 AND verwendungszweck = $4 LIMIT 1`,
          [betrag, buchungstag, name_zb, verwendungszweck]
        );

        if (dupCheck.rows.length > 0) { totalDuplicates++; continue; }

        const monat = parseInt(buchungstag.split('-')[1]);
        const quartal = Math.ceil(monat / 3);

        await pool.query(
          `INSERT INTO kontobewegungen (buchungstag, valutadatum, quartal, betrag, name_zahlungsbeteiligter,
           buchungstext, verwendungszweck, iban_auftragskonto, waehrung, konto)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [buchungstag, valutadatum, quartal, betrag, name_zb, buchungstext, verwendungszweck,
           iban_auftragskonto, waehrung, iban_auftragskonto.includes('6001375456') ? 'Geschäft' : 'Privat']
        );
        totalImported++;
      }
    }

    // Verschluesselung auf neue Eintraege anwenden
    let verschluesselt = 0;
    if (totalImported > 0) {
      const regelnResult = await pool.query(
        'SELECT * FROM kategorisierungsregeln WHERE aktiv = true ORDER BY prioritaet, id'
      );
      const regeln = regelnResult.rows;
      const unversch = await pool.query(
        `SELECT id, name_zahlungsbeteiligter, verwendungszweck, betrag
         FROM kontobewegungen WHERE (schluessel IS NULL OR schluessel = '')`
      );
      for (const b of unversch.rows) {
        const bName = (b.name_zahlungsbeteiligter || '').toLowerCase();
        const bZweck = (b.verwendungszweck || '').toLowerCase();
        const bBetrag = parseFloat(b.betrag) || 0;
        for (const r of regeln) {
          let match = true;
          if (r.name_pattern && !bName.includes(r.name_pattern.toLowerCase())) match = false;
          if (r.zweck_pattern && !bZweck.includes(r.zweck_pattern.toLowerCase())) match = false;
          if (r.betrag_von !== null && r.betrag_von !== undefined && bBetrag < parseFloat(r.betrag_von)) match = false;
          if (r.betrag_bis !== null && r.betrag_bis !== undefined && bBetrag > parseFloat(r.betrag_bis)) match = false;
          if (match) {
            await pool.query(
              `UPDATE kontobewegungen SET steuerschluessel = COALESCE($1, steuerschluessel),
               schluessel = $2, beschreibung = COALESCE($3, beschreibung) WHERE id = $4`,
              [r.steuerschluessel, r.schluessel, r.beschreibung, b.id]
            );
            verschluesselt++;
            break;
          }
        }
      }
    }

    // Auto-Zahlungsabgleich: sichere Matches (RgNr + Betrag stimmt) direkt zuordnen
    let autoMatched = 0;
    if (totalImported > 0) {
      const sichereMatches = await pool.query(`
        SELECT r.id AS rechnung_id, r.kuerzel, kb.id AS kb_id, kb.buchungstag
        FROM rechnungen r
        JOIN kontobewegungen kb ON kb.verwendungszweck ILIKE '%' || r.rg_nr || '%'
        WHERE r.erhalten_am IS NULL
          AND r.rg_nr IS NOT NULL AND r.rg_nr != ''
          AND kb.betrag > 0
          AND kb.betrag = r.betrag
      `);
      for (const m of sichereMatches.rows) {
        await pool.query(
          'UPDATE rechnungen SET erhalten_am = $1 WHERE id = $2 AND erhalten_am IS NULL',
          [m.buchungstag, m.rechnung_id]
        );
        // Kuerzel in Kontobewegung schreiben
        if (m.kb_id && m.kuerzel) {
          await pool.query('UPDATE kontobewegungen SET zugeordnet = $1 WHERE id = $2', [m.kuerzel, m.kb_id]);
        }
        autoMatched++;
      }
    }

    res.json({
      success: true,
      dateien: dateien.length,
      imported: totalImported,
      duplicates: totalDuplicates,
      verschluesselt,
      autoMatched,
      output: erfolg || '',
    });
  } catch (err) {
    // PIN aus Fehlermeldungen entfernen
    const safeMsg = (err.message || '').replace(new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
    console.error('Bankabruf error:', safeMsg);
    res.status(500).json({ error: safeMsg });
  }
});

// Hilfsfunktionen fuer CSV-Parsing (werden auch vom Import-Endpoint genutzt)
function parseGermanDecimal(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseGermanDate(str) {
  if (!str) return null;
  const parts = str.split('.');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  return str;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ';' && !inQuotes) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

// ============================================================
// --- DB-Admin (Notfall-Zugriff auf alle Tabellen) ---
// ============================================================
// Whitelist fuer Schemas - nur public erlauben
const DB_ADMIN_SCHEMA = 'public';

// Hilfsfunktion: Tabellen-Name validieren (nur [a-z0-9_])
const isValidIdent = (name) => typeof name === 'string' && /^[a-z_][a-z0-9_]*$/i.test(name);

// GET /api/db-admin/tables - Liste aller Tabellen
app.get('/api/db-admin/tables', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT table_name,
              (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident($1)||'.'||quote_ident(table_name))::regclass) AS approx_rows
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name ASC`,
      [DB_ADMIN_SCHEMA]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('DB-Admin tables error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db-admin/tables/:name - Schema (Spalten + PK) + alle Zeilen
app.get('/api/db-admin/tables/:name', async (req, res) => {
  const { name } = req.params;
  if (!isValidIdent(name)) return res.status(400).json({ error: 'Ungueltiger Tabellenname' });
  try {
    // Spalten
    const colsRes = await pool.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position ASC`,
      [DB_ADMIN_SCHEMA, name]
    );
    if (colsRes.rows.length === 0) return res.status(404).json({ error: 'Tabelle nicht gefunden' });

    // Primary Key Spalten
    const pkRes = await pool.query(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = (quote_ident($1)||'.'||quote_ident($2))::regclass
         AND i.indisprimary`,
      [DB_ADMIN_SCHEMA, name]
    );
    const pkColumns = pkRes.rows.map((r) => r.column_name);

    // Zeilen (limit 5000 zum Schutz vor riesigen Tabellen)
    const rowsRes = await pool.query(
      `SELECT * FROM "${name}" ORDER BY ${pkColumns.length > 0 ? pkColumns.map((c) => `"${c}"`).join(', ') : '1'} LIMIT 5000`
    );

    res.json({
      columns: colsRes.rows,
      pkColumns,
      rows: rowsRes.rows,
      rowCount: rowsRes.rowCount,
      truncated: rowsRes.rowCount >= 5000,
    });
  } catch (err) {
    console.error('DB-Admin read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/db-admin/tables/:name - Update einer Zeile. Body: { pk: {col:val,...}, updates: {col:val,...} }
app.put('/api/db-admin/tables/:name', async (req, res) => {
  const { name } = req.params;
  const { pk, updates } = req.body || {};
  if (!isValidIdent(name)) return res.status(400).json({ error: 'Ungueltiger Tabellenname' });
  if (!pk || typeof pk !== 'object' || Object.keys(pk).length === 0) {
    return res.status(400).json({ error: 'Primary Key fehlt' });
  }
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Keine Aenderungen' });
  }
  const updateCols = Object.keys(updates);
  const pkCols = Object.keys(pk);
  if (!updateCols.every(isValidIdent) || !pkCols.every(isValidIdent)) {
    return res.status(400).json({ error: 'Ungueltiger Spaltenname' });
  }
  try {
    const setClauses = updateCols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const whereClauses = pkCols.map((c, i) => `"${c}" = $${updateCols.length + i + 1}`).join(' AND ');
    const values = [...updateCols.map((c) => updates[c]), ...pkCols.map((c) => pk[c])];
    const sql = `UPDATE "${name}" SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
    const result = await pool.query(sql, values);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Zeile nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('DB-Admin update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/db-admin/tables/:name - Neue Zeile. Body: { values: {col:val,...} }
app.post('/api/db-admin/tables/:name', async (req, res) => {
  const { name } = req.params;
  const { values } = req.body || {};
  if (!isValidIdent(name)) return res.status(400).json({ error: 'Ungueltiger Tabellenname' });
  if (!values || typeof values !== 'object' || Object.keys(values).length === 0) {
    return res.status(400).json({ error: 'Keine Werte' });
  }
  const cols = Object.keys(values);
  if (!cols.every(isValidIdent)) return res.status(400).json({ error: 'Ungueltiger Spaltenname' });
  try {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${name}" (${colList}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(sql, cols.map((c) => values[c]));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('DB-Admin insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/db-admin/tables/:name - Zeile loeschen. Body: { pk: {col:val,...} }
app.delete('/api/db-admin/tables/:name', async (req, res) => {
  const { name } = req.params;
  const { pk } = req.body || {};
  if (!isValidIdent(name)) return res.status(400).json({ error: 'Ungueltiger Tabellenname' });
  if (!pk || typeof pk !== 'object' || Object.keys(pk).length === 0) {
    return res.status(400).json({ error: 'Primary Key fehlt' });
  }
  const pkCols = Object.keys(pk);
  if (!pkCols.every(isValidIdent)) return res.status(400).json({ error: 'Ungueltiger Spaltenname' });
  try {
    const whereClauses = pkCols.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const sql = `DELETE FROM "${name}" WHERE ${whereClauses} RETURNING *`;
    const result = await pool.query(sql, pkCols.map((c) => pk[c]));
    if (result.rowCount === 0) return res.status(404).json({ error: 'Zeile nicht gefunden' });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    console.error('DB-Admin delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Kurs-Teilnehmer ---
// Uebersicht aller Teilnehmer eines Kurses (oder alle Kurse, wenn kein Filter)
app.get('/api/kurs-teilnehmer', async (req, res) => {
  try {
    const { kurs } = req.query;
    const where = kurs ? 'WHERE kt.kurs_kuerzel = $1' : '';
    const params = kurs ? [kurs] : [];
    const result = await pool.query(
      `SELECT kt.*,
              k.vorname, k.nachname, k.email, k.kuerzel AS kontakt_kuerzel
         FROM kurs_teilnehmer kt
         LEFT JOIN kontakte k ON k.id = kt.kontakt_id
         ${where}
         ORDER BY kt.gekauft_am DESC, kt.id DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET kurs-teilnehmer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Einzelner Teilnehmer (fuer Detail-Ansicht)
app.get('/api/kurs-teilnehmer/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT kt.*, k.vorname, k.nachname, k.email, k.kuerzel AS kontakt_kuerzel
         FROM kurs_teilnehmer kt
         LEFT JOIN kontakte k ON k.id = kt.kontakt_id
        WHERE kt.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET kurs-teilnehmer detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Teilnehmer aktualisieren (z.B. Notiz hinzufuegen, oder zahlungsstand manuell korrigieren)
app.put('/api/kurs-teilnehmer/:id', async (req, res) => {
  try {
    const editable = ['notiz', 'preis_gesamt', 'preis_bezahlt', 'anzahl_raten_bezahlt'];
    const setParts = [];
    const values = [];
    let p = 1;
    for (const f of editable) {
      if (f in req.body) {
        setParts.push(`${f} = $${p++}`);
        values.push(req.body[f]);
      }
    }
    if (setParts.length === 0) return res.status(400).json({ error: 'Keine Felder' });
    setParts.push('updated_at = NOW()');
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE kurs_teilnehmer SET ${setParts.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT kurs-teilnehmer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Kurs-Teilnahmen eines Kontakts (fuer Anzeige im Kontakt-Detail)
app.get('/api/kontakte/:id/kurs-teilnahmen', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM kurs_teilnehmer
        WHERE kontakt_id = $1
        ORDER BY gekauft_am DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET kontakt kurs-teilnahmen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Produkte ---
app.get('/api/produkte', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produkte WHERE aktiv = true ORDER BY bezeichnung ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET produkte error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Static files (production)
// ============================================================
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`KK-CRM Server laeuft auf Port ${PORT}`);
});

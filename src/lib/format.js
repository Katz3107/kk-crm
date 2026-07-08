import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

// Die DB speichert (fast) alle Datumsfelder als TIMESTAMP WITHOUT TIME ZONE
// (Wanduhr-Zeit). node-pg liefert sie aber als JS-Date, das beim Serialisieren
// nach JSON ein "Z" bekommt (UTC). Im Browser (CEST) wuerde dann formatiert
// um +2h verschoben. Wir entfernen daher TZ-Hinweise vor dem Parsen, sodass
// parseISO die Zeit als lokale Wanduhrzeit interpretiert.
function toWallClock(dateStr) {
  if (typeof dateStr !== 'string') return dateStr;
  // "2026-04-10T13:15:00.000Z" -> "2026-04-10T13:15:00.000"
  // "2026-04-10 13:15:00"      -> "2026-04-10T13:15:00"
  // "2026-04-10T13:15:00+02:00" -> "2026-04-10T13:15:00"
  return dateStr
    .replace(' ', 'T')
    .replace(/Z$/, '')
    .replace(/[+-]\d{2}:?\d{2}$/, '');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(toWallClock(dateStr)) : dateStr;
    return format(d, 'dd.MM.yyyy', { locale: de });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? parseISO(toWallClock(dateStr)) : dateStr;
    return format(d, 'dd.MM.yyyy HH:mm', { locale: de });
  } catch {
    return dateStr;
  }
}

export function formatCurrency(value) {
  if (value == null || value === '') return '';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function toISODate(dateStr) {
  if (!dateStr) return null;
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);
  // German format DD.MM.YYYY
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr;
}

/**
 * Entfernt HTML-Tags aus einem String und gibt reinen Text zurueck.
 */
export function stripHtml(html) {
  if (!html) return '';
  // Ersetze <br>, <br/>, <div>, </div>, <p>, </p> durch Zeilenumbrueche
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/**
 * Prueft ob ein String HTML-Tags enthaelt.
 */
export function containsHtml(text) {
  if (!text) return false;
  return /<[a-z][\s\S]*>/i.test(text);
}

/**
 * Bereinigt HTML fuer sichere Anzeige (entfernt script-Tags, event-handler etc.)
 */
export function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Konvertiert ein Datumswert von der DB (ISO-String oder Date-Objekt) in das
 * Format yyyy-MM-dd das HTML date-Inputs erwarten.
 */
export function toDateInputValue(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    // ISO format: "2026-03-14T00:00:00.000Z" oder "2026-03-14"
    if (/^\d{4}-\d{2}-\d{2}/.test(dateVal)) return dateVal.substring(0, 10);
    // German format
    return toISODate(dateVal) || '';
  }
  // Date object
  try {
    return format(dateVal, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

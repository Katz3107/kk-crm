const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const raw = await res.text();
    // Wenn der Server ein JSON mit "error"-Feld schickt, diese Meldung hochreichen
    let msg = raw || res.statusText;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.error) msg = parsed.error;
    } catch { /* kein JSON, Text as is */ }
    throw new Error(msg);
  }
  return res.json();
}

// Kontakte
export const getKontakte = (search = '', statusFilter = 'aktiv') => {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (statusFilter && statusFilter !== 'alle') params.set('statusFilter', statusFilter);
  const qs = params.toString();
  return request(`/kontakte${qs ? `?${qs}` : ''}`);
};
export const getKontakt = (id) => request(`/kontakte/${id}`);
export const updateKontakt = (id, data) =>
  request(`/kontakte/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const createKontakt = (data) =>
  request(`/kontakte`, { method: 'POST', body: JSON.stringify(data) });

// Kontakt-Bilder
export const getKontaktBilder = (kontaktId) =>
  request(`/kontakte/${kontaktId}/bilder`);
export const uploadKontaktBild = (kontaktId, { dateiname, mimetype, daten_base64, ist_hauptbild }) =>
  request(`/kontakte/${kontaktId}/bilder`, {
    method: 'POST',
    body: JSON.stringify({ dateiname, mimetype, daten_base64, ist_hauptbild }),
  });
export const deleteKontaktBild = (id) =>
  request(`/bilder/${id}`, { method: 'DELETE' });
export const setKontaktBildHaupt = (id) =>
  request(`/bilder/${id}/hauptbild`, { method: 'PUT' });
export const kontaktBildUrl = (id) => `/api/bilder/${id}`;

// Termine
export const getTermine = (kontaktId) =>
  request(`/kontakte/${kontaktId}/termine`);
export const createTermin = (kontaktId, data) =>
  request(`/kontakte/${kontaktId}/termine`, { method: 'POST', body: JSON.stringify(data) });
export const updateTermin = (id, data) =>
  request(`/termine/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTermin = (id) =>
  request(`/termine/${id}`, { method: 'DELETE' });

// Rechnungen
export const getRechnungen = (kontaktId) =>
  request(`/kontakte/${kontaktId}/rechnungen`);
export const createRechnungen = (kontaktId, data) =>
  request(`/kontakte/${kontaktId}/rechnungen`, { method: 'POST', body: JSON.stringify(data) });
export const updateRechnung = (id, data) =>
  request(`/rechnungen/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const getNextRgNr = (monat) =>
  request(`/rechnungen/naechste-nummer${monat ? `?monat=${monat}` : ''}`);
// opts: { verschiebe_folge_raten?: number[] } — optional IDs unversendeter Folge-Raten,
// die um die gleiche Versand-Verspaetung mitverschoben werden sollen.
export const sendRechnungWebhook = (id, opts = {}) =>
  request(`/rechnungen/${id}/webhook`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

// Markiert die Rechnung als manuell versendet. opts wie bei sendRechnungWebhook.
export const manuellVersendet = (id, opts = {}) =>
  request(`/rechnungen/${id}/manuell-versenden`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

// Markiert die Rechnung als bezahlt (PayPal-Eingang). Bucht zugleich einen Eintrag
// in kontobewegungen, sodass der Eingang in Buchhaltung/Kontostand auftaucht.
// opts: { datum: 'YYYY-MM-DD', betrag: number }
export const paypalBezahlt = (id, opts = {}) =>
  request(`/rechnungen/${id}/paypal-bezahlt`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });

// PDF generieren — gibt Blob zurueck (kein JSON)
export const generatePdf = async (params) => {
  const res = await fetch(`${BASE}/rechnungen/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
};

// Systembeteiligte
export const getSystembeteiligte = (kontaktId) =>
  request(`/kontakte/${kontaktId}/systembeteiligte`);
export const createSystembeteiligter = (kontaktId, data) =>
  request(`/kontakte/${kontaktId}/systembeteiligte`, { method: 'POST', body: JSON.stringify(data) });
export const updateSystembeteiligter = (id, data) =>
  request(`/systembeteiligte/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Auswertungen
export const getOffeneLogbuecher = () => request(`/auswertungen/offene-logbuecher`);
export const getOffeneBetraege = () => request(`/auswertungen/offene-betraege`);
export const getOffeneRechnungen = () => request(`/auswertungen/offene-rechnungen`);
export const getTerminanzahl = () => request(`/auswertungen/terminanzahl`);
export const getNeukunden = () => request(`/auswertungen/neukunden`);
export const getNeukundenProMonat = () => request(`/auswertungen/neukunden-pro-monat`);

// Interessenten
export const getInteressenten = (search = '', inklKunden = false) => {
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (inklKunden) qs.set('inkl_kunden', 'true');
  const q = qs.toString();
  return request(`/interessenten${q ? `?${q}` : ''}`);
};
export const getInteressent = (id) => request(`/interessenten/${id}`);
export const createInteressent = (data) =>
  request(`/interessenten`, { method: 'POST', body: JSON.stringify(data) });
export const deleteInteressent = (id) =>
  request(`/interessenten/${id}`, { method: 'DELETE' });
export const updateInteressent = (id, data) =>
  request(`/interessenten/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const createInteressentenGespraech = (kontaktId, data) =>
  request(`/interessenten/${kontaktId}/gespraeche`, { method: 'POST', body: JSON.stringify(data) });
export const updateInteressentenGespraech = (id, data) =>
  request(`/interessenten-gespraeche/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteInteressentenGespraech = (id) =>
  request(`/interessenten-gespraeche/${id}`, { method: 'DELETE' });

// Zahlungsabgleich
export const getZahlungsabgleichVorschau = () => request(`/zahlungsabgleich/vorschau`);
export const zahlungsabgleichAusfuehren = (matches) =>
  request(`/zahlungsabgleich/ausfuehren`, { method: 'POST', body: JSON.stringify({ matches }) });

// Kontobewegungen
export const getKontobewegungen = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.schluessel) qs.set('schluessel', params.schluessel);
  if (params.suche) qs.set('suche', params.suche);
  if (params.von) qs.set('von', params.von);
  if (params.bis) qs.set('bis', params.bis);
  if (params.konto) qs.set('konto', params.konto);
  if (params.limit) qs.set('limit', params.limit);
  const q = qs.toString();
  return request(`/kontobewegungen${q ? `?${q}` : ''}`);
};
export const getKontobewegungSchluessel = () => request(`/kontobewegungen/schluessel`);
export const updateKontobewegung = (id, data) =>
  request(`/kontobewegungen/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const getKontostand = (params = {}) => {
  const qs = new URLSearchParams();
  if (params.bis) qs.set('bis', params.bis);
  if (params.konto) qs.set('konto', params.konto);
  const q = qs.toString();
  return request(`/kontostand${q ? `?${q}` : ''}`);
};

// Kategorisierungsregeln
export const getKategorisierungsregeln = () => request(`/kategorisierungsregeln`);
export const getVerschluesselungVorschlaege = () => request(`/verschluesselung/vorschlaege`);
export const createKategorisierungsregel = (data) =>
  request(`/kategorisierungsregeln`, { method: 'POST', body: JSON.stringify(data) });
export const updateKategorisierungsregel = (id, data) =>
  request(`/kategorisierungsregeln/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteKategorisierungsregel = (id) =>
  request(`/kategorisierungsregeln/${id}`, { method: 'DELETE' });

// Verschluesselung + Import
export const verschluesseln = () => request(`/kontobewegungen/verschluesseln`, { method: 'POST' });
export const importCsv = (dateipfad) =>
  request(`/kontobewegungen/import`, { method: 'POST', body: JSON.stringify({ dateipfad }) });
export const getCsvDateien = () => request(`/kontobewegungen/csv-dateien`);

// USt-Export CSV-Download
export const downloadUstExport = async (params = {}) => {
  const qs = new URLSearchParams();
  if (params.von) qs.set('von', params.von);
  if (params.bis) qs.set('bis', params.bis);
  const res = await fetch(`${BASE}/ust-export?${qs.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `USt-Export_${params.von || 'alle'}_${params.bis || 'alle'}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};

// Bankabruf
export const bankabruf = (data) =>
  request(`/bankabruf`, { method: 'POST', body: JSON.stringify(data) });

// Produkte
export const getProdukte = () => request(`/produkte`);
export const updateProdukt = (id, data) =>
  request(`/produkte/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Kurs-Teilnehmer (Copecart)
export const getKursTeilnehmer = (kurs) =>
  request(`/kurs-teilnehmer${kurs ? `?kurs=${encodeURIComponent(kurs)}` : ''}`);
export const getKursTeilnehmerById = (id) => request(`/kurs-teilnehmer/${id}`);
export const updateKursTeilnehmer = (id, data) =>
  request(`/kurs-teilnehmer/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const getKontaktKursTeilnahmen = (kontaktId) =>
  request(`/kontakte/${kontaktId}/kurs-teilnahmen`);

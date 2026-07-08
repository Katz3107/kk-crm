const BASE = '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  return res.json();
}

// Kontakte
export const getKontakte = (search = '') =>
  request(`/kontakte${search ? `?search=${encodeURIComponent(search)}` : ''}`);
export const getKontakt = (id) => request(`/kontakte/${id}`);
export const updateKontakt = (id, data) =>
  request(`/kontakte/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const createKontakt = (data) =>
  request(`/kontakte`, { method: 'POST', body: JSON.stringify(data) });

// Termine
export const getTermine = (kontaktId) =>
  request(`/kontakte/${kontaktId}/termine`);
export const createTermin = (kontaktId, data) =>
  request(`/kontakte/${kontaktId}/termine`, { method: 'POST', body: JSON.stringify(data) });
export const updateTermin = (id, data) =>
  request(`/termine/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Rechnungen
export const getRechnungen = (kontaktId) =>
  request(`/kontakte/${kontaktId}/rechnungen`);
export const createRechnungen = (kontaktId, data) =>
  request(`/kontakte/${kontaktId}/rechnungen`, { method: 'POST', body: JSON.stringify(data) });
export const updateRechnung = (id, data) =>
  request(`/rechnungen/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const getNextRgNr = (monat) =>
  request(`/rechnungen/naechste-nummer${monat ? `?monat=${monat}` : ''}`);
export const sendRechnungWebhook = (id) =>
  request(`/rechnungen/${id}/webhook`, { method: 'POST' });

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

// Interessenten
export const getInteressenten = (search = '') =>
  request(`/interessenten${search ? `?search=${encodeURIComponent(search)}` : ''}`);
export const getInteressent = (id) => request(`/interessenten/${id}`);
export const updateInteressent = (id, data) =>
  request(`/interessenten/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const updateInteressentenGespraech = (id, data) =>
  request(`/interessenten-gespraeche/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Produkte
export const getProdukte = () => request(`/produkte`);
export const updateProdukt = (id, data) =>
  request(`/produkte/${id}`, { method: 'PUT', body: JSON.stringify(data) });

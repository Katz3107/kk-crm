import React, { useState, useEffect, useCallback } from 'react';
import { Plus, FileText, Eye, Send, Check, X, Download } from 'lucide-react';
import { getRechnungen, createRechnungen, updateRechnung, getProdukte, getNextRgNr, generatePdf, sendRechnungWebhook } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';

const EINLEITUNG_EINZEL = 'Für die Durchführung eines Coachings zur beruflichen Weiterentwicklung stelle ich die folgende Leistung in Rechnung.';
const EINLEITUNG_PAKET = 'Für die Durchführung dieses Coachingpakets zur beruflichen Weiterentwicklung stelle ich folgende Leistung in Rechnung.';
const DEFAULT_EINLEITUNG = EINLEITUNG_EINZEL;
const DEFAULT_DANKE = 'Vielen Dank für die gute Zusammenarbeit.';
const DEFAULT_DANKE_NEU = 'Vielen Dank, ich freue mich auf die bevorstehende Zusammenarbeit.';

async function savePdfLokal(blob, dateiname) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const res = await fetch('http://localhost:3099/save-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateiname, data: base64 }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Lokales Speichern fehlgeschlagen');
  }
  return res.json();
}

export default function TabRechnungen({ kontaktId, kontakt }) {
  const [rechnungen, setRechnungen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getRechnungen(kontaktId)
      .then(setRechnungen)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [kontaktId]);

  useEffect(() => { load(); }, [load]);

  const handleBezahlt = async (rechnung) => {
    const heute = new Date().toISOString().slice(0, 10);
    const neuerWert = rechnung.erhalten_am ? null : heute;
    try {
      await updateRechnung(rechnung.id, { erhalten_am: neuerWert });
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  };

  const buildPdfParams = (rechnung) => ({
    rg_nr: rechnung.rg_nr,
    datum: new Date(rechnung.gestellt_am).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    faellig_tage: Math.round((new Date(rechnung.faellig_am) - new Date(rechnung.gestellt_am)) / 86400000),
    kunde_name: `${kontakt?.vorname || ''} ${kontakt?.nachname || ''}`.trim(),
    kunde_strasse: kontakt?.strasse || '',
    kunde_plz_ort: kontakt?.ort || '',
    kunde_land: kontakt?.land || 'DE',
    titel: rechnung.raten_gesamt > 1 ? `Rechnung - ${rechnung.rate_nr}. Rate` : 'Rechnung',
    bezeichnung: rechnung.bezeichnung || rechnung.produkt_kuerzel || '',
    beschreibung: rechnung.beschreibung || '',
    einleitungstext: rechnung.einleitungstext || undefined,
    danke_text: rechnung.danke_text || undefined,
    betrag_brutto: parseFloat(rechnung.betrag),
    einheit: rechnung.raten_gesamt > 1 ? 'Rate' : 'Gesamt',
    ...(rechnung.raten_gesamt > 1 ? {
      raten_info: {
        gesamt: parseFloat(rechnung.brutto_gesamt),
        anzahl: rechnung.raten_gesamt,
        erste_rate: parseFloat(rechnung.betrag),
        // Fallback: wenn betrag_pro_rate leer ist, betrag als Folge-Rate nehmen
        folge_rate: rechnung.betrag_pro_rate != null
          ? parseFloat(rechnung.betrag_pro_rate)
          : parseFloat(rechnung.betrag),
      }
    } : {}),
  });

  const pdfDateiname = (rechnung) => `${rechnung.kuerzel}_${rechnung.rg_nr}.pdf`;

  const handleSenden = async (rechnung) => {
    if (rechnung.webhook_gesendet_am) {
      if (!confirm(`Diese Rechnung wurde bereits am ${formatDate(rechnung.webhook_gesendet_am)} gesendet. Nochmal senden?`)) return;
    }
    const gestelltAm = new Date(rechnung.gestellt_am);
    const heute = new Date();
    heute.setHours(0, 0, 0, 0);
    if (gestelltAm > heute) {
      if (!confirm(`Achtung: Diese Rechnung ist erst am ${formatDate(rechnung.gestellt_am)} fällig.\n\nTrotzdem jetzt senden?`)) return;
    }
    try {
      // 1. PDF generieren
      const blob = await generatePdf(buildPdfParams(rechnung));
      const name = pdfDateiname(rechnung);

      // 2. PDF lokal speichern (G:\ + OneDrive)
      try {
        await savePdfLokal(blob, name);
      } catch (err) {
        alert('PDF konnte nicht lokal gespeichert werden: ' + err.message + '\n\nIst pfad-oeffner.py gestartet?');
        return;
      }

      // 3. Webhook an Make senden
      await sendRechnungWebhook(rechnung.id);
      alert(`Rechnung ${rechnung.rg_nr} gespeichert und an Make gesendet!`);
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  };

  const handlePdfDownload = async (rechnung) => {
    try {
      const blob = await generatePdf(buildPdfParams(rechnung));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfDateiname(rechnung);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF-Fehler: ' + err.message);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-teal-dark">Rechnungen ({rechnungen.length})</h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
        >
          <Plus size={16} /> Neue Rechnung
        </button>
      </div>

      {/* Tabelle bestehender Rechnungen */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-teal-primary text-white">
              <th className="px-3 py-2 text-left">RgNr</th>
              <th className="px-3 py-2 text-left">Produkt</th>
              <th className="px-3 py-2 text-right">Betrag</th>
              <th className="px-3 py-2 text-center">Rate</th>
              <th className="px-3 py-2 text-left">gestellt am</th>
              <th className="px-3 py-2 text-left">fällig am</th>
              <th className="px-3 py-2 text-left">erhalten am</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-center">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {rechnungen.map((r, idx) => (
              <tr key={r.id} className={`border-t ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                <td className="px-3 py-2 font-mono">{r.rg_nr}</td>
                <td className="px-3 py-2">{r.produkt_kuerzel}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(r.betrag)}</td>
                <td className="px-3 py-2 text-center">
                  {r.raten_gesamt > 1 ? `${r.rate_nr}/${r.raten_gesamt}` : '-'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.gestellt_am)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.faellig_am)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.erhalten_am)}</td>
                <td className="px-3 py-2 text-center">
                  {r.erhalten_am ? (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">bezahlt</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">offen</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => handlePdfDownload(r)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-500"
                      title="PDF herunterladen"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => handleSenden(r)}
                      className={`p-1 rounded hover:bg-gray-100 ${r.webhook_gesendet_am ? 'text-blue-500' : 'text-gray-400'}`}
                      title={r.webhook_gesendet_am ? `Gesendet am ${formatDate(r.webhook_gesendet_am)}` : 'An Make senden'}
                    >
                      <Send size={14} />
                    </button>
                    <button
                      onClick={() => handleBezahlt(r)}
                      className={`p-1 rounded hover:bg-gray-100 ${r.erhalten_am ? 'text-emerald-600' : 'text-gray-400'}`}
                      title={r.erhalten_am ? 'Als offen markieren' : 'Als bezahlt markieren'}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rechnungen.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">Keine Rechnungen vorhanden</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* PDF Vorschau Modal */}
      {pdfUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={(e) => { e.stopPropagation(); URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-[90vw] h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-teal-dark">PDF Vorschau</h3>
              <div className="flex items-center gap-2">
                <a href={pdfUrl} download="Rechnung.pdf" className="flex items-center gap-1 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover">
                  <Download size={14} /> Herunterladen
                </a>
                <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} className="p-1 hover:bg-gray-100 rounded">
                  <X size={18} />
                </button>
              </div>
            </div>
            <iframe src={pdfUrl} className="flex-1 w-full" />
          </div>
        </div>
      )}

      {/* Erstellungs-Modal */}
      {showModal && (
        <RechnungErstellenModal
          kontakt={kontakt}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
          onShowPdf={setPdfUrl}
          kontaktId={kontaktId}
        />
      )}
    </div>
  );
}


function RechnungErstellenModal({ kontakt, kontaktId, onClose, onCreated, onShowPdf }) {
  const [produkte, setProdukte] = useState([]);
  const [selectedProdukt, setSelectedProdukt] = useState(null);
  const [anzahlRaten, setAnzahlRaten] = useState(1);
  const [faelligTage, setFaelligTage] = useState(5);
  const [closerName, setCloserName] = useState('');
  const [einleitungstext, setEinleitungstext] = useState(DEFAULT_EINLEITUNG);
  const [dankeText, setDankeText] = useState(DEFAULT_DANKE);
  const [bezeichnung, setBezeichnung] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [customBetrag, setCustomBetrag] = useState('');
  const [nextNr, setNextNr] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [step, setStep] = useState('config'); // config -> preview -> done
  const [previewBlob, setPreviewBlob] = useState(null); // gespeichertes PDF aus Vorschau

  useEffect(() => {
    getProdukte().then(setProdukte).catch(console.error);
    getNextRgNr().then(d => setNextNr(d.naechste_nummer)).catch(console.error);
  }, []);

  const handleProduktChange = (kuerzel) => {
    const p = produkte.find(x => x.kuerzel === kuerzel);
    setSelectedProdukt(p || null);
    if (p) {
      setBezeichnung(p.bezeichnung || '');
      setBeschreibung(p.beschreibung || '');
      setCustomBetrag(p.brutto_gesamt ? String(p.brutto_gesamt) : '');
    } else {
      setBezeichnung('');
      setBeschreibung('');
      setCustomBetrag('');
    }
  };

  const bruttoGesamt = parseFloat(customBetrag) || 0;
  let ersteRate, folgeRate;
  if (anzahlRaten === 1) {
    ersteRate = bruttoGesamt;
    folgeRate = 0;
  } else {
    folgeRate = Math.floor(bruttoGesamt / anzahlRaten / 10) * 10;
    ersteRate = bruttoGesamt - (anzahlRaten - 1) * folgeRate;
  }

  const handleVorschau = async () => {
    setGeneratingPdf(true);
    try {
      const params = {
        rg_nr: nextNr,
        datum: new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        faellig_tage: faelligTage,
        kunde_name: `${kontakt?.vorname || ''} ${kontakt?.nachname || ''}`.trim(),
        kunde_strasse: kontakt?.strasse || '',
        kunde_plz_ort: kontakt?.ort || '',
        kunde_land: kontakt?.land || 'DE',
        titel: anzahlRaten === 1 ? 'Rechnung' : 'Rechnung - 1. Rate',
        einleitungstext,
        bezeichnung,
        beschreibung,
        betrag_brutto: ersteRate,
        einheit: anzahlRaten === 1 ? 'Gesamt' : 'Rate',
        danke_text: dankeText,
      };
      if (anzahlRaten > 1) {
        params.raten_info = {
          gesamt: bruttoGesamt,
          anzahl: anzahlRaten,
          erste_rate: ersteRate,
          folge_rate: folgeRate,
        };
      }
      const blob = await generatePdf(params);
      setPreviewBlob(blob); // PDF merken — wird beim Erstellen wiederverwendet
      const url = URL.createObjectURL(blob);
      onShowPdf(url);
    } catch (err) {
      alert('PDF-Fehler: ' + err.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleErstellen = async () => {
    if (!selectedProdukt && !bezeichnung) {
      alert('Bitte ein Produkt auswählen oder eine Bezeichnung eingeben.');
      return;
    }
    if (bruttoGesamt <= 0) {
      alert('Bitte einen gültigen Betrag eingeben.');
      return;
    }

    setCreating(true);
    try {
      const data = {
        produkt_kuerzel: selectedProdukt?.kuerzel || 'EINZEL',
        bezeichnung,
        beschreibung,
        einleitungstext,
        danke_text: dankeText,
        brutto_gesamt: bruttoGesamt,
        anzahl_raten: anzahlRaten,
        faellig_tage: faelligTage,
        closer_name: closerName || null,
      };
      const erstellte = await createRechnungen(kontaktId, data);

      // PDFs lokal speichern (G:\ + OneDrive)
      // Rate 1: Vorschau-PDF wiederverwenden (exakt dasselbe Dokument)
      // Weitere Raten: frisch generieren
      let pdfOk = 0;
      for (let i = 0; i < erstellte.length; i++) {
        const r = erstellte[i];
        try {
          let blob;
          if (i === 0 && previewBlob) {
            // Rate 1: gespeichertes Vorschau-PDF verwenden
            blob = previewBlob;
          } else {
            // Folgeraten oder kein Preview vorhanden: frisch generieren
            const pdfParams = {
              rg_nr: r.rg_nr,
              datum: new Date(r.gestellt_am).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
              faellig_tage: faelligTage,
              kunde_name: r.kunde_name || '',
              kunde_strasse: r.kunde_strasse || '',
              kunde_plz_ort: r.kunde_plz_ort || '',
              kunde_land: r.kunde_land || 'DE',
              titel: r.titel || 'Rechnung',
              einleitungstext,
              bezeichnung,
              beschreibung,
              betrag_brutto: parseFloat(r.betrag),
              einheit: r.raten_gesamt > 1 ? 'Rate' : 'Gesamt',
              danke_text: dankeText,
              ...(r.raten_gesamt > 1 ? {
                raten_info: {
                  gesamt: parseFloat(r.brutto_gesamt),
                  anzahl: r.raten_gesamt,
                  erste_rate: parseFloat(erstellte[0].betrag),
                  folge_rate: parseFloat(erstellte.length > 1 ? erstellte[1].betrag : r.betrag),
                }
              } : {}),
            };
            blob = await generatePdf(pdfParams);
          }
          const dateiname = `${r.kuerzel}_${r.rg_nr}.pdf`;
          await savePdfLokal(blob, dateiname);
          pdfOk++;
        } catch (err) {
          console.error(`PDF für ${r.rg_nr} fehlgeschlagen:`, err);
        }
      }

      if (pdfOk === erstellte.length) {
        alert(`${erstellte.length} Rechnung(en) erstellt und PDFs gespeichert!`);
      } else {
        alert(`${erstellte.length} Rechnung(en) erstellt. ${pdfOk}/${erstellte.length} PDFs gespeichert.\n\nIst pfad-oeffner.py gestartet?`);
      }
      onCreated();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold text-teal-dark">Neue Rechnung erstellen</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Kunde Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-700">
              {kontakt?.vorname} {kontakt?.nachname}
              {kontakt?.kuerzel && <span className="text-gray-400 ml-2">({kontakt.kuerzel})</span>}
            </p>
            <p className="text-xs text-gray-500">{kontakt?.email}</p>
          </div>

          {/* Produkt + Betrag */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Produkt</label>
              <select
                value={selectedProdukt?.kuerzel || ''}
                onChange={e => handleProduktChange(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">-- Produkt wählen --</option>
                {produkte.map(p => (
                  <option key={p.kuerzel} value={p.kuerzel}>
                    {p.kuerzel} - {p.bezeichnung} ({p.brutto_gesamt} EUR)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bruttobetrag (EUR)</label>
              <input
                type="number"
                step="0.01"
                value={customBetrag}
                onChange={e => setCustomBetrag(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="z.B. 185.00"
              />
            </div>
          </div>

          {/* Raten + Fälligkeit + Closer */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Anzahl Raten</label>
              <select
                value={anzahlRaten}
                onChange={e => setAnzahlRaten(parseInt(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fälligkeit (Tage)</label>
              <input
                type="number"
                value={faelligTage}
                onChange={e => setFaelligTage(parseInt(e.target.value) || 5)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Closer (optional)</label>
              <input
                type="text"
                value={closerName}
                onChange={e => setCloserName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Name"
              />
            </div>
          </div>

          {/* Raten-Berechnung Vorschau */}
          {bruttoGesamt > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <p className="font-semibold text-blue-800 mb-1">Ratenberechnung</p>
              {anzahlRaten === 1 ? (
                <p>Gesamtbetrag: <strong>{bruttoGesamt.toFixed(2)} EUR</strong></p>
              ) : (
                <>
                  <p>Gesamtbetrag: {bruttoGesamt.toFixed(2)} EUR in {anzahlRaten} Raten</p>
                  <p>1. Rate: <strong>{ersteRate.toFixed(2)} EUR</strong></p>
                  <p>Folgeraten: {anzahlRaten - 1} x <strong>{folgeRate.toFixed(2)} EUR</strong></p>
                </>
              )}
              <p className="text-xs text-blue-600 mt-1">Nächste Rechnungsnr.: {nextNr}</p>
            </div>
          )}

          {/* Editierbare Texte */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Rechnungstexte (editierbar)</h4>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung</label>
                <input
                  type="text"
                  value={bezeichnung}
                  onChange={e => setBezeichnung(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung (erscheint unter der Position)</label>
                <textarea
                  value={beschreibung}
                  onChange={e => setBeschreibung(e.target.value)}
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Einleitungstext</label>
                <div className="flex flex-col gap-1 mb-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="einleitungVariante"
                      checked={einleitungstext === EINLEITUNG_EINZEL}
                      onChange={() => setEinleitungstext(EINLEITUNG_EINZEL)}
                      className="mt-0.5 accent-teal-600"
                    />
                    <span className="text-gray-700">Einzelcoaching</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="einleitungVariante"
                      checked={einleitungstext === EINLEITUNG_PAKET}
                      onChange={() => setEinleitungstext(EINLEITUNG_PAKET)}
                      className="mt-0.5 accent-teal-600"
                    />
                    <span className="text-gray-700">Coachingpaket</span>
                  </label>
                </div>
                <textarea
                  value={einleitungstext}
                  onChange={e => setEinleitungstext(e.target.value)}
                  rows={2}
                  placeholder="Oder freier Text..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Schlusstext</label>
                <div className="flex flex-col gap-1 mb-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="dankeVariante"
                      checked={dankeText === DEFAULT_DANKE}
                      onChange={() => setDankeText(DEFAULT_DANKE)}
                      className="mt-0.5"
                    />
                    <span>Vielen Dank für die gute Zusammenarbeit.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="dankeVariante"
                      checked={dankeText === DEFAULT_DANKE_NEU}
                      onChange={() => setDankeText(DEFAULT_DANKE_NEU)}
                      className="mt-0.5"
                    />
                    <span>Vielen Dank, ich freue mich auf die bevorstehende Zusammenarbeit.</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={dankeText}
                  onChange={e => setDankeText(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Oder freier Text..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer mit Aktionen */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50 sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Abbrechen
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleVorschau}
              disabled={generatingPdf || bruttoGesamt <= 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-teal-primary text-teal-primary rounded-lg hover:bg-teal-50 disabled:opacity-50"
            >
              <Eye size={14} />
              {generatingPdf ? 'Generiere...' : 'PDF Vorschau'}
            </button>
            <button
              onClick={handleErstellen}
              disabled={creating || bruttoGesamt <= 0 || !bezeichnung}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
            >
              <FileText size={14} />
              {creating ? 'Erstelle...' : `${anzahlRaten} Rechnung(en) erstellen`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

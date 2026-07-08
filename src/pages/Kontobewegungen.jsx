import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getKontobewegungen, getKontobewegungSchluessel, updateKontobewegung, verschluesseln, importCsv, getCsvDateien, bankabruf, getVerschluesselungVorschlaege, getKontostand } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';
import { Search, Filter, Save, X, Pencil, Upload, Tag, FileDown, Settings, Landmark, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';

export default function Kontobewegungen() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [kontostand, setKontostandState] = useState(null);
  const [schluesselList, setSchluesselList] = useState([]);
  const [vorschlaege, setVorschlaege] = useState({ steuerschluessel: [], schluessel: [], beschreibung: [], kombinationen: [], kuerzel: [] });
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [csvDateien, setCsvDateien] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [showBankAbruf, setShowBankAbruf] = useState(false);
  const [bankPin, setBankPin] = useState('');
  const [bankBenutzer, setBankBenutzer] = useState(() => localStorage.getItem('kk_bank_benutzer') || '');
  const [bankLoading, setBankLoading] = useState(false);

  // Filter state
  const [filters, setFilters] = useState({
    schluessel: '',
    suche: '',
    von: '',
    bis: '',
    konto: '',
  });
  const [activeFilters, setActiveFilters] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    getKontobewegungen(activeFilters)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
    // Kontostand separat ziehen: bis = gesetzter Bis-Filter oder heute; konto = gesetzter Konto-Filter
    const bis = activeFilters.bis || new Date().toISOString().substring(0, 10);
    getKontostand({ bis, konto: activeFilters.konto })
      .then(setKontostandState)
      .catch(() => setKontostandState(null));
  }, [activeFilters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getKontobewegungSchluessel().then(setSchluesselList).catch(console.error);
    getVerschluesselungVorschlaege().then(setVorschlaege).catch(console.error);
  }, []);

  // Gefilterte Beschreibungs-Vorschlaege je nach aktuell gewaehltem Schluessel
  const beschreibungsVorschlaege = (currentSchluessel) => {
    if (!currentSchluessel) return vorschlaege.beschreibung;
    const passend = vorschlaege.kombinationen
      .filter(k => k.schluessel === currentSchluessel && k.beschreibung)
      .map(k => k.beschreibung);
    return passend.length > 0 ? [...new Set(passend)].sort() : vorschlaege.beschreibung;
  };

  // Passender StSchl fuer einen gewaehlten Schluessel (auto-fill, wenn eindeutig)
  const stSchlFuerSchluessel = (schl) => {
    if (!schl) return null;
    const stschls = [...new Set(
      vorschlaege.kombinationen
        .filter(k => k.schluessel === schl && k.steuerschluessel)
        .map(k => k.steuerschluessel)
    )];
    return stschls.length === 1 ? stschls[0] : null;
  };

  const applyFilters = () => {
    const f = {};
    if (filters.schluessel) f.schluessel = filters.schluessel;
    if (filters.suche) f.suche = filters.suche;
    if (filters.von) f.von = filters.von;
    if (filters.bis) f.bis = filters.bis;
    if (filters.konto) f.konto = filters.konto;
    setActiveFilters(f);
  };

  const resetFilters = () => {
    setFilters({ schluessel: '', suche: '', von: '', bis: '', konto: '' });
    setActiveFilters({});
  };

  const setQuickFilter = (label) => {
    const year = new Date().getFullYear();
    const newFilters = { schluessel: '', suche: '', von: `${year}-01-01`, bis: `${year}-12-31`, konto: '' };
    setFilters(newFilters);
    setActiveFilters({ von: newFilters.von, bis: newFilters.bis });
  };

  const handleVerschluesseln = async () => {
    setActionMsg(null);
    try {
      const res = await verschluesseln();
      setActionMsg({ type: 'ok', text: `${res.updated} von ${res.total} unverschluesselten Buchungen kategorisiert.` });
      load();
      getKontobewegungSchluessel().then(setSchluesselList).catch(console.error);
    } catch (err) {
      setActionMsg({ type: 'err', text: 'Fehler: ' + err.message });
    }
  };

  const handleImportOpen = async () => {
    try {
      const files = await getCsvDateien();
      setCsvDateien(files);
      setShowImport(true);
    } catch (err) {
      setActionMsg({ type: 'err', text: 'CSV-Dateien konnten nicht geladen werden: ' + err.message });
    }
  };

  const handleImport = async (pfad) => {
    setActionMsg(null);
    setShowImport(false);
    try {
      const res = await importCsv(pfad);
      setActionMsg({ type: 'ok', text: `Import: ${res.imported} neu, ${res.duplicates} Duplikate, ${res.skipped} uebersprungen.` });
      if (res.imported > 0) load();
    } catch (err) {
      setActionMsg({ type: 'err', text: 'Import-Fehler: ' + err.message });
    }
  };

  const handleBankAbruf = async () => {
    if (!bankPin || !bankBenutzer) return;
    setBankLoading(true);
    setActionMsg(null);
    localStorage.setItem('kk_bank_benutzer', bankBenutzer);
    try {
      const res = await bankabruf({ pin: bankPin, benutzer: bankBenutzer });
      setBankPin('');
      setShowBankAbruf(false);
      let msg = `Bankabruf erfolgreich: ${res.dateien} Datei(en), ${res.imported} neue Buchungen, ${res.duplicates} Duplikate, ${res.verschluesselt} verschluesselt.`;
      if (res.autoMatched > 0) msg += ` ${res.autoMatched} Rechnung(en) automatisch als bezahlt markiert.`;
      setActionMsg({ type: 'ok', text: msg });
      if (res.imported > 0) load();
    } catch (err) {
      setActionMsg({ type: 'err', text: 'Bankabruf fehlgeschlagen: ' + err.message });
    } finally {
      setBankLoading(false);
      setBankPin('');
    }
  };

  const startEdit = (row) => {
    setEditId(row.id);
    setEditData({
      steuerschluessel: row.steuerschluessel || '',
      schluessel: row.schluessel || '',
      beschreibung: row.beschreibung || '',
      zugeordnet: row.zugeordnet || '',
      detail: row.detail || '',
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditData({});
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const updated = await updateKontobewegung(editId, editData);
      setData((prev) => prev.map((r) => (r.id === editId ? updated : r)));
      setEditId(null);
    } catch (err) {
      console.error(err);
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  // Schluessel, die NICHT in Einnahmen/Ausgaben zaehlen (nur im Kontostand)
  // z.B. Schenkungen, Privateinlagen, Uebertraege zwischen eigenen Konten
  const NEUTRALE_SCHLUESSEL = ['Geschenke', 'Privateinlage', 'Privatentnahme', 'Uebertrag'];

  // Summen ueber die aktuell gefilterte Liste
  const summen = useMemo(() => {
    let einnahmen = 0;
    let ausgaben = 0;
    let neutral = 0;
    let minDatum = null;
    let maxDatum = null;
    for (const row of data) {
      const b = parseFloat(row.betrag) || 0;
      const d = row.buchungstag ? String(row.buchungstag).substring(0, 10) : null;
      if (d) {
        if (!minDatum || d < minDatum) minDatum = d;
        if (!maxDatum || d > maxDatum) maxDatum = d;
      }
      if (NEUTRALE_SCHLUESSEL.includes(row.schluessel)) {
        neutral += b;
        continue; // nicht in Einnahmen/Ausgaben
      }
      if (b >= 0) einnahmen += b;
      else ausgaben += b; // bleibt negativ
    }
    return { einnahmen, ausgaben, neutral, saldo: einnahmen + ausgaben, minDatum, maxDatum };
  }, [data]);

  const kontoLabel = (iban) => {
    if (!iban) return '';
    if (iban.includes('6001375456')) return 'Geschaeft';
    if (iban.includes('0201394287')) return 'Privat';
    if (iban.includes('6380390785')) return 'Spareinlage';
    return iban.slice(-6);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/bereich/finanzen')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-teal-dark">Kontobewegungen</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBankAbruf(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 text-sm font-medium">
            <Landmark size={14} /> Bankabruf
          </button>
          <button onClick={handleImportOpen} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
            <Upload size={14} /> CSV Import
          </button>
          <button onClick={handleVerschluesseln} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 text-sm font-medium">
            <Tag size={14} /> Verschluesseln
          </button>
          <button onClick={() => navigate('/kategorisierungsregeln')} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium">
            <Settings size={14} /> Regeln
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        {data.length} Buchungen geladen
        {Object.keys(activeFilters).length > 0 && (
          <span className="ml-2 text-xs text-teal-700">(gefiltert)</span>
        )}
      </p>

      {/* Summen-Uebersicht (basiert auf aktueller Filterung) */}
      {data.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <div className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Einnahmen</div>
              <div className="text-xl font-bold text-emerald-800 font-mono mt-0.5">
                {formatCurrency(summen.einnahmen)}
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <div className="text-xs font-medium text-red-700 uppercase tracking-wide">Ausgaben</div>
              <div className="text-xl font-bold text-red-700 font-mono mt-0.5">
                {formatCurrency(summen.ausgaben)}
              </div>
            </div>
            <div className={`border rounded-lg px-4 py-3 ${
              summen.saldo >= 0
                ? 'bg-teal-50 border-teal-200'
                : 'bg-amber-50 border-amber-200'
            }`}>
              <div className={`text-xs font-medium uppercase tracking-wide ${
                summen.saldo >= 0 ? 'text-teal-700' : 'text-amber-700'
              }`}>Saldo (Ein + Aus)</div>
              <div className={`text-xl font-bold font-mono mt-0.5 ${
                summen.saldo >= 0 ? 'text-teal-800' : 'text-amber-800'
              }`}>
                {formatCurrency(summen.saldo)}
              </div>
            </div>
            {/* Echter Kontostand zum Stichtag */}
            <div className={`border rounded-lg px-4 py-3 ${
              kontostand && kontostand.gesamt >= 0
                ? 'bg-violet-50 border-violet-200'
                : 'bg-rose-50 border-rose-200'
            }`} title={kontostand?.konten?.map(k => `${kontoLabel(k.iban)}: ${formatCurrency(k.kontostand)}`).join('\n')}>
              <div className={`text-xs font-medium uppercase tracking-wide ${
                kontostand && kontostand.gesamt >= 0 ? 'text-violet-700' : 'text-rose-700'
              }`}>
                Kontostand {kontostand?.bis ? formatDate(kontostand.bis) : ''}
              </div>
              <div className={`text-xl font-bold font-mono mt-0.5 ${
                kontostand && kontostand.gesamt >= 0 ? 'text-violet-800' : 'text-rose-800'
              }`}>
                {kontostand ? formatCurrency(kontostand.gesamt) : '—'}
              </div>
              {kontostand?.konten?.length > 1 && (
                <div className="text-[10px] text-violet-600 mt-1 leading-tight">
                  {kontostand.konten.map(k => (
                    <div key={k.iban}>{kontoLabel(k.iban)}: {formatCurrency(k.kontostand)}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Zeitraum der Bewegungen: <span className="font-medium">{formatDate(summen.minDatum)}</span> bis <span className="font-medium">{formatDate(summen.maxDatum)}</span>
            {!filters.konto && <> · alle Konten</>}
            {filters.konto && <> · nur {kontoLabel(filters.konto)}</>}
            {summen.neutral !== 0 && (
              <> · <span className="text-amber-700">nicht in Ein/Aus gezaehlt: {formatCurrency(summen.neutral)}</span> <span className="italic">({NEUTRALE_SCHLUESSEL.join(', ')})</span></>
            )}
            {' · '}<span className="italic">Kontostand = Anfangssaldo 31.12.2024 + alle Bewegungen bis {kontostand?.bis ? formatDate(kontostand.bis) : 'heute'}</span>
          </p>
          {/* Warnhinweise fuer Anfangssalden mit Korrektur/Diff */}
          {kontostand?.konten?.filter(k => k.bemerkung && /differenz|korrektur|unbekannt/i.test(k.bemerkung)).map(k => (
            <div key={k.iban} className="mb-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-amber-600" />
              <div>
                <span className="font-semibold">{kontoLabel(k.iban)} — Anfangssaldo-Hinweis:</span>{' '}
                {k.bemerkung}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Aktionsmeldungen */}
      {actionMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm flex items-center justify-between ${
          actionMsg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <span>{actionMsg.text}</span>
          <button onClick={() => setActionMsg(null)} className="ml-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
      )}

      {/* Import-Dialog */}
      {showImport && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-blue-900">CSV-Datei importieren</h3>
            <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          {csvDateien.length === 0 ? (
            <p className="text-sm text-gray-500">Keine CSV-Dateien gefunden (Umsaetze_*.csv)</p>
          ) : (
            <div className="space-y-1">
              {csvDateien.map((f) => (
                <button
                  key={f.pfad}
                  onClick={() => handleImport(f.pfad)}
                  className="w-full text-left px-3 py-2 bg-white rounded border border-blue-100 hover:bg-blue-100 text-sm flex items-center gap-2"
                >
                  <FileDown size={14} className="text-blue-600" />
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bankabruf-Dialog */}
      {showBankAbruf && (
        <div className="mb-4 p-4 bg-violet-50 border border-violet-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-violet-900">Bankabruf — Frankfurter Volksbank</h3>
            <button onClick={() => { setShowBankAbruf(false); setBankPin(''); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-500 mb-1">Benutzer (VR-Kennung)</label>
              <input
                type="text"
                value={bankBenutzer}
                onChange={(e) => setBankBenutzer(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm"
                placeholder="VR-Kennung"
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-500 mb-1">PIN</label>
              <input
                type="password"
                value={bankPin}
                onChange={(e) => setBankPin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBankAbruf()}
                className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm"
                placeholder="Online-Banking PIN"
                autoFocus
              />
            </div>
            <button
              onClick={handleBankAbruf}
              disabled={bankLoading || !bankPin || !bankBenutzer}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 text-sm font-medium"
            >
              {bankLoading ? <><Loader2 size={14} className="animate-spin" /> Abruf laeuft...</> : <><Landmark size={14} /> Abrufen</>}
            </button>
          </div>
          {bankLoading && (
            <p className="mt-2 text-xs text-violet-600">Verbindung zur Bank wird hergestellt, Umsaetze werden abgerufen... Das kann bis zu 2 Minuten dauern.</p>
          )}
        </div>
      )}

      {/* Filterbereich */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Suche */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Suche</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={filters.suche}
                onChange={(e) => setFilters((f) => ({ ...f, suche: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Name, Verwendungszweck, Beschreibung..."
                className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary focus:border-teal-primary"
              />
            </div>
          </div>

          {/* Schluessel */}
          <div className="w-48">
            <label className="block text-xs font-medium text-gray-500 mb-1">Schluessel</label>
            <select
              value={filters.schluessel}
              onChange={(e) => setFilters((f) => ({ ...f, schluessel: e.target.value }))}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            >
              <option value="">Alle</option>
              <option value="_leer">(nicht kategorisiert)</option>
              {schluesselList.map((s) => (
                <option key={s.schluessel} value={s.schluessel}>
                  {s.schluessel} ({s.anzahl})
                </option>
              ))}
            </select>
          </div>

          {/* Von */}
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-500 mb-1">Von</label>
            <input
              type="date"
              value={filters.von}
              onChange={(e) => setFilters((f) => ({ ...f, von: e.target.value }))}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            />
          </div>

          {/* Bis */}
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-500 mb-1">Bis</label>
            <input
              type="date"
              value={filters.bis}
              onChange={(e) => setFilters((f) => ({ ...f, bis: e.target.value }))}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            />
          </div>

          {/* Konto */}
          <div className="w-36">
            <label className="block text-xs font-medium text-gray-500 mb-1">Konto</label>
            <select
              value={filters.konto}
              onChange={(e) => setFilters((f) => ({ ...f, konto: e.target.value }))}
              className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            >
              <option value="">Alle</option>
              <option value="DE50501900006001375456">Geschaeft</option>
              <option value="DE57501900000201394287">Privat</option>
            </select>
          </div>

          {/* Buttons */}
          <button
            onClick={applyFilters}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-primary text-white rounded-md hover:bg-teal-hover text-sm font-medium"
          >
            <Filter size={14} /> Filtern
          </button>
          <button
            onClick={setQuickFilter}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-200 text-sm font-medium"
          >
            {new Date().getFullYear()}
          </button>
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 text-sm"
          >
            <X size={14} /> Reset
          </button>
        </div>
      </div>

      {/* Tabelle */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Keine Buchungen gefunden</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-teal-primary text-white">
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap w-8"></th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Datum</th>
                <th className="px-2 py-2.5 text-right font-semibold whitespace-nowrap">Betrag</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Name</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Verwendungszweck</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Konto</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">StSchl</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Schluessel</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Beschreibung</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Detail</th>
                <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Zugeordnet</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => {
                const isEditing = editId === row.id;
                const betrag = parseFloat(row.betrag) || 0;

                return (
                  <tr
                    key={row.id}
                    className={`border-t border-gray-100 ${
                      isEditing
                        ? 'bg-teal-50'
                        : idx % 2 === 0
                        ? 'bg-white'
                        : 'bg-gray-50/50'
                    } hover:bg-teal-50/50`}
                  >
                    {/* Edit Button */}
                    <td className="px-2 py-1.5 text-center">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} disabled={saving} className="text-emerald-600 hover:text-emerald-800" title="Speichern">
                            <Save size={14} />
                          </button>
                          <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600" title="Abbrechen">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(row)} className="text-gray-300 hover:text-teal-600" title="Bearbeiten">
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>

                    {/* Datum */}
                    <td className="px-2 py-1.5 whitespace-nowrap text-xs">{formatDate(row.buchungstag)}</td>

                    {/* Betrag */}
                    <td className={`px-2 py-1.5 text-right whitespace-nowrap font-mono text-xs ${betrag >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {formatCurrency(betrag)}
                    </td>

                    {/* Name */}
                    <td className="px-2 py-1.5 text-xs max-w-[180px] truncate" title={row.name_zahlungsbeteiligter}>
                      {row.name_zahlungsbeteiligter}
                    </td>

                    {/* Verwendungszweck */}
                    <td className="px-2 py-1.5 text-xs max-w-[250px] truncate" title={row.verwendungszweck}>
                      {row.verwendungszweck}
                    </td>

                    {/* Konto */}
                    <td className="px-2 py-1.5 whitespace-nowrap text-xs text-gray-500">
                      {kontoLabel(row.iban_auftragskonto)}
                    </td>

                    {/* Editierbare Felder */}
                    {isEditing ? (
                      <>
                        <td className="px-1 py-1">
                          <input
                            list="dl-stschl"
                            value={editData.steuerschluessel}
                            onChange={(e) => setEditData((d) => ({ ...d, steuerschluessel: e.target.value }))}
                            onKeyDown={handleKeyDown}
                            className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs"
                            placeholder="StSchl"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            list="dl-schluessel"
                            value={editData.schluessel}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEditData((d) => {
                                const auto = stSchlFuerSchluessel(v);
                                return {
                                  ...d,
                                  schluessel: v,
                                  // nur auto-fuellen, wenn bisher leer UND eindeutige Zuordnung existiert
                                  steuerschluessel: d.steuerschluessel || auto || '',
                                };
                              });
                            }}
                            onKeyDown={handleKeyDown}
                            className="w-24 px-1 py-0.5 border border-gray-300 rounded text-xs"
                            placeholder="Schluessel"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            list={`dl-beschr-${editData.schluessel || 'all'}`}
                            value={editData.beschreibung}
                            onChange={(e) => setEditData((d) => ({ ...d, beschreibung: e.target.value }))}
                            onKeyDown={handleKeyDown}
                            className="w-32 px-1 py-0.5 border border-gray-300 rounded text-xs"
                            placeholder="Beschreibung"
                          />
                          {/* Kontext-Datalist passend zum aktuell gewaehlten Schluessel */}
                          <datalist id={`dl-beschr-${editData.schluessel || 'all'}`}>
                            {beschreibungsVorschlaege(editData.schluessel).map((b) => (
                              <option key={b} value={b} />
                            ))}
                          </datalist>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={editData.detail}
                            onChange={(e) => setEditData((d) => ({ ...d, detail: e.target.value }))}
                            onKeyDown={handleKeyDown}
                            className="w-28 px-1 py-0.5 border border-gray-300 rounded text-xs"
                            placeholder="Detail"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            list="dl-kuerzel"
                            value={editData.zugeordnet}
                            onChange={(e) => setEditData((d) => ({ ...d, zugeordnet: e.target.value }))}
                            onKeyDown={handleKeyDown}
                            className="w-20 px-1 py-0.5 border border-gray-300 rounded text-xs"
                            placeholder="Kuerzel"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-xs text-gray-500">{row.steuerschluessel}</td>
                        <td className="px-2 py-1.5 text-xs">{row.schluessel}</td>
                        <td className="px-2 py-1.5 text-xs text-gray-600 max-w-[150px] truncate" title={row.beschreibung}>{row.beschreibung}</td>
                        <td className="px-2 py-1.5 text-xs text-gray-600 max-w-[130px] truncate" title={row.detail}>{row.detail}</td>
                        <td className="px-2 py-1.5 text-xs font-mono">{row.zugeordnet}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Globale Datalists fuer Comboboxen */}
      <datalist id="dl-stschl">
        {vorschlaege.steuerschluessel.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="dl-schluessel">
        {vorschlaege.schluessel.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="dl-kuerzel">
        {vorschlaege.kuerzel.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}

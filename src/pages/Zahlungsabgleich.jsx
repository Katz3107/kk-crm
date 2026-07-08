import React, { useState, useEffect } from 'react';
import { getZahlungsabgleichVorschau, zahlungsabgleichAusfuehren } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Play, Check, X, ArrowLeft } from 'lucide-react';

export default function Zahlungsabgleich() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState({});

  const load = () => {
    setLoading(true);
    setResult(null);
    getZahlungsabgleichVorschau()
      .then((d) => {
        setData(d);
        // Zweifelsfrei = RgNr-Match UND Betrag stimmt
        const autoSelect = {};
        (d.rgnr_matches || []).forEach((m) => {
          if (parseFloat(m.rg_betrag) === parseFloat(m.bank_betrag)) {
            autoSelect[m.rechnung_id] = true;
          }
        });
        setSelected(autoSelect);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleSelect = (id) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allMatches = data
    ? [...(data.rgnr_matches || []), ...(data.name_matches || [])]
    : [];

  const selectedMatches = allMatches.filter((m) => selected[m.rechnung_id]);

  const handleExecute = async () => {
    if (selectedMatches.length === 0) return;
    setExecuting(true);
    try {
      const matches = selectedMatches.map((m) => ({
        rechnung_id: m.rechnung_id,
        buchungstag: m.buchungstag.substring(0, 10),
        kb_id: m.kb_id,
      }));
      const res = await zahlungsabgleichAusfuehren(matches);
      setResult(res);
      load();
    } catch (err) {
      console.error(err);
      setResult({ error: err.message });
    } finally {
      setExecuting(false);
    }
  };

  const renderMatchRow = (m, idx) => {
    const betragMatch = parseFloat(m.rg_betrag) === parseFloat(m.bank_betrag);
    const isRgNr = m.match_typ === 'rgnr';
    const sicher = isRgNr && betragMatch;

    return (
      <tr
        key={m.rechnung_id + '-' + m.kb_id}
        className={`border-t border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${selected[m.rechnung_id] ? 'bg-emerald-50/50' : ''}`}
      >
        <td className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={!!selected[m.rechnung_id]}
            onChange={() => toggleSelect(m.rechnung_id)}
            className="w-4 h-4 accent-teal-600"
          />
        </td>
        <td className="px-3 py-2 font-mono text-xs">{m.rg_nr}</td>
        <td className="px-3 py-2">{m.kuerzel}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(m.rg_betrag)}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(m.bank_betrag)}</td>
        <td className="px-3 py-2 whitespace-nowrap">{formatDate(m.buchungstag)}</td>
        <td className="px-3 py-2 text-sm text-gray-600 max-w-[250px] truncate" title={m.verwendungszweck}>{m.verwendungszweck}</td>
        <td className="px-3 py-2 text-sm text-gray-600 max-w-[180px] truncate" title={m.name_zahlungsbeteiligter}>{m.name_zahlungsbeteiligter}</td>
        <td className="px-3 py-2 text-center">
          {sicher ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">
              <CheckCircle size={12} /> sicher
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
              <AlertTriangle size={12} /> pruefen
            </span>
          )}
        </td>
      </tr>
    );
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/bereich/finanzen')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
        <h2 className="text-2xl font-bold text-teal-dark mb-2">Zahlungsabgleich</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Bankbuchungen automatisch mit offenen Rechnungen abgleichen.
      </p>

      {result && !result.error && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
          <Check size={16} />
          {result.updated} Rechnung(en) als bezahlt markiert.
        </div>
      )}
      {result && result.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-center gap-2">
          <X size={16} />
          Fehler: {result.error}
        </div>
      )}

      {allMatches.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          Keine neuen Matches gefunden. Alle offenen Rechnungen sind entweder bereits bezahlt oder haben keine passende Bankbuchung.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600">
              {allMatches.length} Match(es) gefunden — {selectedMatches.length} ausgewaehlt
            </div>
            <button
              onClick={handleExecute}
              disabled={executing || selectedMatches.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50 text-sm font-medium"
            >
              <Play size={16} />
              {executing ? 'Wird ausgefuehrt...' : `${selectedMatches.length} zuordnen`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-teal-primary text-white">
                  <th className="px-3 py-2.5 w-10"></th>
                  <th className="px-3 py-2.5 text-left font-semibold">RgNr</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Kuerzel</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Rg-Betrag</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Bank-Betrag</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Buchungstag</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Verwendungszweck</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Zahler</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.rgnr_matches || []).map((m, idx) => renderMatchRow(m, idx))}
                {(data.name_matches || []).length > 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-2 bg-amber-50 text-xs font-semibold text-amber-700 border-t-2 border-amber-200">
                      Matches ueber Name + Betrag (bitte pruefen)
                    </td>
                  </tr>
                )}
                {(data.name_matches || []).map((m, idx) => renderMatchRow(m, (data.rgnr_matches || []).length + idx))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
